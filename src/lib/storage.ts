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
 * That guarantee used to be false in practice (tracked as Finding F1): this
 * module's own read never wrote anything, but nothing stopped the caller's
 * *next* scheduled save from overwriting the very bytes this module had just
 * refused to touch. Two things fixed it, both here:
 *   - `loadConversations()` no longer gates its read on a write-capacity
 *     probe. The old probe (`hasStorage()`) wrote and removed a throwaway
 *     key before every read, which needs strictly MORE headroom than reading
 *     the real key needs. A store that was full enough to fail the probe but
 *     still held perfectly readable history was reported `unavailable`
 *     without ever being read -- and a caller's later `saveConversations([])`
 *     could then succeed (a same-key replace needs less room than an
 *     add-then-remove), silently wiping still-good data. Reading now only
 *     ever needs `getItem`, which needs no write capacity at all.
 *   - `canAutoPersist()` below is the one place that decides whether an
 *     automatic save may run at all, given what the load reported. Callers
 *     (see `use-conversations.ts`) must consult it once, right after
 *     hydration, and hold that answer for the rest of the session rather
 *     than re-deciding on every save -- re-deciding per save is exactly what
 *     let a `corrupt` read's status be displayed correctly while an
 *     unrelated save call still went ahead and overwrote the bytes anyway.
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

/**
 * Safe access to `window.localStorage` itself, not just its methods.
 *
 * The property access can throw on its own, before any method is even
 * called: some private-mode / permission-restricted browsers implement
 * `localStorage` as a getter that raises a `SecurityError`. Every caller
 * below goes through this rather than touching `window.localStorage`
 * directly, so that failure is caught here once instead of needing its own
 * try/catch at every call site (a bare, unguarded `!window.localStorage`
 * check used to let exactly this escape uncaught out of `saveConversations`).
 */
function getStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

const MESSAGE_STATES = ["complete", "interrupted", "streaming"] as const;
const MESSAGE_OUTCOMES = ["complete", "truncated", "stopped", "failed", "unknown"] as const;

/**
 * A regenerated alternate (Interaction refinement) -- the same shape check
 * as the fields already validated on `ChatMessage` itself below, minus
 * `role`, since a version has no role of its own (it always belongs to
 * whichever assistant message holds it).
 */
function isMessageVersion(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const version = v as Record<string, unknown>;
  return (
    typeof version.id === "string" &&
    typeof version.content === "string" &&
    (version.state === undefined || (MESSAGE_STATES as readonly unknown[]).includes(version.state)) &&
    (version.provider === undefined || typeof version.provider === "string") &&
    (version.outcome === undefined || (MESSAGE_OUTCOMES as readonly unknown[]).includes(version.outcome)) &&
    (version.outcomeReason === undefined || typeof version.outcomeReason === "string")
  );
}

const ATTACHMENT_KINDS = ["image", "pdf", "text"] as const;

const IMAGE_OPERATIONS = ["generate", "edit", "variation"] as const;

/**
 * Project 3: a generated-image reference as persisted on an assistant
 * message. Validated field by field like every other optional addition --
 * one malformed entry must fail the payload rather than load half-formed.
 */
function isGeneratedImageRef(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const g = v as Record<string, unknown>;
  return (
    typeof g.url === "string" &&
    typeof g.mediaType === "string" &&
    typeof g.prompt === "string" &&
    typeof g.model === "string" &&
    (IMAGE_OPERATIONS as readonly unknown[]).includes(g.operation) &&
    typeof g.persisted === "boolean"
  );
}

/**
 * Attachment METADATA (Interaction refinement) -- name/mimeType/kind/size
 * only, exactly what `AttachmentMeta` persists. The raw bytes live in
 * IndexedDB, not localStorage, and are not this validator's concern.
 */
function isAttachmentMeta(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const a = v as Record<string, unknown>;
  return (
    typeof a.id === "string" &&
    typeof a.name === "string" &&
    typeof a.mimeType === "string" &&
    (ATTACHMENT_KINDS as readonly unknown[]).includes(a.kind) &&
    typeof a.size === "number"
  );
}

/** Structural validation. Anything unexpected fails the whole payload. */
function isMessage(v: unknown): v is ChatMessage {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  return (
    typeof m.id === "string" &&
    (m.role === "user" || m.role === "assistant") &&
    typeof m.content === "string" &&
    (m.state === undefined || (MESSAGE_STATES as readonly unknown[]).includes(m.state)) &&
    // Optional: conversations saved before multi-provider support have no
    // provider on their messages, and must still load.
    (m.provider === undefined || typeof m.provider === "string") &&
    // F2: optional outcome fields recording WHY a non-complete answer ended
    // the way it did. Absent on every message saved before this existed --
    // both checks short-circuit on `undefined`, so old saved conversations
    // validate and load exactly as they always have.
    (m.outcome === undefined || (MESSAGE_OUTCOMES as readonly unknown[]).includes(m.outcome)) &&
    (m.outcomeReason === undefined || typeof m.outcomeReason === "string") &&
    // Interaction refinement: Regenerate's version history. Absent on every
    // message saved before this existed, and on any message never
    // regenerated -- both short-circuit on `undefined`, so nothing about
    // existing saved data changes.
    (m.versions === undefined || (Array.isArray(m.versions) && m.versions.every(isMessageVersion))) &&
    (m.selectedVersionId === undefined || typeof m.selectedVersionId === "string") &&
    // Interaction refinement: same optional-field pattern as versions above
    // -- absent on every message saved before attachments existed, and on
    // any message that never had one.
    (m.attachments === undefined || (Array.isArray(m.attachments) && m.attachments.every(isAttachmentMeta))) &&
    // Project 3: generated images. Absent on every message saved before it.
    (m.images === undefined || (Array.isArray(m.images) && m.images.every(isGeneratedImageRef)))
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
  const storage = getStorage();
  if (!storage) return { state: null, status: "unavailable" };

  let raw: string | null;
  try {
    raw = storage.getItem(KEY);
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
  // never silently as complete. F2: it also gets an honest outcome -- the tab
  // simply closed mid-answer, which is exactly what "unknown" means, so the
  // restored message shows the same accurate notice a live "unknown" ending
  // would have. Only set when not already present, though in practice a
  // message saved as "streaming" never already carries one.
  for (const c of conversations) {
    for (const m of c.messages) {
      if (m.state === "streaming") {
        m.state = "interrupted";
        if (!m.outcome) m.outcome = "unknown";
      }
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
  // Attempts the real write unconditionally and classifies whatever comes
  // back, rather than probing first: a probe write would itself throw when
  // the quota is full, which would misreport a full store as "unavailable"
  // and give the wrong advice. getStorage() still guards the property access
  // itself (see its own comment) without adding a probe write.
  const storage = getStorage();
  if (!storage) return "unavailable";
  const payload: PersistedState = { version: VERSION, conversations, activeId };
  try {
    storage.setItem(KEY, JSON.stringify(payload));
    return "ok";
  } catch (error) {
    const name = (error as { name?: string })?.name ?? "";
    if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") {
      return "full";
    }
    return "unavailable";
  }
}

/**
 * Whether an automatic save may run, given what the load right before it
 * reported.
 *
 * `corrupt` and `unavailable` both mean the same thing for this purpose: we
 * do not reliably know what is really stored right now, so writing
 * automatically risks destroying something we never actually read. `ok` and
 * `full` are both safe to keep auto-saving through -- `full` only means the
 * most recent attempt didn't fit, not that the read was unsafe, and saving
 * should keep trying so it recovers the moment space frees up.
 *
 * Callers must call this once, right after the load that produced
 * `loadStatus`, and hold the answer for the rest of the session (see
 * `use-conversations.ts`). Re-deciding on every later save would defeat the
 * point: a save many minutes later has no way to know the very first load
 * this session was one this function would have refused.
 */
export function canAutoPersist(loadStatus: StorageStatus): boolean {
  return loadStatus !== "corrupt" && loadStatus !== "unavailable";
}

export const STORAGE_KEY = KEY;
export const STORAGE_VERSION = VERSION;
