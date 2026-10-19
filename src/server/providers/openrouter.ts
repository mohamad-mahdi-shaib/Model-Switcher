import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { stepCountIs, streamText, type ModelMessage } from "ai";
import type { GeneratedImageRef, StreamOutcome, WireMessage } from "@/lib/chat";
import { imageGenerationConfigured } from "@/server/images/generate";
import { createImageGenerationTool } from "@/server/images/tool";
import { findOpenRouterModel, type OpenRouterModel } from "@/lib/models";
import type { Preferences } from "@/lib/preferences";
import type { ProviderId } from "@/lib/providers";
import { buildSystemInstructionText } from "@/server/preferences";
import {
  ProviderError,
  type ChatProvider,
  type ProviderAvailability,
  type ProviderChunk,
} from "@/server/providers/types";

/**
 * Project 3: one adapter class of model -- everything reachable through
 * OpenRouter -- behind the same `ChatProvider` contract the two direct
 * integrations already implement. The API route is unchanged: it still knows
 * only the contract, and `registry.ts` still gains one line per model.
 *
 * Unlike `gemini.ts` (the `@google/genai` SDK) and `openai.ts` (a hand-rolled
 * SSE reader over the Responses API), this adapter goes through the Vercel AI
 * SDK's `streamText` with `@openrouter/ai-sdk-provider`. That is deliberate:
 * the same SDK carries the tool calling in `@/server/images/tool.ts`, so the
 * two features share one transport, one error surface and one set of model
 * messages rather than two parallel OpenRouter clients.
 *
 * Every model this file serves is declared in `@/lib/models.ts`, whose
 * capability flags come from OpenRouter's own published catalogue.
 */

const KEY_ENV = "OPENROUTER_API_KEY";

/** The key is read lazily, never at module scope, so an import cannot throw. */
function apiKey(): string | undefined {
  return process.env[KEY_ENV]?.trim() || undefined;
}

function client() {
  const key = apiKey();
  if (!key) throw new ProviderError("MISSING_KEY");
  return createOpenRouter({
    apiKey: key,
    // Optional attribution headers OpenRouter uses for its rankings. Neither
    // is a secret and both are omitted when unset.
    headers: {
      ...(process.env.OPENROUTER_SITE_URL
        ? { "HTTP-Referer": process.env.OPENROUTER_SITE_URL }
        : {}),
      ...(process.env.OPENROUTER_SITE_NAME
        ? { "X-Title": process.env.OPENROUTER_SITE_NAME }
        : {}),
    },
  });
}

/**
 * Translates this app's own wire messages into AI SDK `ModelMessage`s.
 *
 * `vision` is the gate that keeps Phase 5's promise: a model whose catalogue
 * entry says it takes text only never receives an image part. The attachment
 * is NOT silently dropped -- it is replaced by a short, explicit note in the
 * text, so the model (and the transcript) still reflect that the user
 * attached something, and the UI separately warns before the send (see
 * `MessageComposer`'s capability notice).
 */
export function toModelMessages(
  messages: readonly WireMessage[],
  vision: boolean,
): ModelMessage[] {
  return messages.map((message): ModelMessage => {
    const attachments = message.attachments ?? [];
    if (message.role !== "user" || attachments.length === 0) {
      return message.role === "assistant"
        ? { role: "assistant", content: message.content }
        : { role: "user", content: message.content };
    }

    const parts: Array<
      | { type: "text"; text: string }
      | { type: "image"; image: string; mediaType?: string }
      | { type: "file"; data: string; mediaType: string; filename?: string }
    > = [];

    const unreadable: string[] = [];
    for (const attachment of attachments) {
      if (attachment.kind === "text") {
        parts.push({
          type: "text",
          text: `--- ${attachment.name} ---\n${attachment.text}`,
        });
        continue;
      }
      if (!vision) {
        unreadable.push(attachment.name);
        continue;
      }
      if (attachment.kind === "image") {
        // A data URL, which the AI SDK normalises per provider. Base64 is the
        // only form available here: the bytes live in the browser's
        // IndexedDB, never at a public URL, so there is nothing to link to.
        parts.push({
          type: "image",
          image: `data:${attachment.mimeType};base64,${attachment.data}`,
          mediaType: attachment.mimeType,
        });
      } else {
        parts.push({
          type: "file",
          data: attachment.data,
          mediaType: attachment.mimeType,
          filename: attachment.name,
        });
      }
    }

    const text =
      unreadable.length > 0
        ? `${message.content}\n\n(Attached, but this model cannot read images: ${unreadable.join(", ")}.)`
        : message.content;
    parts.unshift({ type: "text", text });

    return { role: "user", content: parts };
  });
}

/** AI SDK finish reasons -> this app's own three-value outcome vocabulary. */
function toOutcome(finishReason: string): { outcome: StreamOutcome; reason?: string } {
  switch (finishReason) {
    case "stop":
    case "tool-calls":
      return { outcome: "complete" };
    case "length":
      return { outcome: "truncated", reason: "length" };
    case "content-filter":
      return { outcome: "truncated", reason: "content-filter" };
    case "error":
      // A real failure arrives as a thrown error; reaching here means the
      // stream ended without one, which is not a confirmed success either.
      return { outcome: "unknown" };
    default:
      return { outcome: "unknown" };
  }
}

/**
 * Maps a thrown SDK/transport error onto the normalized vocabulary. Status
 * codes are OpenRouter's documented ones; the message is only ever inspected
 * for well-known markers, never surfaced raw to the client (it can carry
 * request fragments).
 */
export function classifyOpenRouterError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;

  /**
   * The status is not reliably on the error that reaches us.
   *
   * Found in live testing against the deployed app: a real OpenRouter 402
   * ("insufficient credit") surfaced from `/api/images` with its status
   * intact, but the SAME upstream failure arriving through `streamText`
   * reached this function wrapped -- the AI SDK nests the original
   * `APICallError` under `cause` (and, on a retried call, under
   * `lastError`/`errors[]`), so a top-level `statusCode` read found nothing
   * and every billing failure was reported as a generic UPSTREAM error.
   * That told the user "the provider could not be reached" when the true
   * answer was "this account has no credit" -- opposite advice.
   *
   * Walking the chain fixes it at the source, for every wrapper shape rather
   * than the one that happened to be observed.
   */
  const seen = new Set<unknown>();
  let status: number | undefined;
  let bodyText = "";
  const visit = (value: unknown, depth: number): void => {
    if (!value || typeof value !== "object" || depth > 6 || seen.has(value)) return;
    seen.add(value);
    const node = value as Record<string, unknown>;
    if (status === undefined && typeof node.statusCode === "number") status = node.statusCode;
    if (status === undefined && typeof node.status === "number") status = node.status;
    if (typeof node.responseBody === "string") bodyText += ` ${node.responseBody}`;
    if (typeof node.message === "string") bodyText += ` ${node.message}`;
    visit(node.cause, depth + 1);
    visit(node.lastError, depth + 1);
    visit(node.error, depth + 1);
    visit(node.data, depth + 1);
    if (Array.isArray(node.errors)) for (const e of node.errors) visit(e, depth + 1);
  };
  visit(error, 0);

  const err = error as { name?: string; message?: string };
  const name = err?.name ?? "";
  const message = `${err?.message ?? ""}${bodyText}`.toLowerCase();

  // OpenRouter words a 402 several ways; match the wording as well as the
  // code, so a credit failure is never reported as a transport problem.
  if (
    status === 402 ||
    message.includes("insufficient credit") ||
    message.includes("insufficient_quota") ||
    message.includes("requires more credits") ||
    message.includes("can only afford") ||
    message.includes("add more credits")
  ) {
    return new ProviderError("INSUFFICIENT_CREDIT", { cause: error });
  }

  if (name === "AbortError" || message.includes("aborted")) {
    return new ProviderError("ABORTED", { cause: error });
  }
  if (status === 401 || status === 403) {
    return new ProviderError("INVALID_KEY", { cause: error });
  }
  if (status === 429) {
    return new ProviderError("RATE_LIMIT", { retryable: true, cause: error });
  }
  if (status === 400 || status === 422) {
    return new ProviderError("BAD_REQUEST", { cause: error });
  }
  if (status === 502 || status === 503 || status === 504) {
    return new ProviderError("MODEL_BUSY", { retryable: true, cause: error });
  }
  if (
    name === "TypeError" ||
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("econnreset")
  ) {
    return new ProviderError("NETWORK", { retryable: true, cause: error });
  }
  return new ProviderError("UPSTREAM", { cause: error });
}

/**
 * Builds a `ChatProvider` for one OpenRouter model. The capability flags come
 * from the catalogue entry, so the adapter cannot disagree with what the
 * selector advertises.
 */
export function createOpenRouterProvider(model: OpenRouterModel): ChatProvider {
  return {
    id: model.id,
    label: model.label,
    capabilities: {
      streaming: true,
      multiTurn: true,
      cancellation: true,
      // "Can this adapter turn WireMessage.attachments into real provider
      // input?" -- true for the vision models; the text-only model still
      // accepts text attachments, but never images, so it declares false and
      // the client gates on it.
      attachments: model.capabilities.vision,
    },

    availability(): ProviderAvailability {
      const configured = Boolean(apiKey());
      return {
        configured,
        model: model.openrouterId,
        reason: configured ? undefined : `${KEY_ENV} is not set.`,
      };
    },

    async stream(
      messages: readonly WireMessage[],
      signal: AbortSignal,
      preferences?: Preferences,
    ): Promise<AsyncIterable<ProviderChunk>> {
      const openrouter = client();
      const system = buildSystemInstructionText(preferences);

      /**
       * Project 3, Phase 4: images the model generated by calling the tool
       * during this turn. Collected by the tool's own callback and drained
       * into the chunk stream below, so an image reaches the conversation as
       * a structured event rather than as text.
       */
      const pendingImages: GeneratedImageRef[] = [];

      // The images the user attached to the LAST user turn -- what an "edit
      // this" or "make a variation" request refers to.
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      const attachedImages = (lastUser?.attachments ?? [])
        .filter((a): a is Extract<typeof a, { kind: "image" }> => a.kind === "image")
        .map((a) => ({ mimeType: a.mimeType, data: a.data }));

      // The tool is offered only when generation is actually configured: a
      // model that can see the tool will try to use it, and a tool that
      // always fails is worse than no tool.
      const tools = imageGenerationConfigured()
        ? {
            generate_image: createImageGenerationTool({
              attachedImages,
              onImage: (image) => pendingImages.push(image),
              signal,
            }),
          }
        : undefined;

      const result = streamText({
        model: openrouter.chat(model.openrouterId),
        ...(system ? { system } : {}),
        messages: toModelMessages(messages, model.capabilities.vision),
        ...(tools ? { tools } : {}),
        // One tool round trip, then the model's own sentence about it. This
        // is the loop guard: without a stop condition an agent loop can keep
        // calling tools indefinitely.
        stopWhen: stepCountIs(2),
        abortSignal: signal,
      });

      return (async function* (): AsyncIterable<ProviderChunk> {
        let sawText = false;
        try {
          /**
           * `fullStream`, not `textStream`: the AI SDK reports a failed
           * request as an `error` PART rather than by throwing, so iterating
           * `textStream` alone ends quietly and the turn looks merely empty.
           * Live testing showed exactly that -- a billing failure produced no
           * text and no explanation. Reading the full stream lets a real
           * failure be classified and thrown like any other.
           */
          for await (const part of result.fullStream) {
            // Drain anything the tool produced first, so the image appears at
            // the point the model starts talking about it.
            while (pendingImages.length > 0) {
              yield { type: "image", image: pendingImages.shift()! };
            }
            if (part.type === "error") {
              throw classifyOpenRouterError(part.error);
            }
            if (part.type === "text-delta") {
              const delta = part.text ?? "";
              if (delta.length === 0) continue;
              sawText = true;
              yield { type: "delta", text: delta };
            }
          }
        } catch (error) {
          throw classifyOpenRouterError(error);
        }

        // A tool call that finished after the last delta (or a turn with no
        // text at all) still has to deliver its image.
        while (pendingImages.length > 0) {
          yield { type: "image", image: pendingImages.shift()! };
          sawText = true;
        }

        // Exactly one outcome chunk, always last, per the contract.
        let finishReason = "unknown";
        try {
          finishReason = await result.finishReason;
        } catch (error) {
          throw classifyOpenRouterError(error);
        }
        if (!sawText && finishReason === "stop") {
          throw new ProviderError("EMPTY_REPLY");
        }
        const outcome = toOutcome(finishReason);
        yield { type: "outcome", ...outcome };
      })();
    },
  };
}

/** Every OpenRouter chat model, ready for the registry. */
export function openRouterProviders(ids: readonly ProviderId[]): ChatProvider[] {
  const out: ChatProvider[] = [];
  for (const id of ids) {
    const model = findOpenRouterModel(id);
    if (model) out.push(createOpenRouterProvider(model));
  }
  return out;
}
