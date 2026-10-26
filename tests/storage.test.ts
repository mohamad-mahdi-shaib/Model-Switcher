import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

/** Fake localStorage so persistence can be tested without a browser. */
class FakeStorage {
  map = new Map<string, string>();
  throwOnSet: Error | null = null;
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    if (this.throwOnSet) throw this.throwOnSet;
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

let fake: FakeStorage;
beforeEach(() => {
  fake = new FakeStorage();
  (globalThis as Record<string, unknown>).window = { localStorage: fake };
});

const { loadConversations, saveConversations, canAutoPersist, STORAGE_KEY } =
  await import("@/lib/storage");

const conv = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Chat ${id}`,
  providerId: "gemini" as const,
  createdAt: 1,
  updatedAt: 2,
  messages: [
    { id: `${id}-u`, role: "user" as const, content: "hello", state: "complete" as const },
  ],
  ...extra,
});

/**
 * Catalogue-simplification pass: a conversation saved while Claude Sonnet 4.5
 * or Qwen2.5-VL was selectable must still load, keep every message and every
 * image attachment, and come back pointing at a model that actually exists --
 * not merely *display* as one while the stored id stays invalid.
 */
test("a conversation saved with a removed model id loads with that id migrated", () => {
  fake.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: 1,
      activeId: "a",
      conversations: [conv("a", { providerId: "or-claude" }), conv("b", { providerId: "or-qwen" })],
    }),
  );
  const { state, status } = loadConversations();
  assert.equal(status, "ok");
  assert.equal(state?.conversations[0].providerId, "gemini");
  assert.equal(state?.conversations[1].providerId, "gemini");
});

test("migrating the provider id preserves messages and image attachments", () => {
  const withImage = conv("a", {
    providerId: "or-qwen",
    messages: [
      {
        id: "a-u",
        role: "user" as const,
        content: "what is in this?",
        state: "complete" as const,
        attachments: [
          { id: "att1", name: "shot.png", mimeType: "image/png", kind: "image" as const, size: 1234 },
        ],
      },
      { id: "a-a", role: "assistant" as const, content: "a screenshot", state: "complete" as const },
    ],
  });
  fake.setItem(STORAGE_KEY, JSON.stringify({ version: 1, activeId: "a", conversations: [withImage] }));

  const { state } = loadConversations();
  const restored = state?.conversations[0];
  assert.equal(restored?.providerId, "gemini", "the dead id must not survive");
  assert.equal(restored?.messages.length, 2, "no message may be lost to the migration");
  assert.equal(restored?.messages[0].attachments?.length, 1, "the image attachment must survive");
  assert.equal(restored?.messages[0].attachments?.[0].name, "shot.png");
  assert.equal(restored?.messages[1].content, "a screenshot");
});

test("a current model is untouched, and a hidden one migrates to its equivalent", () => {
  fake.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: 1,
      activeId: "a",
      conversations: [conv("a", { providerId: "or-deepseek" }), conv("b", { providerId: "gpt" })],
    }),
  );
  const { state } = loadConversations();
  assert.equal(state?.conversations[0].providerId, "or-deepseek", "still selectable, so untouched");
  // The direct OpenAI integration is hidden while its key is rejected, so a
  // conversation on it moves to the same model reached through OpenRouter --
  // not to Gemini, and not left on an id that can no longer send.
  assert.equal(state?.conversations[1].providerId, "or-gpt");
});

test("round-trips conversations and the active id", () => {
  const status = saveConversations([conv("a"), conv("b")], "b");
  assert.equal(status, "ok");
  const { state, status: loadStatus } = loadConversations();
  assert.equal(loadStatus, "ok");
  assert.equal(state?.conversations.length, 2);
  assert.equal(state?.activeId, "b");
});

test("first run reports ok with no state", () => {
  const { state, status } = loadConversations();
  assert.equal(status, "ok");
  assert.equal(state, null);
});

test("malformed JSON is reported corrupt and LEFT UNTOUCHED", () => {
  fake.map.set(STORAGE_KEY, "{not json");
  const { state, status } = loadConversations();
  assert.equal(status, "corrupt");
  assert.equal(state, null);
  // The bytes must still be there: we never destroy data we cannot read.
  assert.equal(fake.map.get(STORAGE_KEY), "{not json");
});

test("an unknown future version is left untouched", () => {
  const future = JSON.stringify({ version: 99, conversations: [], activeId: null });
  fake.map.set(STORAGE_KEY, future);
  const { status } = loadConversations();
  assert.equal(status, "corrupt");
  assert.equal(fake.map.get(STORAGE_KEY), future);
});

test("a structurally wrong payload is rejected wholesale", () => {
  fake.map.set(
    STORAGE_KEY,
    JSON.stringify({ version: 1, conversations: [{ id: 5 }], activeId: null }),
  );
  assert.equal(loadConversations().status, "corrupt");
});

test("a reply interrupted by a refresh comes back as interrupted", () => {
  saveConversations(
    [
      conv("a", {
        messages: [
          { id: "u1", role: "user", content: "q", state: "complete" },
          { id: "a1", role: "assistant", content: "half", state: "streaming" },
        ],
      }),
    ],
    "a",
  );
  const { state } = loadConversations();
  const reply = state?.conversations[0].messages[1];
  assert.equal(reply?.state, "interrupted");
  assert.equal(reply?.content, "half", "partial text must survive");
  // F2: an honest outcome, not silently absent -- the tab closing mid-answer
  // is exactly what "unknown" means, so the restored message shows the same
  // accurate notice a live "unknown" ending would have.
  assert.equal(reply?.outcome, "unknown");
});

test("a full quota is reported, not thrown", () => {
  const err = new Error("quota");
  err.name = "QuotaExceededError";
  fake.throwOnSet = err;
  assert.equal(saveConversations([conv("a")], "a"), "full");
});

test("absent storage is reported as unavailable", () => {
  (globalThis as Record<string, unknown>).window = {};
  assert.equal(saveConversations([conv("a")], "a"), "unavailable");
  assert.equal(loadConversations().status, "unavailable");
});

test("an activeId pointing at a deleted conversation falls back safely", () => {
  fake.map.set(
    STORAGE_KEY,
    JSON.stringify({ version: 1, conversations: [conv("a")], activeId: "gone" }),
  );
  assert.equal(loadConversations().state?.activeId, "a");
});

/* ===================================================================== *
 * F1 -- persistence data-loss safety.
 *
 * Root cause 1: loadConversations() used to gate every read on hasStorage(),
 * a write-then-remove capacity probe. A store with just enough room to
 * *replace* the existing key but not enough to *also* hold a second,
 * throwaway probe key would fail that probe and report the real, perfectly
 * readable history as "unavailable" -- and a subsequent automatic save
 * (which replaces rather than adds) could then succeed, silently destroying
 * that same history. Fixed by reading with a plain getItem() that needs no
 * write capacity at all; canAutoPersist() below covers the write side.
 *
 * Root cause 2: a corrupt/unrecognised read correctly reported its own
 * status without touching the bytes, but nothing stopped the caller's next
 * scheduled save from overwriting them anyway a moment later. Fixed by
 * canAutoPersist(): the one place that decides whether an automatic save
 * may run at all, given what the load reported.
 * ===================================================================== */

test("canAutoPersist forbids writing after a corrupt or unavailable read", () => {
  assert.equal(canAutoPersist("corrupt"), false);
  assert.equal(canAutoPersist("unavailable"), false);
});

test("canAutoPersist allows writing on ok, and keeps trying through full", () => {
  assert.equal(canAutoPersist("ok"), true);
  // "full" means the most recent write attempt didn't fit, not that the read
  // was unsafe -- auto-save must keep trying so it recovers the moment space
  // frees up, rather than latching closed the way corrupt/unavailable do.
  assert.equal(canAutoPersist("full"), true);
});

test("valid history stays readable even when every write would fail (storage full)", () => {
  const payload = JSON.stringify({
    version: 1,
    conversations: [conv("a")],
    activeId: "a",
  });
  fake.map.set(STORAGE_KEY, payload);
  // Simulates a store with no spare capacity at all: ANY write -- including
  // the old write-capacity probe -- fails. The old implementation asked
  // "can I write a throwaway key?" before reading; that question now has no
  // bearing on whether the real key can be read.
  const err = new Error("quota");
  err.name = "QuotaExceededError";
  fake.throwOnSet = err;

  const { state, status } = loadConversations();
  assert.equal(status, "ok", "a readable payload must load as ok, not unavailable");
  assert.equal(state?.conversations.length, 1);
  assert.equal(state?.conversations[0].id, "a");
  assert.equal(fake.map.get(STORAGE_KEY), payload, "the read must not have written anything");
});

test("a corrupt read is never overwritten by a later automatic save", () => {
  const corrupt = "{not json, deliberately left this way";
  fake.map.set(STORAGE_KEY, corrupt);

  const { status } = loadConversations();
  assert.equal(status, "corrupt");
  // This is the exact sequence use-conversations.ts's hydration effect runs:
  // decide once, from this load, whether auto-persist may run at all.
  const blocked = !canAutoPersist(status);
  assert.equal(blocked, true);

  // Any later attempt to save -- regardless of what conversations happen to
  // be in memory at the time -- must be refused before it ever touches
  // storage. Guarded callers never call saveConversations() directly; they
  // go through persistIfAllowed() (tested against the real hook module in
  // use-conversations.test.ts), which this asserts the storage-layer half of.
  if (!blocked) saveConversations([conv("z")], "z");
  assert.equal(fake.map.get(STORAGE_KEY), corrupt, "corrupt bytes must survive untouched");
});

test("a future schema version is never overwritten by a later automatic save", () => {
  const future = JSON.stringify({ version: 99, conversations: [], activeId: null });
  fake.map.set(STORAGE_KEY, future);

  const { status } = loadConversations();
  const blocked = !canAutoPersist(status);
  assert.equal(blocked, true);
  if (!blocked) saveConversations([conv("z")], "z");
  assert.equal(fake.map.get(STORAGE_KEY), future);
});

test("a localStorage property getter that throws SecurityError is caught, not crashed on", () => {
  // Distinct from setItem/getItem throwing: some private-mode / permission-
  // restricted browsers make `window.localStorage` itself a getter that
  // raises on mere access, before any method is ever called.
  const throwingWindow = {};
  Object.defineProperty(throwingWindow, "localStorage", {
    get() {
      const err = new Error("blocked");
      err.name = "SecurityError";
      throw err;
    },
  });
  (globalThis as Record<string, unknown>).window = throwingWindow;

  assert.doesNotThrow(() => {
    const { state, status } = loadConversations();
    assert.equal(status, "unavailable");
    assert.equal(state, null);
  });
  assert.doesNotThrow(() => {
    assert.equal(saveConversations([conv("a")], "a"), "unavailable");
  });
});

test("normal restore-then-save still round-trips (happy path unaffected by the fix)", () => {
  const first = loadConversations();
  assert.equal(first.status, "ok");
  assert.equal(first.state, null, "first run has nothing saved yet");

  const blocked = !canAutoPersist(first.status);
  assert.equal(blocked, false);

  const saveResult = saveConversations([conv("a"), conv("b")], "b");
  assert.equal(saveResult, "ok");

  const second = loadConversations();
  assert.equal(second.status, "ok");
  assert.equal(second.state?.conversations.length, 2);
  assert.equal(second.state?.activeId, "b");
});

/* ===================================================================== *
 * F2 -- schema compatibility for the new outcome fields.
 * ===================================================================== */

test("F2: a message with no outcome field at all (every conversation saved before this existed) still loads", () => {
  const payload = JSON.stringify({
    version: 1,
    activeId: "a",
    conversations: [
      conv("a", {
        messages: [
          { id: "u1", role: "user", content: "q", state: "complete" },
          { id: "a1", role: "assistant", content: "an old saved answer", state: "complete" },
        ],
      }),
    ],
  });
  fake.map.set(STORAGE_KEY, payload);
  const { status, state } = loadConversations();
  assert.equal(status, "ok");
  assert.equal(state?.conversations[0].messages[1].content, "an old saved answer");
  assert.equal(state?.conversations[0].messages[1].outcome, undefined);
});

test("F2: valid outcome and outcomeReason values round-trip", () => {
  const status = saveConversations(
    [
      conv("a", {
        messages: [
          { id: "u1", role: "user", content: "q", state: "complete" },
          {
            id: "a1",
            role: "assistant",
            content: "cut off",
            state: "interrupted",
            outcome: "truncated",
            outcomeReason: "reached the length limit",
          },
        ],
      }),
    ],
    "a",
  );
  assert.equal(status, "ok");
  const { state } = loadConversations();
  const reply = state?.conversations[0].messages[1];
  assert.equal(reply?.outcome, "truncated");
  assert.equal(reply?.outcomeReason, "reached the length limit");
});

test("F2: an invalid outcome value rejects the whole payload, exactly like any other malformed field", () => {
  const payload = JSON.stringify({
    version: 1,
    activeId: "a",
    conversations: [
      conv("a", {
        messages: [
          { id: "u1", role: "user", content: "q", state: "complete" },
          { id: "a1", role: "assistant", content: "x", state: "interrupted", outcome: "not-a-real-value" },
        ],
      }),
    ],
  });
  fake.map.set(STORAGE_KEY, payload);
  assert.equal(loadConversations().status, "corrupt");
  assert.equal(fake.map.get(STORAGE_KEY), payload, "rejected payloads are left untouched (F1)");
});

/* ------------------------------------- Project 4: documents on a conversation */

/**
 * Document METADATA is persisted on its conversation; the parsed text and
 * embeddings never are (they live in blob storage, keyed by the id). These
 * cover the additive-field contract that every optional addition to this
 * schema has to honour: old payloads still load, and a malformed new field
 * fails the whole payload rather than loading a chip that points nowhere.
 */

const docRef = (extra: Record<string, unknown> = {}) => ({
  id: "A".repeat(43),
  filename: "report.pdf",
  kind: "pdf",
  bytes: 120_000,
  sections: 12,
  meta: { chars: 48_000, truncated: false, pages: 12 },
  warnings: [],
  uploadedAt: 1_700_000_000_000,
  ...extra,
});

test("P4: a conversation's uploaded documents round-trip", () => {
  const documents = [docRef(), docRef({ id: "B".repeat(43), filename: "books.xlsx", kind: "xlsx" })];
  assert.equal(saveConversations([conv("a", { documents })], "a"), "ok");
  const { state, status } = loadConversations();
  assert.equal(status, "ok");
  assert.equal(state?.conversations[0].documents?.length, 2);
  assert.equal(state?.conversations[0].documents?.[1].filename, "books.xlsx");
});

test("P4: a conversation saved before documents existed still loads", () => {
  fake.setItem(
    STORAGE_KEY,
    JSON.stringify({ version: 1, activeId: "a", conversations: [conv("a")] }),
  );
  const { state, status } = loadConversations();
  assert.equal(status, "ok");
  assert.equal(state?.conversations[0].documents, undefined);
});

test("P4: an empty documents array is valid", () => {
  fake.setItem(
    STORAGE_KEY,
    JSON.stringify({ version: 1, activeId: "a", conversations: [conv("a", { documents: [] })] }),
  );
  assert.equal(loadConversations().status, "ok");
});

test("P4: an id that could not be a real capability is corruption, not data", () => {
  // The shape check matters: a value like this can only come from tampering
  // or from a format that no longer exists, and silently keeping it would
  // leave a chip in the UI that no server call could ever resolve.
  for (const id of ["doc-1", "../../secret", "short", "A".repeat(200)]) {
    fake.map.clear();
    fake.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        activeId: "a",
        conversations: [conv("a", { documents: [docRef({ id })] })],
      }),
    );
    assert.equal(loadConversations().status, "corrupt", `should reject id: ${id}`);
  }
});

test("P4: a malformed document entry fails the whole payload", () => {
  const bad = [
    docRef({ kind: "exe" }),
    docRef({ meta: undefined }),
    docRef({ meta: { truncated: false } }),
    docRef({ meta: { chars: 1, truncated: "no" } }),
    docRef({ sections: "12" }),
    docRef({ warnings: "none" }),
    docRef({ warnings: [1, 2] }),
    docRef({ filename: 5 }),
    docRef({ uploadedAt: "yesterday" }),
    null,
    "a string",
  ];
  for (const entry of bad) {
    fake.map.clear();
    fake.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        activeId: "a",
        conversations: [conv("a", { documents: [entry] })],
      }),
    );
    assert.equal(
      loadConversations().status,
      "corrupt",
      `should reject entry: ${JSON.stringify(entry)}`,
    );
  }
});

test("P4: a document's own warnings survive, so a truncated file never looks complete", () => {
  const documents = [
    docRef({
      warnings: ["Only the first 5,000 rows of Sheet1 were read."],
      meta: { chars: 1_500_000, truncated: true, rows: 5_000 },
    }),
  ];
  assert.equal(saveConversations([conv("a", { documents })], "a"), "ok");
  const loaded = loadConversations().state?.conversations[0].documents?.[0];
  assert.equal(loaded?.meta.truncated, true);
  assert.match(loaded?.warnings[0] ?? "", /first 5,000 rows/);
});
