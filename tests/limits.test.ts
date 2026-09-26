import { test } from "node:test";
import assert from "node:assert/strict";
import {
  draftRejectionMessage,
  hasOversizedMessage,
  MAX_CHARS,
  MAX_MESSAGES,
  validateDraft,
  type DraftRejection,
} from "@/lib/limits";

/**
 * F3/U1: `validateDraft()` is the exact function `MessageComposer.tsx` and
 * `use-conversations.ts`'s `send()`/`retry()` call to decide whether a draft
 * may be appended to history and sent at all -- not a duplicate of that
 * decision. Driving it here directly means the boundary cases (exact limit,
 * one over, an already-full conversation, an oversized historical message)
 * are covered without mounting either the composer or the hook.
 *
 * `history` below is a plain array of `{ content }` objects -- `validateDraft()`
 * only ever reads that one field, so a full `ChatMessage` is not needed here.
 */

const history = (...lengths: number[]) => lengths.map((n) => ({ content: "a".repeat(n) }));
const countOf = (n: number) => history(...Array(n).fill(1));

test("an ordinary short message is accepted", () => {
  assert.deepEqual(validateDraft("hello there", countOf(4)), { ok: true });
});

test("an empty or whitespace-only draft is rejected before any length/count check", () => {
  assert.deepEqual(validateDraft("", []), { ok: false, reason: "empty" });
  assert.deepEqual(validateDraft("   \n\t  ", []), { ok: false, reason: "empty" });
});

/* ------------------------------------------------------- character limit */

test("exactly MAX_CHARS is accepted -- the limit is inclusive", () => {
  const exact = "a".repeat(MAX_CHARS);
  assert.deepEqual(validateDraft(exact, []), { ok: true });
});

test("MAX_CHARS + 1 is rejected, reporting exactly how far over it is", () => {
  const overBy1 = "a".repeat(MAX_CHARS + 1);
  const result = validateDraft(overBy1, []);
  assert.deepEqual(result, { ok: false, reason: "tooLong", limit: MAX_CHARS, over: 1 });
});

test("a message far over the limit reports the correct overage", () => {
  const over = "a".repeat(MAX_CHARS + 250);
  const result = validateDraft(over, []) as DraftRejection;
  assert.equal(result.reason, "tooLong");
  if (result.reason !== "tooLong") return;
  assert.equal(result.over, 250);
});

test("length is measured on the trimmed content, matching what is actually sent", () => {
  const padded = `  ${"a".repeat(MAX_CHARS)}  `;
  assert.deepEqual(validateDraft(padded, []), { ok: true });
});

/* --------------------------------------------------- conversation cap */

test("a conversation below the cap accepts a new message regardless of its own length", () => {
  assert.deepEqual(validateDraft("hi", countOf(MAX_MESSAGES - 1)), { ok: true });
});

test("a conversation already at the cap refuses a new message, even a short one", () => {
  const result = validateDraft("hi", countOf(MAX_MESSAGES));
  assert.deepEqual(result, { ok: false, reason: "conversationFull", limit: MAX_MESSAGES });
});

test("a conversation over the cap (defensive) also refuses", () => {
  const result = validateDraft("hi", countOf(MAX_MESSAGES + 3));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "conversationFull");
});

/* -------------------------------------------- U1: oversized history message */
/*
 * Independent follow-up review: an earlier fix silently shortened an
 * oversized historical message for the wire only, on every send, with no
 * indication anywhere in the UI. A fact near the end of such a message could
 * quietly never reach the provider. Removed entirely -- see chat.ts's
 * toWire(), now a pure passthrough. This is what replaces it: refuse to send
 * at all, with a specific, honest reason, whenever history already contains
 * a message over the per-message limit.
 */

test("U1: hasOversizedMessage is false for ordinary history", () => {
  assert.equal(hasOversizedMessage(countOf(5)), false);
  assert.equal(hasOversizedMessage([]), false);
  assert.equal(hasOversizedMessage(history(MAX_CHARS)), false, "exactly at the limit is not oversized");
});

test("U1: hasOversizedMessage is true when any single message exceeds MAX_CHARS", () => {
  assert.equal(hasOversizedMessage(history(10, MAX_CHARS + 1, 10)), true);
});

test("U1: a conversation carrying an oversized historical message refuses any further send", () => {
  const withOversized = history(10, MAX_CHARS + 1);
  const result = validateDraft("a perfectly short follow-up", withOversized);
  assert.deepEqual(result, { ok: false, reason: "historyTooLong", limit: MAX_CHARS });
});

test("U1: the oversized-history check is reported even when the new draft is short and the conversation is not full", () => {
  // Confirms this is checked independently of the other two reasons, not as
  // a side effect of them.
  const result = validateDraft("hi", history(MAX_CHARS + 1));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "historyTooLong");
});

test("U1: oversized-history takes priority over the conversation-full reason -- one clear reason, not two", () => {
  const messages = [...history(MAX_CHARS + 1), ...countOf(MAX_MESSAGES - 1)];
  const result = validateDraft("hi", messages);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "historyTooLong");
});

test("the conversation-full check is reported even when the draft is ALSO too long -- one clear reason, not two", () => {
  const over = "a".repeat(MAX_CHARS + 10);
  const result = validateDraft(over, countOf(MAX_MESSAGES));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "conversationFull");
});

/* --------------------------------------------------------------- messages */

test("draftRejectionMessage names the actual character limit and overage", () => {
  const message = draftRejectionMessage({
    ok: false,
    reason: "tooLong",
    limit: MAX_CHARS,
    over: 42,
  });
  assert.match(message, /42/);
  assert.match(message, new RegExp(MAX_CHARS.toLocaleString()));
});

test("draftRejectionMessage names the actual conversation limit and a path forward", () => {
  const message = draftRejectionMessage({
    ok: false,
    reason: "conversationFull",
    limit: MAX_MESSAGES,
  });
  assert.match(message, new RegExp(String(MAX_MESSAGES)));
  assert.match(message, /new conversation/i);
});

test("U1: draftRejectionMessage names the actual per-message limit and a path forward for historyTooLong", () => {
  const message = draftRejectionMessage({
    ok: false,
    reason: "historyTooLong",
    limit: MAX_CHARS,
  });
  assert.match(message, new RegExp(MAX_CHARS.toLocaleString()));
  assert.match(message, /new conversation/i);
});
