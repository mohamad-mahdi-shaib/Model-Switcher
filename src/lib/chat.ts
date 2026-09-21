/**
 * Shared chat contract between the client and /api/chat.
 *
 * The wire format is NDJSON: one JSON object per line. That lets the server
 * report an error that only surfaces mid-stream (a quota trip partway through a
 * long answer) without having to abandon the text already delivered.
 */

import type { ProviderId } from "@/lib/providers";

export type ChatRole = "user" | "assistant";

/**
 * `state` tracks completion so a reply cut off by Stop or a refresh can be
 * shown honestly as interrupted, rather than as still-streaming or as a
 * complete answer. Absent on messages predating persistence.
 */
export type MessageState = "complete" | "interrupted" | "streaming";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  state?: MessageState;
  /**
   * Which provider produced this answer. Recorded per message, not taken from
   * the conversation, so switching providers does not retroactively re-label
   * earlier answers. Absent on user messages and on anything saved before
   * multi-provider support.
   */
  provider?: ProviderId;
};

/** Sent to the API. Ids and UI-only state are stripped. */
export type WireMessage = {
  role: ChatRole;
  content: string;
};

export type ChatErrorCode =
  | "MISSING_KEY"
  | "INVALID_KEY"
  | "PROVIDER_DISABLED"
  | "BAD_REQUEST"
  | "RATE_LIMIT"
  /**
   * Billing exhausted: no credit, or a spend/usage ceiling reached. Separate
   * from RATE_LIMIT because the two arrive as the same HTTP 429 but need
   * opposite advice -- one clears by waiting, the other never does.
   */
  | "INSUFFICIENT_CREDIT"
  | "MODEL_BUSY"
  | "UPSTREAM"
  | "EMPTY_REPLY"
  | "NETWORK"
  | "ABORTED";

/**
 * Quota facts taken from Google's 429 payload. Reported rather than guessed:
 * the distinction between a per-minute and a per-day cap changes what the user
 * should do, and only the response says which it is.
 */
export type QuotaScope = "minute" | "day" | "zero" | "unknown";

export type ChatErrorInfo = {
  /** Google's RetryInfo.retryDelay, in seconds. */
  retryAfterSeconds?: number;
  quotaScope?: QuotaScope;
  /** Requests allowed in the window. 0 means no quota at all on this tier. */
  quotaValue?: number;
  quotaModel?: string;
  quotaId?: string;
};

export type StreamEvent =
  | { type: "delta"; text: string }
  | {
      type: "error";
      code: ChatErrorCode;
      message: string;
      info?: ChatErrorInfo;
    }
  | { type: "done" };

/**
 * User-facing copy, one entry per error code. Actionable, never blames the
 * user.
 *
 * `{provider}` and `{key}` are substituted by `errorCopy()`. They used to be
 * hardcoded to Gemini, which was fine while Gemini was the only provider and
 * became wrong the moment a second one could fail: a GPT failure would have
 * told the user to check GEMINI_API_KEY.
 */
export const ERROR_COPY: Record<ChatErrorCode, string> = {
  MISSING_KEY:
    "{provider} is not configured. Add {key} to .env.local and restart the dev server.",
  INVALID_KEY:
    "{provider} rejected that API key. Check {key} in .env.local, then retry.",
  PROVIDER_DISABLED: "That provider is not connected yet.",
  BAD_REQUEST: "That message could not be sent. Try rephrasing it.",
  RATE_LIMIT: "{provider}'s rate limit for this model has been reached.",
  INSUFFICIENT_CREDIT:
    "{provider} rejected the request for billing reasons - the account has no remaining credit, or a spend limit was reached. Waiting will not clear this; add credit or raise the limit, then retry.",
  MODEL_BUSY:
    "{provider} is experiencing high demand and turned the request away. This is temporary - retry in a moment.",
  UPSTREAM: "{provider} could not complete that request.",
  EMPTY_REPLY:
    "{provider} returned an empty response. Retry, or rephrase the question.",
  NETWORK: "Could not reach the server. Check your connection, then retry.",
  ABORTED: "Stopped.",
};

/** Environment variable each provider's key is read from, for error copy. */
const KEY_NAME: Record<string, string> = {
  gemini: "GEMINI_API_KEY",
  gpt: "OPENAI_API_KEY",
};

/** The env var a provider's key is read from. Never the value itself. */
export function providerKeyName(id: string): string {
  return KEY_NAME[id] ?? "the provider API key";
}

/** Resolves the copy for a code against the provider that actually failed. */
export function errorCopy(
  code: ChatErrorCode,
  provider: { id: string; label: string },
): string {
  return ERROR_COPY[code]
    .replaceAll("{provider}", provider.label)
    .replaceAll("{key}", providerKeyName(provider.id));
}

export function toWire(messages: readonly ChatMessage[]): WireMessage[] {
  return messages.map(({ role, content }) => ({ role, content }));
}

let counter = 0;
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

/**
 * Reads back the creation time `newId` encodes in the middle segment.
 *
 * The message timestamp is derived rather than stored: every id already
 * carries its own millisecond clock, so showing a sent-time needs no new field
 * on ChatMessage and therefore no change to the persisted schema or to what
 * already-saved conversations validate against.
 *
 * Returns null for any id not in that shape, so an unrecognised id renders no
 * timestamp rather than a wrong one.
 */
export function timeFromId(id: string): Date | null {
  const segment = id.split("-")[1];
  if (!segment || !/^[0-9a-z]+$/.test(segment)) return null;
  const ms = parseInt(segment, 36);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
}
