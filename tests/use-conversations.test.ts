import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

/**
 * F1 and F2 regression tests against the actual conversation hook module.
 *
 * `useConversations()` itself is a React hook (useState/useEffect/useRef) and
 * this project's test suite has no React renderer or DOM available -- adding
 * one was out of scope for both fixes. Mounting the hook through a real
 * render is therefore not exercised here; that gap is disclosed, not hidden.
 * These are module-level tests against exported pure functions, not a
 * mounted-hook integration test -- see `docs/requirements-audit.md` for the
 * same distinction drawn explicitly for the record.
 *
 * F1 (persistence): what IS exercised here is the real, unmodified logic the
 * hook's hydration effect and `flush()` actually run: this file imports
 * `persistIfAllowed()` directly from `@/lib/use-conversations` -- not a
 * reimplementation of it. `flush()` in the hook calls this exact function and
 * nothing else to decide what to write, so driving it here with the same
 * inputs the hook's own refs would hold is driving the real decision, just
 * without a mounted tree around it. `canAutoPersist()` and the storage
 * read/write functions it calls come from the real, unmodified `@/lib/storage`
 * for the same reason.
 *
 * Verified by reading `src/lib/use-conversations.ts` (not merely assumed):
 * the throttled scheduled save (`schedulePersist` -> its `setTimeout` ->
 * `flush()`), the `visibilitychange` handler, the `pagehide` handler, and
 * that same effect's unmount cleanup function all call `flush()` and nothing
 * else that could reach storage. `flush()` calls `persistIfAllowed()` and
 * nothing else that could reach storage. There is exactly one path from any
 * of those four trigger points to an actual write, and this file drives it
 * directly, once per trigger point, in the tests below.
 *
 * F2 (terminal outcome): the same principle applies to `settleRun()`, also
 * imported directly from `@/lib/use-conversations`. `run()`'s three real exit
 * paths -- the NDJSON read loop ending normally, a mid-stream `error` event,
 * and the fetch throwing `AbortError` -- each call `settleRun()` and nothing
 * else to decide the settled patch; see the "F2" section below.
 */

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

const { canAutoPersist, loadConversations, STORAGE_KEY } = await import(
  "@/lib/storage"
);
const { persistIfAllowed, settleRun } = await import("@/lib/use-conversations");

const conv = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Chat ${id}`,
  providerId: "gemini" as const,
  createdAt: 1,
  updatedAt: 2,
  messages: [
    { id: `${id}-u`, role: "user" as const, content: "hi", state: "complete" as const },
  ],
  ...extra,
});

/** What the real hydration effect does with a load's status, in one line. */
function decideBlocked(status: string): boolean {
  return !canAutoPersist(status as Parameters<typeof canAutoPersist>[0]);
}

/* ------------------------------------------------------- normal operation */

test("normal restoration and saving: an ok load allows a real save", () => {
  const { status } = loadConversations();
  assert.equal(status, "ok");
  const blocked = decideBlocked(status);
  assert.equal(blocked, false);

  const result = persistIfAllowed(blocked, [conv("a")], "a");
  assert.equal(result, "ok");
  assert.ok(fake.map.get(STORAGE_KEY)?.includes('"a"'), "the real save must have run");
});

test("a message arriving mid-stream persists normally when nothing is blocked", () => {
  // Mirrors what schedulePersist() -> flush() does on every throttled tick
  // while a reply is streaming in: call persistIfAllowed again with the
  // latest in-memory conversations.
  const blocked = decideBlocked(loadConversations().status);
  persistIfAllowed(blocked, [conv("a", { messages: [] })], "a");
  const grown = persistIfAllowed(
    blocked,
    [conv("a", { messages: [{ id: "a-1", role: "assistant", content: "partial answer" }] })],
    "a",
  );
  assert.equal(grown, "ok");
  assert.ok(fake.map.get(STORAGE_KEY)?.includes("partial answer"));
});

/* --------------------------------------------- corrupt / unknown version */

test("corrupt JSON: hydration blocks every subsequent automatic save for the session", () => {
  const corrupt = "{not json, deliberately";
  fake.map.set(STORAGE_KEY, corrupt);

  const { status } = loadConversations();
  assert.equal(status, "corrupt");
  const blocked = decideBlocked(status);
  assert.equal(blocked, true);

  const result = persistIfAllowed(blocked, [conv("z")], "z");
  assert.equal(result, "blocked");
  assert.equal(fake.map.get(STORAGE_KEY), corrupt, "corrupt bytes must be untouched");
});

test("future schema version: hydration blocks every subsequent automatic save for the session", () => {
  const future = JSON.stringify({ version: 99, conversations: [], activeId: null });
  fake.map.set(STORAGE_KEY, future);

  const { status } = loadConversations();
  const blocked = decideBlocked(status);
  assert.equal(blocked, true);

  const result = persistIfAllowed(blocked, [conv("z")], "z");
  assert.equal(result, "blocked");
  assert.equal(fake.map.get(STORAGE_KEY), future);
});

test("blocked auto-persist still lets the app run: repeated saves keep returning blocked, never throw", () => {
  fake.map.set(STORAGE_KEY, "{not json");
  const blocked = decideBlocked(loadConversations().status);
  // A user can keep chatting in memory while blocked (requirement: preserve
  // normal chat use). Each of these represents one more message arriving.
  for (let i = 0; i < 5; i++) {
    const result = persistIfAllowed(blocked, [conv(`z${i}`)], `z${i}`);
    assert.equal(result, "blocked");
  }
  assert.equal(fake.map.get(STORAGE_KEY), "{not json", "never overwritten, across every attempt");
});

/* ------------------------------------------------- valid history at quota */

test("valid history at storage capacity: stays readable, and auto-persist stays ON (not blocked)", () => {
  const payload = JSON.stringify({
    version: 1,
    conversations: [conv("a")],
    activeId: "a",
  });
  fake.map.set(STORAGE_KEY, payload);
  // No headroom at all: any write, including the old write-capacity probe,
  // would have failed.
  const err = new Error("quota");
  err.name = "QuotaExceededError";
  fake.throwOnSet = err;

  const { state, status } = loadConversations();
  assert.equal(status, "ok");
  assert.equal(state?.conversations[0].id, "a", "existing history must actually be restored");

  const blocked = decideBlocked(status);
  assert.equal(blocked, false, "a readable payload must not trip the corrupt/unavailable block");

  // Auto-persist is allowed to try -- and here it legitimately fails on
  // capacity, which is "full", not "blocked". The two must not be conflated:
  // "full" is an ordinary, recoverable, ongoing write condition; "blocked" is
  // the F1 safety gate refusing to touch storage at all.
  const attempt = persistIfAllowed(blocked, [conv("a")], "a");
  assert.equal(attempt, "full");
  assert.equal(fake.map.get(STORAGE_KEY), payload, "a failed write must not have corrupted the existing bytes");
});

/* ------------------------------------------------------ SecurityError getter */

test("a throwing localStorage getter: hydration reports unavailable and blocks saves, without crashing", () => {
  const throwingWindow = {};
  Object.defineProperty(throwingWindow, "localStorage", {
    get() {
      const err = new Error("blocked");
      err.name = "SecurityError";
      throw err;
    },
  });
  (globalThis as Record<string, unknown>).window = throwingWindow;

  const { state, status } = loadConversations();
  assert.equal(status, "unavailable");
  assert.equal(state, null);

  const blocked = decideBlocked(status);
  assert.equal(blocked, true);

  assert.doesNotThrow(() => {
    const result = persistIfAllowed(blocked, [conv("a")], "a");
    assert.equal(result, "blocked");
  });
});

/* --------------------------- scheduled + visibility + pagehide + unmount */

test("scheduled tick, visibilitychange, pagehide and unmount cleanup all refuse to write after a failed restore", () => {
  const corrupt = "{not json";
  fake.map.set(STORAGE_KEY, corrupt);
  const blocked = decideBlocked(loadConversations().status);
  assert.equal(blocked, true);

  // Each call below stands in for one of the four real trigger points that
  // call flush() in src/lib/use-conversations.ts: the throttled
  // schedulePersist() timer, the "visibilitychange" listener, the
  // "pagehide" listener, and the lifecycle effect's own cleanup/unmount
  // function. All four call flush(), and flush() calls only this.
  const scheduledTick = persistIfAllowed(blocked, [conv("a")], "a");
  const visibilityChange = persistIfAllowed(blocked, [conv("a"), conv("b")], "b");
  const pagehide = persistIfAllowed(blocked, [conv("a"), conv("b"), conv("c")], "c");
  const unmountCleanup = persistIfAllowed(blocked, [conv("a")], "a");

  for (const result of [scheduledTick, visibilityChange, pagehide, unmountCleanup]) {
    assert.equal(result, "blocked");
  }
  assert.equal(fake.map.get(STORAGE_KEY), corrupt, "no trigger point may have written anything, ever");
});

/* ===================================================================== *
 * F2 -- normalized terminal outcome, settleRun().
 *
 * settleRun(opened, ending) is the exact function run()'s three exit paths
 * call to decide how a turn settles. These tests drive it directly with the
 * same inputs those three real exit paths construct, covering every case
 * from the finding: normal completion, OpenAI/Gemini truncation (already
 * normalized to "truncated" by the time it reaches the client -- see
 * tests/openai.test.ts and tests/gemini.test.ts for that half), an upstream
 * EOF with no terminal signal, a client-side EOF with no done event at all,
 * a mid-stream error with and without prior text, Stop with and without
 * prior text, and a completed stream with no usable text.
 * ===================================================================== */

test("F2: normal completion settles complete only when doneOutcome is confirmed complete", () => {
  const settlement = settleRun(true, { kind: "loopEnded", doneOutcome: "complete" });
  assert.deepEqual(settlement, { kind: "complete" });
});

test("F2: a truncated outcome settles interrupted, carrying the reason through untouched", () => {
  const settlement = settleRun(true, {
    kind: "loopEnded",
    doneOutcome: "truncated",
    doneReason: "reached the length limit",
  });
  assert.deepEqual(settlement, {
    kind: "interrupted",
    outcome: "truncated",
    reason: "reached the length limit",
  });
});

test("F2: a truncated outcome with no reason still settles interrupted, reason left undefined", () => {
  const settlement = settleRun(true, { kind: "loopEnded", doneOutcome: "truncated" });
  assert.deepEqual(settlement, { kind: "interrupted", outcome: "truncated", reason: undefined });
});

test("F2: an unknown outcome (the server's own EOF fallback) settles interrupted, never complete", () => {
  const settlement = settleRun(true, { kind: "loopEnded", doneOutcome: "unknown" });
  assert.deepEqual(settlement, { kind: "interrupted", outcome: "unknown", reason: undefined });
});

test("F2: a client-side EOF with no done event at all settles exactly like outcome:unknown", () => {
  // doneOutcome is null here -- the read loop ended without this turn ever
  // having received a "done" line on the wire, as distinct from the server
  // sending one that explicitly says "unknown". Both must settle identically:
  // neither is evidence the answer finished normally.
  const withNoDoneEvent = settleRun(true, { kind: "loopEnded", doneOutcome: null });
  const withExplicitUnknown = settleRun(true, { kind: "loopEnded", doneOutcome: "unknown" });
  assert.deepEqual(withNoDoneEvent, withExplicitUnknown);
  assert.deepEqual(withNoDoneEvent, { kind: "interrupted", outcome: "unknown", reason: undefined });
});

test("F2: a mid-stream error after text arrived settles interrupted with outcome failed, keeping the text", () => {
  const settlement = settleRun(true, {
    kind: "streamError",
    code: "MODEL_BUSY",
    info: { retryAfterSeconds: 5 },
  });
  // "interrupted" (not "fail") is exactly what tells the caller to keep the
  // message row and its content rather than remove it. code/info are also
  // carried through: applySettlement() uses them to still show the
  // actionable error banner with Retry alongside the per-message notice --
  // exactly what happened before F2, which must not regress just because the
  // message itself is now correctly marked interrupted instead of stuck at
  // state:"streaming".
  assert.deepEqual(settlement, {
    kind: "interrupted",
    outcome: "failed",
    code: "MODEL_BUSY",
    info: { retryAfterSeconds: 5 },
  });
});

test("F2: a mid-stream error before any text arrived settles as a failure, not an interrupted message", () => {
  const settlement = settleRun(false, {
    kind: "streamError",
    code: "MODEL_BUSY",
    info: { retryAfterSeconds: 5 },
  });
  assert.deepEqual(settlement, { kind: "fail", code: "MODEL_BUSY", info: { retryAfterSeconds: 5 } });
});

test("F2: Stop after text arrived settles interrupted with outcome stopped", () => {
  const settlement = settleRun(true, { kind: "aborted" });
  assert.deepEqual(settlement, { kind: "interrupted", outcome: "stopped" });
});

test("F2: Stop before any text arrived is a no-op -- there is no message row to patch", () => {
  const settlement = settleRun(false, { kind: "aborted" });
  assert.deepEqual(settlement, { kind: "noop" });
});

test("F2: a completed stream with no usable text settles as an empty reply", () => {
  const settlement = settleRun(false, { kind: "loopEnded", doneOutcome: "complete" });
  assert.deepEqual(settlement, { kind: "emptyReply" });
});

test("F2: settleRun never returns kind:complete unless opened is true and doneOutcome is exactly complete", () => {
  // Exhaustive sweep: complete is the rarest possible outcome, not the
  // default -- every other combination must settle some other way.
  const outcomes: Array<"complete" | "truncated" | "unknown" | null> = [
    "complete",
    "truncated",
    "unknown",
    null,
  ];
  for (const opened of [true, false]) {
    for (const doneOutcome of outcomes) {
      const settlement = settleRun(opened, { kind: "loopEnded", doneOutcome });
      const isComplete = settlement.kind === "complete";
      const shouldBeComplete = opened && doneOutcome === "complete";
      assert.equal(isComplete, shouldBeComplete, `opened=${opened} doneOutcome=${doneOutcome}`);
    }
  }
});

test("F2: settleRun never attaches error code/info to Stop or a provider-reported truncation", () => {
  // Only a genuine mid-stream error may ever carry code/info -- Stop and a
  // provider's own confirmed truncation are not error conditions and must
  // never trigger the top-level error banner.
  const stopped = settleRun(true, { kind: "aborted" });
  const truncated = settleRun(true, { kind: "loopEnded", doneOutcome: "truncated" });
  const unknown = settleRun(true, { kind: "loopEnded", doneOutcome: "unknown" });
  for (const settlement of [stopped, truncated, unknown]) {
    assert.equal(
      settlement.kind === "interrupted" ? "code" in settlement : false,
      false,
    );
  }
});
