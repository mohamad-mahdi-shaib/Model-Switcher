import { test } from "node:test";
import assert from "node:assert/strict";
import { backoffFor, withRetry } from "@/server/retry";

/**
 * MOCKED. No provider is contacted and no real time passes: every test
 * injects its own `sleep`, so the backoff curve is asserted by recording the
 * delays rather than by waiting for them.
 *
 * These cover the retry MECHANICS -- how many calls happen, in what order,
 * with what waits. Which failures are retryable is a separate question,
 * covered in `extraction.test.ts` against real provider error payloads.
 */

/** Records what was slept instead of sleeping. */
function recorder() {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
}

/** An operation that fails `failures` times, then succeeds. */
function flaky(failures: number, error: unknown = new Error("503 UNAVAILABLE")) {
  let calls = 0;
  return {
    calls: () => calls,
    operation: async () => {
      calls += 1;
      if (calls <= failures) throw error;
      return `ok on attempt ${calls}`;
    },
  };
}

/* ------------------------------------------ a transient failure recovers -- */

test("a transient 503 followed by success returns the success", async () => {
  // The exact shape of the bug: one 503, then the model answers fine. Before
  // the fix this surfaced to the user as a permanent failure.
  const { waits, sleep } = recorder();
  const { operation, calls } = flaky(1);

  const result = await withRetry(operation, {
    attempts: 3,
    baseDelayMs: 900,
    shouldRetry: () => true,
    sleep,
  });

  assert.equal(result, "ok on attempt 2");
  assert.equal(calls(), 2, "exactly one retry, not more");
  assert.deepEqual(waits, [900], "one backoff, before the second attempt");
});

test("two transient failures still recover within the budget", async () => {
  const { waits, sleep } = recorder();
  const { operation, calls } = flaky(2);

  const result = await withRetry(operation, {
    attempts: 3,
    baseDelayMs: 900,
    shouldRetry: () => true,
    sleep,
  });

  assert.equal(result, "ok on attempt 3");
  assert.equal(calls(), 3);
  assert.deepEqual(waits, [900, 1_800], "exponential: the second wait doubles the first");
});

test("an operation that succeeds first time never sleeps", async () => {
  const { waits, sleep } = recorder();
  const { operation, calls } = flaky(0);
  assert.equal(
    await withRetry(operation, { attempts: 3, baseDelayMs: 900, shouldRetry: () => true, sleep }),
    "ok on attempt 1",
  );
  assert.equal(calls(), 1);
  assert.deepEqual(waits, []);
});

/* --------------------------------------------- the budget is a hard stop -- */

test("repeated 503s exhaust the limit and rethrow the provider's own error", async () => {
  const { waits, sleep } = recorder();
  let calls = 0;
  const upstream = new Error(
    '{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}',
  );

  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls += 1;
          throw upstream;
        },
        { attempts: 3, baseDelayMs: 900, shouldRetry: () => true, sleep },
      ),
    (error: unknown) => {
      // Rethrown UNCHANGED, so the caller's own classification still applies
      // and the helper never invents an error of its own.
      assert.equal(error, upstream);
      return true;
    },
  );

  assert.equal(calls, 3, "exactly the budget, never more");
  assert.deepEqual(waits, [900, 1_800], "no wait after the final attempt");
});

test("a budget of one attempt means no retry at all", async () => {
  const { waits, sleep } = recorder();
  let calls = 0;
  await assert.rejects(() =>
    withRetry(
      async () => {
        calls += 1;
        throw new Error("503");
      },
      { attempts: 1, baseDelayMs: 900, shouldRetry: () => true, sleep },
    ),
  );
  assert.equal(calls, 1);
  assert.deepEqual(waits, []);
});

/* -------------------------------------- a permanent failure is not retried */

test("a permanent error is attempted exactly ONCE", async () => {
  const { waits, sleep } = recorder();
  let calls = 0;
  const permanent = new Error('{"error":{"code":403,"message":"Permission denied"}}');

  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls += 1;
          throw permanent;
        },
        {
          attempts: 3,
          baseDelayMs: 900,
          // Exactly how the real callers decide: a rejected credential is
          // not worth repeating.
          shouldRetry: (error) => !/403|permission denied/i.test(String((error as Error).message)),
          sleep,
        },
      ),
    (error: unknown) => error === permanent,
  );

  assert.equal(calls, 1, "retrying a rejected key only spends quota to reach the same answer");
  assert.deepEqual(waits, [], "and never waits before giving up");
});

test("shouldRetry sees the real error and the attempt number", async () => {
  const seen: { message: string; attempt: number }[] = [];
  const { sleep } = recorder();
  await assert.rejects(() =>
    withRetry(
      async (attempt) => {
        throw new Error(`failure ${attempt}`);
      },
      {
        attempts: 3,
        baseDelayMs: 1,
        shouldRetry: (error, attempt) => {
          seen.push({ message: (error as Error).message, attempt });
          return true;
        },
        sleep,
      },
    ),
  );
  assert.deepEqual(seen, [
    { message: "failure 1", attempt: 1 },
    { message: "failure 2", attempt: 2 },
    { message: "failure 3", attempt: 3 },
  ]);
});

/* ------------------------------------------------------- diagnostics ----- */

test("every failure is reported to onFailure, including the last", async () => {
  const { sleep } = recorder();
  const observed: number[] = [];
  await assert.rejects(() =>
    withRetry(
      async () => {
        throw new Error("503");
      },
      {
        attempts: 3,
        baseDelayMs: 1,
        shouldRetry: () => true,
        onFailure: (_error, attempt) => observed.push(attempt),
        sleep,
      },
    ),
  );
  // The final failure must be logged too, or the one that actually matters
  // is the one that leaves no trace.
  assert.deepEqual(observed, [1, 2, 3]);
});

/* ------------------------------------------------------------- aborts ---- */

test("an aborted caller is never retried on", async () => {
  const { waits, sleep } = recorder();
  const controller = new AbortController();
  let calls = 0;

  await assert.rejects(() =>
    withRetry(
      async () => {
        calls += 1;
        controller.abort();
        throw new Error("aborted");
      },
      { attempts: 3, baseDelayMs: 900, shouldRetry: () => true, signal: controller.signal, sleep },
    ),
  );

  assert.equal(calls, 1, "a caller who has gone away must not be worked for");
  assert.deepEqual(waits, []);
});

/* ------------------------------------------------------------ backoff ---- */

test("the backoff curve is exponential from one base", () => {
  assert.equal(backoffFor(1, 900), 900);
  assert.equal(backoffFor(2, 900), 1_800);
  assert.equal(backoffFor(3, 900), 3_600);
  assert.equal(backoffFor(1, 200), 200);
  assert.equal(backoffFor(2, 200), 400);
});
