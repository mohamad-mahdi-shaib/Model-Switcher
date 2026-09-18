/**
 * Shared chat contract between the client and /api/chat.
 *
 * The wire format is NDJSON: one JSON object per line. That lets the server
 * report an error that only surfaces mid-stream (a quota trip partway through a
 * long answer) without having to abandon the text already delivered.
 */

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
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
  | "MODEL_BUSY"
  | "UPSTREAM"
  | "EMPTY_REPLY"
  | "NETWORK"
  | "ABORTED";

export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "error"; code: ChatErrorCode; message: string }
  | { type: "done" };

/** User-facing copy. Deliberately actionable and never blames the user. */
export const ERROR_COPY: Record<ChatErrorCode, string> = {
  MISSING_KEY:
    "Gemini is not configured. Add GEMINI_API_KEY to .env.local and restart the dev server.",
  INVALID_KEY:
    "Gemini rejected that API key. Check GEMINI_API_KEY in .env.local, then retry.",
  PROVIDER_DISABLED: "That provider is not connected yet.",
  BAD_REQUEST: "That message could not be sent. Try rephrasing it.",
  RATE_LIMIT:
    "Gemini is rate-limited right now. Wait a moment, then retry.",
  MODEL_BUSY:
    "Gemini is experiencing high demand and turned the request away. This is temporary - retry in a moment.",
  UPSTREAM: "Gemini could not complete that request.",
  EMPTY_REPLY:
    "Gemini returned an empty response. Retry, or rephrase the question.",
  NETWORK: "Could not reach the server. Check your connection, then retry.",
  ABORTED: "Stopped.",
};

export function toWire(messages: readonly ChatMessage[]): WireMessage[] {
  return messages.map(({ role, content }) => ({ role, content }));
}

let counter = 0;
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}
