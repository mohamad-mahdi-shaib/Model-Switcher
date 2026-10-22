import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { GET, POST } from "@/app/api/images/route";
import { MAX_ATTACHMENT_BYTES } from "@/lib/limits";

import { resetRateLimits } from "@/server/rate-limit";

/**
 * Project 4, Milestone 6: the routes are rate limited per client, and a
 * test file makes far more requests from one "client" in a few seconds
 * than any real session would. Counters are cleared before each test so a
 * limit meant for abuse does not make the suite's results depend on how
 * many requests the previous test happened to make.
 */
beforeEach(() => resetRateLimits());

/**
 * Project 3: route-level tests for `/api/images`, calling the real exported
 * handlers with real `Request` objects -- the same approach `tests/route.test.ts`
 * takes for `/api/chat`.
 *
 * These run with no `OPENROUTER_API_KEY` in the environment (`npm test` runs
 * node directly and never loads `.env.local`), which is deliberate: it proves
 * the whole validation layer runs BEFORE any provider is contacted, and that
 * an unconfigured server reports that honestly instead of failing obscurely.
 * No request leaves this process in any of these cases.
 */

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUg==";

function post(body: unknown): Request {
  return new Request("http://localhost/api/images", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function codeOf(response: Response): Promise<string> {
  const payload = (await response.json()) as { code?: string };
  return payload.code ?? "";
}

test("GET reports configuration without leaking any secret", async () => {
  const response = await GET();
  const payload = (await response.json()) as Record<string, unknown>;
  assert.equal(typeof payload.configured, "boolean");
  assert.equal(typeof payload.model, "string");
  assert.ok(["blob", "inline"].includes(payload.storage as string));
  // Nothing key-shaped anywhere in the probe.
  assert.doesNotMatch(JSON.stringify(payload), /sk-[A-Za-z0-9_-]{10,}/);
});

test("a body that is not JSON is refused as BAD_REQUEST", async () => {
  const response = await POST(post("{nope"));
  assert.equal(response.status, 400);
  assert.equal(await codeOf(response), "BAD_REQUEST");
});

test("a non-object body is refused", async () => {
  for (const body of ["[]", "null", "42", '"text"']) {
    const response = await POST(post(body));
    assert.equal(response.status, 400, body);
    assert.equal(await codeOf(response), "BAD_REQUEST");
  }
});

test("a request with neither a prompt nor an image is refused", async () => {
  const response = await POST(post({}));
  assert.equal(response.status, 400);
  assert.equal(await codeOf(response), "BAD_REQUEST");
});

test("an over-long prompt is refused with the limit named", async () => {
  const response = await POST(post({ prompt: "x".repeat(2_001) }));
  assert.equal(response.status, 400);
  const payload = (await response.json()) as { detail?: string };
  assert.match(payload.detail ?? "", /2,000-character limit/);
});

test("an edit with no source image is refused rather than silently generated", async () => {
  const response = await POST(post({ prompt: "make it blue", operation: "edit" }));
  assert.equal(response.status, 400);
  const payload = (await response.json()) as { detail?: string };
  assert.match(payload.detail ?? "", /^An edit needs the image it is working from\.$/);
});

test("a variation with no source image is refused for the same reason", async () => {
  const response = await POST(post({ prompt: "another take", operation: "variation" }));
  assert.equal(response.status, 400);
});

test("`images` must be an array", async () => {
  const response = await POST(post({ prompt: "a cat", images: "nope" }));
  assert.equal(response.status, 400);
});

test("an unsupported reference-image type is refused", async () => {
  const response = await POST(
    post({ prompt: "a cat", images: [{ mimeType: "image/svg+xml", data: PNG_B64 }] }),
  );
  assert.equal(response.status, 400);
  const payload = (await response.json()) as { detail?: string };
  assert.match(payload.detail ?? "", /PNG, JPEG or WebP/);
});

test("a malformed reference image is refused", async () => {
  for (const image of [{ mimeType: "image/png" }, { data: PNG_B64 }, null, "x", { mimeType: "image/png", data: "" }]) {
    const response = await POST(post({ prompt: "a cat", images: [image] }));
    assert.equal(response.status, 400, JSON.stringify(image));
  }
});

test("a reference image over the per-attachment byte limit is refused", async () => {
  // Base64 inflates by 4/3, so this decodes to just over the limit.
  const oversized = "A".repeat(Math.ceil((MAX_ATTACHMENT_BYTES + 1024) * 4) / 3);
  const response = await POST(post({ prompt: "a cat", images: [{ mimeType: "image/png", data: oversized }] }));
  assert.equal(response.status, 400);
});

test("too many reference images are refused", async () => {
  const many = Array.from({ length: 4 }, () => ({ mimeType: "image/png", data: PNG_B64 }));
  const response = await POST(post({ prompt: "a cat", images: many }));
  assert.equal(response.status, 400);
  const payload = (await response.json()) as { detail?: string };
  assert.match(payload.detail ?? "", /At most 3 reference images/);
});

test("a valid request on an unconfigured server reports MISSING_KEY, not a crash", async () => {
  // Guard: this test is only meaningful while the key really is absent.
  assert.equal(process.env.OPENROUTER_API_KEY ?? "", "", "unset OPENROUTER_API_KEY to run this suite");
  const response = await POST(post({ prompt: "a red bicycle in the rain" }));
  assert.equal(response.status, 503);
  assert.equal(await codeOf(response), "MISSING_KEY");
});

test("an error response never carries an upstream message or a stack", async () => {
  const response = await POST(post({ prompt: "a red bicycle" }));
  const body = await response.text();
  assert.doesNotMatch(body, /at .*\(/, "a stack frame leaked into the response");
  assert.doesNotMatch(body, /OPENROUTER_API_KEY=/);
});
