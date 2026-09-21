"use client";

import type { ProviderId } from "@/lib/providers";
import type { ChatMessage } from "@/lib/chat";
export type { MessageState } from "@/lib/chat";

/**
 * Versioned localStorage persistence for conversations.
 *
 * Deliberately conservative about other people's data: unrecognised or
 * malformed payloads are NEVER overwritten automatically. If we cannot
 * understand what is in the slot, we report `corrupt`, run from memory, and
 * leave the bytes alone so nothing is silently destroyed.
 *
 * Nothing secret is ever written here. Only conversation text the user typed
 * and model replies they already saw; no keys, no credentials, and no raw
 * provider error payloads (those can echo request metadata).
 */

const KEY = "model-switcher:conversations";
const VERSION = 1;

export type Conversation = {
  id: string;
  title: string;
  providerId: ProviderId;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
};

export type PersistedState = {
  version: number;
  conversations: Conversation[];
  activeId: string | null;
};

export type StorageStatus =
  | "ok"
  | "unavailable" // no localStorage (private mode, blocked)
  | "corrupt" // present but unparseable / wrong shape — left untouched
  | "full"; // quota exceeded on write

export type LoadResult = {
  state: PersistedState | null;
  status: StorageStatus;
};

function hasStorage(): boolean {
  try {
    if (typeof window === "undefined" || !window.localStorage) return false;
    const probe = "__ms_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/** Structural validation. Anything unexpected fails the whole payload. */
function isMessage(v: unknown): v is ChatMessage {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  return (
    typeof m.id === "string" &&
    (m.role === "user" || m.role === "assistant") &&
    typeof m.content === "string" &&
    (m.state === undefined ||
      m.state === "complete" ||
      m.state === "interrupted" ||
      m.state === "streaming") &&
    // Optional: conversations saved before multi-provider support have no
    // provider on their messages, and must still load.
    (m.provider === undefined || typeof m.provider === "string")
  );
}

function isConversation(v: unknown): v is Conversation {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.id === "string" &&
    typeof c.title === "string" &&
    typeof c.providerId === "string" &&
    typeof c.createdAt === "number" &&
    typeof c.updatedAt === "number" &&
    Array.isArray(c.messages) &&
    c.messages.every(isMessage)
  );
}

export function loadConversations(): LoadResult {
  if (!hasStorage()) return { state: null, status: "unavailable" };

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return { state: null, status: "unavailable" };
  }
  if (raw === null) return { state: null, status: "ok" }; // first run

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { state: null, status: "corrupt" };
  }

  if (!parsed || typeof parsed !== "object") {
    return { state: null, status: "corrupt" };
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.version !== VERSION || !Array.isArray(obj.conversations)) {
    // A future/unknown version. Do not touch it.
    return { state: null, status: "corrupt" };
  }
  if (!obj.conversations.every(isConversation)) {
    return { state: null, status: "corrupt" };
  }

  const conversations = obj.conversations as Conversation[];
  // A reply cut off by a refresh must come back as interrupted, never as
  // still-streaming (which would show a live caret that never resolves) and
  // never silently as complete.
  for (const c of conversations) {
    for (const m of c.messages) {
      if (m.state === "streaming") m.state = "interrupted";
    }
  }

  const activeId =
    typeof obj.activeId === "string" &&
    conversations.some((c) => c.id === obj.activeId)
      ? obj.activeId
      : (conversations[0]?.id ?? null);

  return {
    state: { version: VERSION, conversations, activeId },
    status: "ok",
  };
}

/** Returns the status so callers can surface a quiet, honest warning. */
export function saveConversations(
  conversations: Conversation[],
  activeId: string | null,
): StorageStatus {
  // Deliberately NOT gated on hasStorage(): that helper probes with a write,
  // which also throws when the quota is full, so using it here would report a
  // full store as "unavailable" and give the user the wrong advice. Attempt the
  // real write and classify whatever comes back.
  if (typeof window === "undefined" || !window.localStorage) return "unavailable";
  const payload: PersistedState = { version: VERSION, conversations, activeId };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(payload));
    return "ok";
  } catch (error) {
    const name = (error as { name?: string })?.name ?? "";
    if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") {
      return "full";
    }
    return "unavailable";
  }
}

export const STORAGE_KEY = KEY;
export const STORAGE_VERSION = VERSION;
