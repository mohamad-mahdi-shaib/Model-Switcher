import { test } from "node:test";
import assert from "node:assert/strict";
import { noticeForOutcome, toWire, type ChatMessage } from "@/lib/chat";
import { MAX_CHARS } from "@/lib/limits";

/**
 * F2: the concise, accurate notice shown under a partial answer, and the
 * backward-compatibility guarantee that a message with no `outcome` at all
 * (every conversation saved before this existed) renders identically to how
 * it always did.
 */

test("a complete message gets no notice at all", () => {
  assert.equal(noticeForOutcome("complete", "complete", undefined), null);
});

test("a streaming message gets no notice", () => {
  assert.equal(noticeForOutcome("streaming", undefined, undefined), null);
});

test("Stop keeps the exact original wording", () => {
  assert.equal(noticeForOutcome("interrupted", "stopped", undefined), "Response interrupted.");
});

test("a message with no outcome at all (legacy saved data) falls back to the original wording", () => {
  assert.equal(noticeForOutcome("interrupted", undefined, undefined), "Response interrupted.");
});

test("a failed mid-stream error gets its own distinct wording", () => {
  assert.equal(noticeForOutcome("interrupted", "failed", undefined), "Response stopped after an error.");
});

test("an unknown/EOF outcome gets an honestly hedged wording", () => {
  assert.equal(
    noticeForOutcome("interrupted", "unknown", undefined),
    "Response may be incomplete — the connection ended unexpectedly.",
  );
});

test("a truncated outcome WITH a reason includes it, specifically", () => {
  assert.equal(
    noticeForOutcome("interrupted", "truncated", "reached the length limit"),
    "Response was cut short — reached the length limit.",
  );
});

test("a truncated outcome with NO reason still reads as truncated, generically", () => {
  assert.equal(
    noticeForOutcome("interrupted", "truncated", undefined),
    "Response was cut short before finishing.",
  );
});

test("every MessageOutcome value produces a non-empty notice when interrupted", () => {
  const outcomes = ["truncated", "stopped", "failed", "unknown"] as const;
  for (const outcome of outcomes) {
    const notice = noticeForOutcome("interrupted", outcome, undefined);
    assert.ok(notice && notice.length > 0, outcome);
  }
});

/* --- U1: toWire() is a pure passthrough -- it must never shorten anything -- */
/*
 * F3's original fix had toWire() silently cap an oversized historical
 * message for the wire only. An independent follow-up review (Finding U1)
 * found that this let a fact near the end of such a message quietly never
 * reach the provider on a later turn, with no indication anywhere in the UI
 * that a shortened copy was what was actually sent. Removed entirely:
 * `validateDraft()` (`@/lib/limits.ts`) now refuses to send at all, with a
 * specific reason, whenever history contains an oversized message -- see
 * `tests/limits.test.ts` and `tests/use-conversations.test.ts`. These tests
 * assert the negative: toWire() itself must never again shorten anything,
 * no matter how long a message is.
 */

const msg = (content: string): ChatMessage => ({
  id: "m",
  role: "assistant",
  content,
  state: "complete",
});

test("an ordinary message is sent completely unchanged", () => {
  const [wire] = toWire([msg("a short reply")]);
  assert.equal(wire.content, "a short reply");
});

test("U1: toWire() never shortens a message over MAX_CHARS -- no silent capping", () => {
  const original = "x".repeat(MAX_CHARS + 5000);
  const history = [msg(original)];
  const [wire] = toWire(history);
  assert.equal(wire.content, original, "the full, untouched text must reach the wire");
  assert.equal(wire.content.length, MAX_CHARS + 5000);
  assert.ok(!wire.content.includes("truncated for length"), "no truncation marker is ever inserted");
  // The source message itself is untouched either way -- toWire() must never
  // mutate what it is given.
  assert.equal(history[0].content, original);
});

test("U1: an oversized message does not affect how its neighbours are sent", () => {
  const oversized = "y".repeat(MAX_CHARS + 1);
  const wire = toWire([msg("short before"), msg(oversized), msg("short after")]);
  assert.equal(wire[0].content, "short before");
  assert.equal(wire[1].content, oversized);
  assert.equal(wire[2].content, "short after");
});

test("a message exactly at MAX_CHARS is left alone -- unaffected either way", () => {
  const exact = "z".repeat(MAX_CHARS);
  const [wire] = toWire([msg(exact)]);
  assert.equal(wire.content, exact);
});
