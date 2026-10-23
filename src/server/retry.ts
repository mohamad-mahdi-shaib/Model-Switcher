/**
 * One bounded retry with exponential backoff, shared by every server-side
 * call that can fail transiently.
 *
 * WHY THIS EXISTS. Fixing the extraction bug meant adding a retry in three
 * places at once -- the extraction call, the embedding call and the blob
 * read -- because all three had the same fault: a single attempt, and a
 * transient network or capacity failure presented to the user as permanent.
 * Three hand-rolled loops is three places for the policy to drift, and the
 * policy is the part that matters: WHAT gets retried is a correctness
 * question, not a style one.
 *
 * Each caller still decides its own `shouldRetry`, because only the caller
 * can tell a capacity failure from a rejected credential. What is shared is
 * the mechanics: the attempt budget, the backoff curve, the abort check, and
 * the guarantee that the final failure is rethrown unchanged rather than
 * swallowed.
 *
 * NOT used by `/api/chat`'s own retry loop. That one predates this, returns
 * HTTP responses rather than throwing, and sits on the app's most-exercised
 * path; rewriting it for tidiness would risk the core chat flow to no
 * functional benefit. It is left alone deliberately.
 */

export type RetryOptions = {
  /** Total attempts, including the first. */
  attempts: number;
  /**
   * Delay before the FIRST retry. Each subsequent wait doubles it, so
   * `baseDelayMs: 900` with 3 attempts waits 900 ms then 1,800 ms.
   */
  baseDelayMs: number;
  /**
   * Whether this failure is worth another attempt. Called for every failure,
   * including the last one, so callers can log uniformly.
   *
   * Returning false stops immediately -- repeating a rejected key or an
   * invalid request only spends quota to reach the same answer.
   */
  shouldRetry: (error: unknown, attempt: number) => boolean;
  /** Observed on every failure, before any decision. For diagnostics. */
  onFailure?: (error: unknown, attempt: number) => void;
  /** A caller who has gone away is never retried on. */
  signal?: AbortSignal;
  /** Injectable purely so tests do not spend real seconds sleeping. */
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Exponential: base, base*2, base*4 ... */
export function backoffFor(attempt: number, baseDelayMs: number): number {
  return baseDelayMs * 2 ** (attempt - 1);
}

/**
 * Runs `operation`, retrying while `shouldRetry` agrees and attempts remain.
 *
 * The error from the final attempt is rethrown as-is, so a caller's own
 * classification and messaging still apply -- this helper never invents an
 * error of its own, and never converts one failure into another.
 */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const { attempts, baseDelayMs, shouldRetry, onFailure, signal } = options;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      // An aborted caller gets the abort, immediately and unretried.
      if (signal?.aborted) throw error;

      onFailure?.(error, attempt);

      if (!shouldRetry(error, attempt) || attempt === attempts) throw error;

      await sleep(backoffFor(attempt, baseDelayMs));
    }
  }
  // Unreachable: the loop either returns or throws.
  throw lastError;
}
