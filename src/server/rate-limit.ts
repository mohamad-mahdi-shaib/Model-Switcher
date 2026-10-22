/**
 * Project 4, Milestone 6: a per-client request ceiling for the endpoints
 * that cost something.
 *
 * WHAT THIS IS, PLAINLY. An in-memory sliding window, held in the process
 * that happens to serve the request. On Vercel that means it is per instance
 * and it resets on a cold start, so a determined attacker spreading requests
 * across instances is not stopped by it. It is a speed bump against runaway
 * clients, retry storms and casual abuse of an unauthenticated endpoint --
 * not a security boundary, and the README says so in those words.
 *
 * The honest alternative is a shared store (Upstash, Redis), which this
 * project deliberately does not add: it would introduce a service, a
 * credential and a failure mode for a single-user portfolio app, and
 * pretending an in-memory counter is a distributed limiter would be worse
 * than stating what it is.
 *
 * It matters most for `/api/documents` and `/api/extract`, which are
 * anonymous and each spend real provider quota -- one parses and embeds a
 * 4 MB file, the other reads a whole document through a model.
 */

export type RateLimitRule = {
  /** Requests allowed inside the window. */
  limit: number;
  windowMs: number;
};

export const RATE_LIMITS = {
  /**
   * Chat is the interactive path: a person sends a handful of messages a
   * minute, so this sits far above real use and only catches a script.
   */
  chat: { limit: 60, windowMs: 60_000 },
  /** An upload parses AND embeds every chunk. The most expensive call here. */
  documents: { limit: 12, windowMs: 5 * 60_000 },
  /** Extraction reads a whole document through a model. */
  extract: { limit: 20, windowMs: 5 * 60_000 },
  /** Image generation is billed per image. */
  images: { limit: 12, windowMs: 5 * 60_000 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitScope = keyof typeof RATE_LIMITS;

export type RateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterSeconds: number };

/** scope -> client key -> request timestamps inside the window. */
const hits = new Map<string, number[]>();

/**
 * Identifies the caller.
 *
 * `x-forwarded-for`'s FIRST entry is the client as the edge saw it; later
 * entries are proxies and are attacker-controlled, so only the first is
 * used. Everything here is trivially spoofable by a client that sets its own
 * header -- which is precisely why this is described as a speed bump. No
 * address is logged or persisted; it exists only as a map key in memory.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Drops expired entries so the map cannot grow without bound.
 *
 * Called on every check rather than on a timer: a serverless instance can be
 * frozen between requests, so a `setInterval` would not reliably run -- and
 * an unbounded map in a long-lived instance is a slow memory leak, which is
 * a more realistic failure here than the limiter itself being hit.
 */
function sweep(now: number): void {
  if (hits.size < 512) return;
  for (const [key, timestamps] of hits) {
    const newest = timestamps[timestamps.length - 1] ?? 0;
    // Nothing within any configured window can still matter.
    if (now - newest > 10 * 60_000) hits.delete(key);
  }
}

export function checkRateLimit(scope: RateLimitScope, request: Request): RateLimitResult {
  const rule = RATE_LIMITS[scope];
  const now = Date.now();
  sweep(now);

  const key = `${scope}:${clientKey(request)}`;
  const windowStart = now - rule.windowMs;
  const recent = (hits.get(key) ?? []).filter((at) => at > windowStart);

  if (recent.length >= rule.limit) {
    // How long until the OLDEST request in the window ages out -- the
    // earliest moment the next one could succeed.
    const retryAfterSeconds = Math.max(1, Math.ceil((recent[0] + rule.windowMs - now) / 1000));
    hits.set(key, recent);
    return { ok: false, retryAfterSeconds };
  }

  recent.push(now);
  hits.set(key, recent);
  return { ok: true, remaining: rule.limit - recent.length };
}

/**
 * Clears all counters.
 *
 * Exists for tests, which make many requests in seconds from one "client"
 * and would otherwise trip a limit that no real session ever would. It is
 * not reachable from any route, so it cannot be used to reset a limit from
 * outside the process.
 */
export function resetRateLimits(): void {
  hits.clear();
}

/** The 429 every rate-limited route returns, with a Retry-After header. */
export function rateLimitResponse(retryAfterSeconds: number, detail: string): Response {
  return Response.json(
    { code: "RATE_LIMITED", detail },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSeconds),
        "Cache-Control": "no-store",
      },
    },
  );
}
