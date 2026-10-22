import {
  FinishReason,
  GoogleGenAI,
  type Content,
  type GenerateContentResponse,
} from "@google/genai";
import type { ChatErrorCode, ChatErrorInfo, WireMessage } from "@/lib/chat";
import type { Preferences } from "@/lib/preferences";
import { buildSystemInstructionText } from "@/server/preferences";
import {
  ProviderError,
  type ChatProvider,
  type ProviderChunk,
} from "@/server/providers/types";

/**
 * Gemini adapter. The ONLY place @google/genai is imported.
 *
 * Model choice was settled empirically against live calls on 2026-09-18:
 *   gemini-2.5-flash -> 404 "no longer available to new users"
 *   gemini-3.8-flash -> repeated 503 "high demand"; 55-150s when it answered
 *   gemini-3.6-flash -> Google's own recommended replacement; 6-16s
 */

const DEFAULT_MODEL = "gemini-3.6-flash";

function model(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
}

/**
 * Extracts quota facts from a Google 429. quotaId is the only reliable way to
 * distinguish a per-minute throttle from a per-day cap, and the two need
 * completely different advice.
 */
export function parseQuota(error: unknown): ChatErrorInfo | undefined {
  const raw = String((error as { message?: string })?.message ?? "");
  if (!raw) return undefined;

  let text = raw;
  try {
    const outer = JSON.parse(raw) as { error?: { message?: string } };
    if (outer?.error?.message) text = outer.error.message;
  } catch {
    // Not wrapped; scan the raw text.
  }

  const info: ChatErrorInfo = {};
  const delay =
    text.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/) ??
    text.match(/retry in (\d+(?:\.\d+)?)s/i);
  if (delay) info.retryAfterSeconds = Math.ceil(Number(delay[1]));

  const quotaId = text.match(/"quotaId"\s*:\s*"([^"]+)"/);
  if (quotaId) info.quotaId = quotaId[1];
  const quotaValue = text.match(/"quotaValue"\s*:\s*"?(\d+)"?/);
  if (quotaValue) info.quotaValue = Number(quotaValue[1]);
  const m = text.match(/"model"\s*:\s*"([^"]+)"/);
  if (m) info.quotaModel = m[1];

  const id = info.quotaId ?? "";
  info.quotaScope =
    info.quotaValue === 0
      ? "zero"
      : /PerDay/i.test(id)
        ? "day"
        : /PerMinute/i.test(id)
          ? "minute"
          : "unknown";

  return Object.keys(info).length ? info : undefined;
}

/** Maps a Gemini failure onto the shared error vocabulary. */
export function classifyGemini(error: unknown): ChatErrorCode {
  const status = (error as { status?: number })?.status;
  const text = String(
    (error as { message?: string })?.message ?? error,
  ).toLowerCase();

  // Transport failures carry no HTTP status. Reporting them as upstream faults
  // would blame the provider for a connectivity problem.
  if (
    text.includes("fetch failed") ||
    text.includes("econnreset") ||
    text.includes("etimedout") ||
    text.includes("enotfound") ||
    text.includes("socket hang up") ||
    text.includes("network")
  ) {
    return "NETWORK";
  }

  // Checked BEFORE status: Gemini answers an invalid key with HTTP 400, which
  // would otherwise be reported as a malformed request.
  if (
    text.includes("api key not valid") ||
    text.includes("api_key_invalid") ||
    text.includes("invalid api key")
  ) {
    return "INVALID_KEY";
  }
  if (
    text.includes("resource_exhausted") ||
    text.includes("quota") ||
    text.includes("rate limit")
  ) {
    return "RATE_LIMIT";
  }
  if (text.includes("api key") || text.includes("unauthenticated")) {
    return "INVALID_KEY";
  }
  if (
    status === 503 ||
    text.includes("unavailable") ||
    text.includes("high demand") ||
    text.includes("overloaded")
  ) {
    return "MODEL_BUSY";
  }
  if (status === 429) return "RATE_LIMIT";
  if (status === 401 || status === 403) return "INVALID_KEY";
  if (status === 400 || status === 404) return "BAD_REQUEST";
  return "UPSTREAM";
}

const RETRYABLE = new Set<ChatErrorCode>(["MODEL_BUSY", "NETWORK"]);

function toProviderError(error: unknown): ProviderError {
  const code = classifyGemini(error);
  return new ProviderError(code, {
    info: code === "RATE_LIMIT" ? parseQuota(error) : undefined,
    retryable: RETRYABLE.has(code),
    cause: error,
  });
}

/**
 * Maps Gemini's own `finishReason` to our normalized outcome (Finding F2,
 * with a small follow-up correction made in the F3-F9 pass).
 *
 * The full enum, from the installed SDK's own types (not recalled from
 * memory): FINISH_REASON_UNSPECIFIED, STOP, MAX_TOKENS, SAFETY, RECITATION,
 * LANGUAGE, OTHER, BLOCKLIST, PROHIBITED_CONTENT, SPII, plus several
 * tool/image-specific reasons this app never triggers (no tools, no image
 * generation): MALFORMED_FUNCTION_CALL, IMAGE_SAFETY, UNEXPECTED_TOOL_CALL,
 * TOO_MANY_TOOL_CALLS, IMAGE_PROHIBITED_CONTENT, NO_IMAGE, and others.
 * https://ai.google.dev/api/generate-content#FinishReason
 *
 * Only `STOP` is genuine, full completion. `OTHER` is still reported
 * "truncated" (unspecific, but a real, confirmed non-STOP stop -- the SDK's
 * own docs describe it as "all other reasons that stopped the token
 * generation", i.e. generation DID stop, just not for one of the named
 * reasons). `FINISH_REASON_UNSPECIFIED`, and any value this switch does not
 * name at all (a future SDK addition, or one of the tool/image reasons this
 * app never triggers), map to "unknown" instead: the model reported that
 * generation stopped, but gave no reason this file can actually interpret,
 * so calling it a confirmed truncation would overstate what is known. Never
 * folded into the MAX_TOKENS wording either way, since that would misreport
 * the actual cause.
 *
 * Returns `null` for `undefined` (no finish signal on this chunk at all --
 * the SDK's own docs: "If empty, the model has not stopped generating the
 * tokens") so the caller can tell "not finished yet" apart from "finished,
 * for an unrecognised reason".
 */
function classifyFinish(
  reason: FinishReason | undefined,
): { outcome: "complete" | "truncated" | "unknown"; reason?: string } | null {
  if (!reason) return null;
  switch (reason) {
    case FinishReason.STOP:
      return { outcome: "complete" };
    case FinishReason.MAX_TOKENS:
      return { outcome: "truncated", reason: "reached the length limit" };
    case FinishReason.SAFETY:
    case FinishReason.BLOCKLIST:
    case FinishReason.PROHIBITED_CONTENT:
      return { outcome: "truncated", reason: "stopped by content filtering" };
    case FinishReason.RECITATION:
      return { outcome: "truncated", reason: "stopped due to potential recitation" };
    case FinishReason.LANGUAGE:
      return { outcome: "truncated", reason: "stopped due to an unsupported language" };
    case FinishReason.SPII:
      return {
        outcome: "truncated",
        reason: "stopped to avoid sensitive personal information",
      };
    case FinishReason.OTHER:
      return { outcome: "truncated" };
    case FinishReason.FINISH_REASON_UNSPECIFIED:
      // The SDK's own name for this value: the reason itself is unspecified.
      // Distinct from OTHER -- this is not confirmation that something
      // stopped generation for an identifiable non-STOP reason, it is the
      // model declining to say. "unknown" is the honest read, not "truncated".
      return { outcome: "unknown" };
    default:
      // Any value this switch does not name at all: a future SDK addition,
      // or a tool/image-specific reason this text-only, tool-free app never
      // triggers in practice. Not evidence of a confirmed truncation, and
      // certainly not of success.
      return { outcome: "unknown" };
  }
}

export const geminiProvider: ChatProvider = {
  id: "gemini",
  label: "Gemini",
  capabilities: { streaming: true, multiTurn: true, cancellation: true, attachments: true },

  availability() {
    const configured = Boolean(process.env.GEMINI_API_KEY?.trim());
    return {
      configured,
      model: model(),
      reason: configured ? undefined : "GEMINI_API_KEY is not set.",
    };
  },

  async stream(
    messages: readonly WireMessage[],
    signal: AbortSignal,
    preferences?: Preferences,
    documentContext?: string,
  ): Promise<AsyncIterable<ProviderChunk>> {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) throw new ProviderError("MISSING_KEY");

    // Gemini expects 'model' for assistant turns. Sending the whole history is
    // what makes follow-up questions resolve against earlier context.
    //
    // Interaction refinement: image/PDF attachments become an `inlineData`
    // Part alongside the text one -- Gemini's own real (vision-based)
    // understanding path for both, confirmed against the installed
    // `@google/genai` SDK's own `.d.ts` (`Part.inlineData: {mimeType,
    // data}`), not assumed from the provider name. A text/code attachment
    // has no vision path -- Gemini's own docs describe non-PDF documents as
    // "extracted as pure text" -- so it is appended as its own labelled
    // text Part instead, never silently folded into the user's own
    // message text.
    const contents: Content[] = messages.map((m) => {
      const parts: Content["parts"] = [{ text: m.content }];
      for (const attachment of m.attachments ?? []) {
        if (attachment.kind === "text") {
          parts.push({ text: `[Attached file: ${attachment.name}]\n${attachment.text}` });
        } else {
          parts.push({ inlineData: { mimeType: attachment.mimeType, data: attachment.data } });
        }
      }
      return { role: m.role === "assistant" ? "model" : "user", parts };
    });

    const ai = new GoogleGenAI({ apiKey });

    // Personalizations: `systemInstruction` (a plain string is a valid
    // `ContentUnion`, confirmed against the installed SDK's own .d.ts) is
    // the documented mechanism for steering the model without it being
    // part of the conversation itself. Omitted entirely when there is
    // nothing to say, so a request with no saved preferences is byte-for-
    // byte the same request as before this existed.
    const systemInstruction = buildSystemInstructionText(preferences, documentContext);

    let raw: AsyncGenerator<GenerateContentResponse>;
    try {
      raw = await ai.models.generateContentStream({
        model: model(),
        contents,
        config: { abortSignal: signal, ...(systemInstruction ? { systemInstruction } : {}) },
      });
    } catch (error) {
      throw toProviderError(error);
    }

    // Normalise chunks, read the finish reason (F2), and translate any
    // mid-stream fault.
    return (async function* () {
      try {
        let sawFinish = false;
        for await (const chunk of raw) {
          if (signal.aborted) return;
          if (chunk.text) yield { type: "delta", text: chunk.text };
          const finish = classifyFinish(chunk.candidates?.[0]?.finishReason);
          if (finish) {
            sawFinish = true;
            yield { type: "outcome", ...finish };
            return;
          }
        }
        // The SDK's own generator ended without any chunk ever carrying a
        // finishReason (F2: an upstream EOF with no confirmed completion).
        // Never silently treated as success.
        if (!sawFinish && !signal.aborted) {
          yield { type: "outcome", outcome: "unknown" };
        }
      } catch (error) {
        if (signal.aborted) return;
        throw toProviderError(error);
      }
    })();
  },
};
