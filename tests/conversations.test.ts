import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveTitle, groupByRecency, isDraft, savedOnly } from "@/lib/conversations";

test("a title is derived locally from the first user message", () => {
  assert.equal(deriveTitle("How do I center a div?"), "How do I center a div");
  assert.equal(deriveTitle("   "), "New conversation");
});

test("long messages are truncated on a word boundary", () => {
  const title = deriveTitle(
    "I would like a very thorough explanation of how browser rendering pipelines work end to end",
  );
  assert.ok(title.length <= 50, `too long: ${title.length}`);
  assert.ok(title.endsWith("\u2026"));
  assert.equal(title.includes("  "), false);
});

test("conversations group into Today, Yesterday and Previous", () => {
  const now = new Date("2026-09-19T12:00:00").getTime();
  const day = 86_400_000;
  const make = (id: string, updatedAt: number) => ({
    id, title: id, providerId: "gemini" as const,
    createdAt: updatedAt, updatedAt, messages: [],
  });
  const groups = groupByRecency(
    [make("t", now - 3600_000), make("y", now - day), make("old", now - day * 6)],
    now,
  );
  assert.deepEqual(groups.map((g) => g.label), ["Today", "Yesterday", "Previous"]);
  assert.equal(groups[0].conversations[0].id, "t");
  assert.equal(groups[2].conversations[0].id, "old");
});

test("empty groups are omitted", () => {
  const now = Date.now();
  const groups = groupByRecency(
    [{ id: "a", title: "a", providerId: "gemini", createdAt: now, updatedAt: now, messages: [] }],
    now,
  );
  assert.deepEqual(groups.map((g) => g.label), ["Today"]);
});

test("newest conversations sort first within a group", () => {
  const now = Date.now();
  const make = (id: string, updatedAt: number) => ({
    id, title: id, providerId: "gemini" as const,
    createdAt: updatedAt, updatedAt, messages: [],
  });
  const [today] = groupByRecency([make("older", now - 5000), make("newer", now)], now);
  assert.deepEqual(today.conversations.map((c) => c.id), ["newer", "older"]);
});

test("a conversation with no messages is a draft and is not persisted", () => {
  const now = Date.now();
  const draft = { id: "d", title: "d", providerId: "gemini" as const, createdAt: now, updatedAt: now, messages: [] };
  const real = {
    ...draft, id: "r",
    messages: [{ id: "m", role: "user" as const, content: "hi" }],
  };
  assert.equal(isDraft(draft), true);
  assert.equal(isDraft(real), false);
  assert.deepEqual(savedOnly([draft, real]).map((c) => c.id), ["r"]);
});
