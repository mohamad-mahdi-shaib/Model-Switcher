import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  checkRateLimit,
  clientKey,
  rateLimitResponse,
  RATE_LIMITS,
  resetRateLimits,
} from "@/server/rate-limit";
import { POST as documentsPost } from "@/app/api/documents/route";
import { POST as extractPost } from "@/app/api/extract/route";

/**
 * Project 4, Milestone 6: the request ceiling on the endpoints that cost
 * something.
 *
 * What is asserted here is what the limiter actually promises -- a per
 * client, per scope budget inside a sliding window, refused with a usable
 * Retry-After. What it does NOT promise (surviving a cold start, or holding
 * across instances) is documented in `rate-limit.ts` rather than tested for,
 * because it is not true.
 */

beforeEach(() => resetRateLimits());

function requestFrom(ip: string | null, url = "http://localhost/api/documents"): Request {
  return new Request(url, {
    method: "POST",
    headers: ip ? { "x-forwarded-for": ip } : {},
  });
}

/* --------------------------------------------------------- the counter -- */

test("requests are allowed up to the limit and refused after it", () => {
  const rule = RATE_LIMITS.documents;
  for (let i = 0; i < rule.limit; i += 1) {
    const result = checkRateLimit("documents", requestFrom("203.0.113.5"));
    assert.equal(result.ok, true, `request ${i + 1} of ${rule.limit} should be allowed`);
  }
  const refused = checkRateLimit("documents", requestFrom("203.0.113.5"));
  assert.equal(refused.ok, false);
});

test("the remaining budget counts down honestly", () => {
  const first = checkRateLimit("extract", requestFrom("203.0.113.6"));
  assert.equal(first.ok && first.remaining, RATE_LIMITS.extract.limit - 1);
  const second = checkRateLimit("extract", requestFrom("203.0.113.6"));
  assert.equal(second.ok && second.remaining, RATE_LIMITS.extract.limit - 2);
});

test("a refusal says when to come back, within the window", () => {
  for (let i = 0; i < RATE_LIMITS.documents.limit; i += 1) {
    checkRateLimit("documents", requestFrom("203.0.113.7"));
  }
  const refused = checkRateLimit("documents", requestFrom("203.0.113.7"));
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.ok(refused.retryAfterSeconds >= 1, "never advise retrying in zero seconds");
  assert.ok(
    refused.retryAfterSeconds <= RATE_LIMITS.documents.windowMs / 1000,
    `retry-after must be inside the window, got ${refused.retryAfterSeconds}s`,
  );
});

test("one client being refused does not affect another", () => {
  for (let i = 0; i < RATE_LIMITS.documents.limit; i += 1) {
    checkRateLimit("documents", requestFrom("203.0.113.8"));
  }
  assert.equal(checkRateLimit("documents", requestFrom("203.0.113.8")).ok, false);
  assert.equal(
    checkRateLimit("documents", requestFrom("198.51.100.2")).ok,
    true,
    "a different client has its own budget",
  );
});

test("scopes have independent budgets, so uploading does not lock out chatting", () => {
  for (let i = 0; i < RATE_LIMITS.documents.limit; i += 1) {
    checkRateLimit("documents", requestFrom("203.0.113.9"));
  }
  assert.equal(checkRateLimit("documents", requestFrom("203.0.113.9")).ok, false);
  assert.equal(checkRateLimit("chat", requestFrom("203.0.113.9")).ok, true);
  assert.equal(checkRateLimit("extract", requestFrom("203.0.113.9")).ok, true);
});

test("every scope's limit is a sane positive number inside a real window", () => {
  for (const [scope, rule] of Object.entries(RATE_LIMITS)) {
    assert.ok(rule.limit > 0, `${scope} limit must be positive`);
    assert.ok(rule.windowMs >= 1000, `${scope} window must be at least a second`);
    // A limit so low it would break ordinary use is as much a bug as none.
    assert.ok(rule.limit >= 10, `${scope} limit of ${rule.limit} would interrupt real use`);
  }
});

/* ------------------------------------------------------- identification -- */

test("the client is the FIRST x-forwarded-for entry, not an attacker-appended one", () => {
  // Later entries are proxies and are client-controllable; trusting the last
  // would let anyone pick their own bucket.
  const request = new Request("http://localhost/api/documents", {
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.10, 10.0.0.1, 10.0.0.2" },
  });
  assert.equal(clientKey(request), "203.0.113.10");
});

test("whitespace around a forwarded address does not create a separate bucket", () => {
  const padded = new Request("http://localhost/x", {
    method: "POST",
    headers: { "x-forwarded-for": "  203.0.113.11  , 10.0.0.1" },
  });
  assert.equal(clientKey(padded), "203.0.113.11");
});

test("x-real-ip is used when no forwarded header is present", () => {
  const request = new Request("http://localhost/x", {
    method: "POST",
    headers: { "x-real-ip": "203.0.113.12" },
  });
  assert.equal(clientKey(request), "203.0.113.12");
});

test("with no address at all, callers share one bucket rather than bypassing the limit", () => {
  assert.equal(clientKey(requestFrom(null)), "unknown");
  // The important half: unidentifiable callers are still limited, together.
  for (let i = 0; i < RATE_LIMITS.documents.limit; i += 1) {
    checkRateLimit("documents", requestFrom(null));
  }
  assert.equal(checkRateLimit("documents", requestFrom(null)).ok, false);
});

/* ---------------------------------------------------------- the response -- */

test("the refusal is a 429 carrying Retry-After and is never cached", async () => {
  const response = rateLimitResponse(42, "Too many uploads.");
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "42");
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  const body = (await response.json()) as { code?: string; detail?: string };
  assert.equal(body.code, "RATE_LIMITED");
  assert.match(body.detail ?? "", /Too many uploads/);
});

/* ------------------------------------------------- the routes themselves -- */

test("/api/documents refuses past its limit, before reading the body", async () => {
  const upload = () => {
    const form = new FormData();
    form.append("conversationId", "conv-1");
    form.append("file", new File(["hello"], "a.txt", { type: "text/plain" }));
    return new Request("http://localhost/api/documents", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.20" },
      body: form,
    });
  };

  for (let i = 0; i < RATE_LIMITS.documents.limit; i += 1) {
    const response = await documentsPost(upload());
    assert.notEqual(response.status, 429, `request ${i + 1} should not be limited yet`);
  }
  const limited = await documentsPost(upload());
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after") !== null, true);
  const body = (await limited.json()) as { code?: string };
  assert.equal(body.code, "RATE_LIMITED");
});

test("/api/extract refuses past its limit", async () => {
  const request = () =>
    new Request("http://localhost/api/extract", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.21" },
      body: JSON.stringify({ documentId: "A".repeat(43), conversationId: "c", schema: "invoice" }),
    });

  for (let i = 0; i < RATE_LIMITS.extract.limit; i += 1) {
    const response = await extractPost(request());
    assert.notEqual(response.status, 429);
  }
  assert.equal((await extractPost(request())).status, 429);
});

test("the limit is per client at the route level too", async () => {
  const upload = (ip: string) => {
    const form = new FormData();
    form.append("conversationId", "conv-1");
    form.append("file", new File(["hello"], "a.txt", { type: "text/plain" }));
    return new Request("http://localhost/api/documents", {
      method: "POST",
      headers: { "x-forwarded-for": ip },
      body: form,
    });
  };

  for (let i = 0; i < RATE_LIMITS.documents.limit + 1; i += 1) {
    await documentsPost(upload("203.0.113.22"));
  }
  const other = await documentsPost(upload("198.51.100.9"));
  assert.notEqual(other.status, 429, "a different client must not inherit the refusal");
});
