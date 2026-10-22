import type {
  ChatErrorCode,
  ChatErrorInfo,
  GeneratedImageRef,
  StreamOutcome,
  WireMessage,
} from "@/lib/chat";
import type { Preferences } from "@/lib/preferences";
import type { ProviderId } from "@/lib/providers";

/**
 * Provider-neutral contract.
 *
 * Everything vendor-specific — SDK import, request shape, streaming format,
 * error payloads — lives behind an adapter implementing this interface. The
 * API route knows only this type, so a new provider is a new adapter file plus
 * one registry entry, with no change to request handling.
 */

/** Normalised delta emitted by every adapter. */
export type ProviderDelta = { text: string };

/**
 * One chunk of a normalized provider stream (Finding F2): either more text,
 * or -- always exactly once, as the LAST chunk, on any non-throwing end of
 * the stream -- the confirmed reason it ended.
 *
 * An adapter's `stream()` must never let its returned generator end without
 * having yielded exactly one `"outcome"` chunk first. Concretely: on the
 * provider's own confirmed completion signal, yield `{outcome:"complete"}`;
 * on the provider's own confirmed non-success signal (a length cap, a
 * content-policy stop, and so on), yield `{outcome:"truncated", reason?}`;
 * and if the underlying connection simply ends with no such signal ever
 * having arrived, yield `{outcome:"unknown"}` as a fallback immediately
 * before returning. A thrown `ProviderError` remains the only channel for an
 * actual failure -- this type covers only non-throwing ends.
 */
export type ProviderChunk =
  | ({ type: "delta" } & ProviderDelta)
  /**
   * Project 3: an image produced by a tool call during this turn. Optional
   * for an adapter to emit -- the two direct integrations never do -- and
   * the route simply forwards it, so adding it did not change how any
   * existing adapter behaves.
   */
  | { type: "image"; image: GeneratedImageRef }
  | { type: "outcome"; outcome: StreamOutcome; reason?: string };

/** Normalised failure. Adapters translate vendor errors into this. */
export class ProviderError extends Error {
  code: ChatErrorCode;
  info?: ChatErrorInfo;
  /** Only transient classes should be retried by the route. */
  retryable: boolean;

  constructor(
    code: ChatErrorCode,
    options: { info?: ChatErrorInfo; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(code);
    this.name = "ProviderError";
    this.code = code;
    this.info = options.info;
    this.retryable = options.retryable ?? false;
    this.cause = options.cause;
  }
}

export type ProviderCapabilities = {
  streaming: boolean;
  /** Whole-conversation context is sent on every turn. */
  multiTurn: boolean;
  cancellation: boolean;
  /**
   * Whether this adapter translates `WireMessage.attachments` into real
   * provider input (Interaction refinement) -- both current adapters set
   * this `true`, since the app's allowed attachment scope (JPEG/PNG/WebP
   * images, PDF, a small text/code allowlist) is exactly the intersection
   * of what Gemini and the configured OpenAI model actually support. Real
   * infrastructure, not a stub: kept so the client can genuinely gate on a
   * provider's own declared support rather than assuming it, if that
   * intersection ever stops holding for a future provider.
   */
  attachments: boolean;
};

export type ProviderAvailability = {
  configured: boolean;
  /** Model actually in use, for display. Never includes credentials. */
  model: string;
  /** Why it is unavailable, when it is. Safe to show a user. */
  reason?: string;
};

export type ChatProvider = {
  id: ProviderId;
  label: string;
  capabilities: ProviderCapabilities;

  /** Checks server-side configuration. Must never return any secret value. */
  availability(): ProviderAvailability;

  /**
   * Streams a reply for the whole conversation. Must throw ProviderError (never
   * a raw SDK error) and must honour `signal` for cancellation. See
   * `ProviderChunk` for the one-outcome-chunk-on-every-non-throwing-end
   * requirement.
   *
   * `preferences`, when present and non-empty (see `hasPreferences()`), is
   * mapped to this provider's own instruction mechanism via the shared
   * `buildSystemInstructionText()` (`@/server/preferences.ts`) -- never
   * concatenated into the conversation's own messages. Applies to every
   * request this function is asked to make, including Retry/Regenerate/
   * Edit-and-resend, since all three call this the same way a fresh send
   * does; there is no separate "preferences at the time this was
   * originally sent" concept.
   *
   * `documentContext` (Project 4), when present, is the already-rendered
   * block of passages retrieved from the user's uploaded files for THIS
   * turn's question. Adapters pass it through the same shared
   * `buildSystemInstructionText()` as preferences and must not interpret it:
   * the retrieval, the citation instructions and the untrusted-content
   * fencing are all decided in one place (`@/server/documents/retrieve.ts`),
   * so every provider sees identical wording and a model switch cannot
   * change how a document is grounded. An adapter that ignored it would
   * answer from general knowledge while the UI claimed the files were
   * searched -- so it is part of the contract, not an optional nicety.
   */
  stream(
    messages: readonly WireMessage[],
    signal: AbortSignal,
    preferences?: Preferences,
    documentContext?: string,
  ): Promise<AsyncIterable<ProviderChunk>>;
};
