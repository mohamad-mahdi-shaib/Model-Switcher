/**
 * Shared chat contract between the client and /api/chat.
 *
 * The wire format is NDJSON: one JSON object per line. That lets the server
 * report an error that only surfaces mid-stream (a quota trip partway through a
 * long answer) without having to abandon the text already delivered.
 */

import type { AttachmentKind } from "@/lib/limits";
import type { ProviderId } from "@/lib/providers";

export type ChatRole = "user" | "assistant";

/**
 * `state` tracks completion so a reply cut off by Stop or a refresh can be
 * shown honestly as interrupted, rather than as still-streaming or as a
 * complete answer. Absent on messages predating persistence.
 */
export type MessageState = "complete" | "interrupted" | "streaming";

/**
 * The confirmed reason a provider's own stream ended, when it ended without
 * throwing. This is the vocabulary an adapter and the route may use (see
 * `ProviderChunk` in `@/server/providers/types`): only "complete" means the
 * provider itself reported a genuine, full completion. "truncated" means a
 * specific, identified non-success reason (a length cap, a content-policy
 * stop, and so on). "unknown" is the honest fallback when the connection
 * simply ended with no interpretable signal at all -- never treated as
 * success (Finding F2).
 */
export type StreamOutcome = "complete" | "truncated" | "unknown";

/**
 * The fuller vocabulary a persisted message records, extending
 * `StreamOutcome` with the two ways a turn can end that a provider's own
 * stream never reports, because the client decided them locally: "stopped"
 * (the user pressed Stop) and "failed" (an explicit error arrived after some
 * text had already streamed in). Only ever set alongside `state`, and only
 * ever read to choose which notice, if any, to show -- see
 * `noticeForOutcome()` in `MessageList.tsx`.
 */
export type MessageOutcome = StreamOutcome | "stopped" | "failed";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  state?: MessageState;
  /**
   * Why this answer ended the way it did. Only ever meaningful alongside
   * `state: "complete"` (always "complete") or `state: "interrupted"` (one of
   * "truncated" / "stopped" / "failed" / "unknown"). Absent on messages saved
   * before this existed and on every "streaming" message -- both read as "we
   * don't specifically know," which keeps old saved conversations rendering
   * exactly as they did before (see `storage.ts`'s `isMessage()` and
   * `MessageList.tsx`'s `noticeForOutcome()`).
   */
  outcome?: MessageOutcome;
  /**
   * A short, human-readable elaboration of `outcome`, supplied only when the
   * provider gave a specific, confirmed reason (e.g. "reached the length
   * limit"). Deliberately never vendor-specific vocabulary -- see the
   * `classifyFinish()`/`incompleteReason()` helpers in the two adapters.
   */
  outcomeReason?: string;
  /**
   * Which provider produced this answer. Recorded per message, not taken from
   * the conversation, so switching providers does not retroactively re-label
   * earlier answers. Absent on user messages and on anything saved before
   * multi-provider support.
   */
  provider?: ProviderId;
  /**
   * Regenerated alternates for this answer (Interaction refinement),
   * oldest first, present only once Regenerate has been used on this
   * message at least once. The top-level `content`/`state`/`outcome`/
   * `outcomeReason`/`provider` fields above always mirror whichever entry
   * `selectedVersionId` names -- so `toWire()`, `noticeForOutcome()`, and
   * every other existing consumer need no changes at all to keep working
   * unchanged; only the version-selector UI reads this field directly. See
   * `use-conversations.ts`'s `regenerate()`/`selectMessageVersion()`.
   */
  versions?: MessageVersion[];
  selectedVersionId?: string;
  /**
   * Files sent with THIS message (Interaction refinement), user messages
   * only. Metadata only -- see `AttachmentMeta`'s own comment for why the
   * raw bytes live in IndexedDB instead.
   */
  attachments?: AttachmentMeta[];
};

export type MessageVersion = {
  id: string;
  content: string;
  state?: MessageState;
  outcome?: MessageOutcome;
  outcomeReason?: string;
  provider?: ProviderId;
};

/**
 * Attachment metadata, as persisted on a `ChatMessage` and stored in
 * localStorage -- name/mimeType/kind/size ONLY, never the raw bytes
 * (deliberately: base64 image/PDF data would make localStorage's own
 * capacity trivial to exhaust). The raw bytes live in IndexedDB, keyed by
 * this same `id`; see `@/lib/attachment-storage.ts`. `id` is stable across
 * a message's whole life (through Retry/Regenerate/persistence), so it is
 * what every re-send looks the bytes back up by.
 */
export type AttachmentMeta = {
  id: string;
  name: string;
  mimeType: string;
  kind: AttachmentKind;
  size: number;
};

/** What actually travels to `/api/chat` for one attachment. */
export type WireAttachment =
  | { kind: "image"; mimeType: string; name: string; data: string }
  | { kind: "pdf"; mimeType: string; name: string; data: string }
  | { kind: "text"; mimeType: string; name: string; text: string };

/** Sent to the API. Ids and UI-only state are stripped. */
export type WireMessage = {
  role: ChatRole;
  content: string;
  attachments?: WireAttachment[];
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
  | {
      /**
       * Terminal signal for the turn. `outcome` is never omitted and never
       * guessed at the point this is sent -- the route always has a real
       * `StreamOutcome` in hand (an adapter's own reported reason, or its
       * "unknown" fallback on a bare EOF) by the time it sends this. See
       * `route.ts`.
       */
      type: "done";
      outcome: StreamOutcome;
      reason?: string;
    };

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

/**
 * Concise, accurate copy for why an answer is partial (Finding F2), keyed by
 * `MessageOutcome`. Only ever shown when `state === "interrupted"` -- see
 * `MessageList.tsx`'s `AssistantMessage`.
 *
 * `"stopped"` keeps the exact original wording ("Response interrupted.") a
 * user has already seen for Stop, unchanged. That same generic wording is
 * also the fallback for a message with no `outcome` at all -- every
 * conversation saved before this existed, and every message this build
 * itself still marks interrupted without a specific reason -- so nothing
 * about how old saved data renders changes.
 */
const OUTCOME_NOTICE: Partial<Record<MessageOutcome, string>> = {
  stopped: "Response interrupted.",
  truncated: "Response was cut short before finishing.",
  failed: "Response stopped after an error.",
  unknown: "Response may be incomplete — the connection ended unexpectedly.",
};

/**
 * The exact notice to show under a message, or null for none. `outcome` may
 * be absent (legacy saved data, or "complete") -- both cases correctly
 * produce no notice or the generic fallback rather than a crash.
 */
export function noticeForOutcome(
  state: MessageState | undefined,
  outcome: MessageOutcome | undefined,
  reason: string | undefined,
): string | null {
  if (state !== "interrupted") return null;
  if (outcome === "truncated" && reason) {
    return `Response was cut short — ${reason}.`;
  }
  return OUTCOME_NOTICE[outcome ?? "stopped"] ?? OUTCOME_NOTICE.stopped ?? null;
}

/**
 * Strips ids and UI-only state, unchanged, message for message.
 *
 * Used to shorten an oversized historical message here for the wire only,
 * silently (Finding F3's original fix). That is now removed (Finding U1,
 * independent follow-up review): a fact near the end of a long stored
 * message could quietly never reach the provider on a later turn, with
 * nothing in the UI to say a shortened copy was what was actually sent, and
 * the "whole conversation so far" wording in the switch-confirmation dialog
 * was consequently not always accurate. `validateDraft()`
 * (`@/lib/limits.ts`) now refuses to send at all, with a specific and
 * honest reason, whenever history contains a message over the per-message
 * limit -- see `use-conversations.ts`'s `send()`/`retry()`. This function no
 * longer needs to, and must not, do anything to the content it is given.
 */
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
