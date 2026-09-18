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

const { loadConversations, saveConversations, STORAGE_KEY } = await import(
  "@/lib/storage"
);

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
