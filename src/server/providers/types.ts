import type { ChatErrorCode, ChatErrorInfo, WireMessage } from "@/lib/chat";
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
   * a raw SDK error) and must honour `signal` for cancellation.
   */
  stream(
    messages: readonly WireMessage[],
    signal: AbortSignal,
  ): Promise<AsyncIterable<ProviderDelta>>;
};
