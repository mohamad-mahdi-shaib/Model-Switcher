import { GoogleGenAI, type Content } from "@google/genai";
import type { ChatErrorCode, ChatErrorInfo, WireMessage } from "@/lib/chat";
import {
  ProviderError,
  type ChatProvider,
  type ProviderDelta,
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

export const geminiProvider: ChatProvider = {
  id: "gemini",
  label: "Gemini",
  capabilities: { streaming: true, multiTurn: true, cancellation: true },

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
  ): Promise<AsyncIterable<ProviderDelta>> {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) throw new ProviderError("MISSING_KEY");

    // Gemini expects 'model' for assistant turns. Sending the whole history is
    // what makes follow-up questions resolve against earlier context.
    const contents: Content[] = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const ai = new GoogleGenAI({ apiKey });

    let raw: AsyncGenerator<{ text?: string }>;
    try {
      raw = await ai.models.generateContentStream({
        model: model(),
        contents,
        config: { abortSignal: signal },
      });
    } catch (error) {
      throw toProviderError(error);
    }

    // Normalise chunks and translate any mid-stream fault.
    return (async function* () {
      try {
        for await (const chunk of raw) {
          if (signal.aborted) return;
          if (chunk.text) yield { text: chunk.text };
        }
      } catch (error) {
        if (signal.aborted) return;
        throw toProviderError(error);
      }
    })();
  },
};
