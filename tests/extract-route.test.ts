import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { GET, POST } from "@/app/api/extract/route";

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
 * Project 4: route-level tests for `/api/extract`.
 *
 * Throughout the configured block `globalThis.fetch` throws, so the network
 * isolation is fail-closed: every case here must be decided by validation or
 * by the document store declining, never by a call to the extraction model.
 * A test that accidentally reached Gemini would fail loudly rather than
 * quietly spend quota.
 *
 * The access-control case matters most. A well-formed but unknown document
 * id must come back as the SAME 404 a document belonging to another
 * conversation gets -- if the two differed, this endpoint would become an
 * oracle for which document ids exist.
 */

const KEY_ENV = "GEMINI_API_KEY";
const TOKEN_ENV = "BLOB_READ_WRITE_TOKEN";
const DOCUMENT_ID = "A".repeat(43);

function post(body: unknown): Request {
  return new Request("http://localhost/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function payloadOf(response: Response): Promise<{ code?: string; detail?: string }> {
  return (await response.json()) as { code?: string; detail?: string };
}

async function withSealedConfig(body: () => Promise<void>): Promise<void> {
  const previous = { key: process.env[KEY_ENV], token: process.env[TOKEN_ENV] };
  const realFetch = globalThis.fetch;
  process.env[KEY_ENV] = "placeholder-not-a-real-key";
  delete process.env[TOKEN_ENV];
  globalThis.fetch = (() => {
    throw new Error("network access attempted -- extraction must be decided before any model call");
  }) as typeof fetch;
  try {
    await body();
  } finally {
    globalThis.fetch = realFetch;
    if (previous.key === undefined) delete process.env[KEY_ENV];
    else process.env[KEY_ENV] = previous.key;
    if (previous.token === undefined) delete process.env[TOKEN_ENV];
    else process.env[TOKEN_ENV] = previous.token;
  }
}

test("GET reports capability as a boolean and leaks nothing", async () => {
  const response = await GET();
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(typeof body.configured, "boolean");
  assert.doesNotMatch(JSON.stringify(body), /AIza|sk-|vercel_blob_rw_/);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
});

test("an unconfigured server names the variable, not a value", async () => {
  const previous = process.env[KEY_ENV];
  delete process.env[KEY_ENV];
  try {
    const response = await POST(
      post({ documentId: DOCUMENT_ID, conversationId: "conv-1", schema: "invoice" }),
    );
    assert.equal(response.status, 503);
    const body = await payloadOf(response);
    assert.equal(body.code, "NOT_CONFIGURED");
    assert.match(body.detail ?? "", /GEMINI_API_KEY/);
  } finally {
    if (previous !== undefined) process.env[KEY_ENV] = previous;
  }
});

test("a body that is not JSON, or not an object, is refused", async () => {
  await withSealedConfig(async () => {
    for (const body of ["{nope", "[]", "null", "42", '"text"']) {
      const response = await POST(post(body));
      assert.equal(response.status, 400, body);
      assert.equal((await payloadOf(response)).code, "BAD_REQUEST");
    }
  });
});

test("a malformed document id is refused before storage is touched", async () => {
  await withSealedConfig(async () => {
    for (const documentId of ["../../secret", "short", "", "a/b", 42, null, undefined, {}]) {
      const response = await POST(
        post({ documentId, conversationId: "conv-1", schema: "invoice" }),
      );
      assert.equal(response.status, 400, JSON.stringify(documentId));
      assert.equal((await payloadOf(response)).code, "BAD_REQUEST");
    }
  });
});

test("a malformed conversation id is refused", async () => {
  await withSealedConfig(async () => {
    for (const conversationId of ["", "has space", "../x", "x".repeat(129), 7, null]) {
      const response = await POST(
        post({ documentId: DOCUMENT_ID, conversationId, schema: "invoice" }),
      );
      assert.equal(response.status, 400, JSON.stringify(conversationId));
    }
  });
});

test("an unknown schema is refused, including inherited property names", async () => {
  await withSealedConfig(async () => {
    for (const schema of ["receipt", "", null, 5, "__proto__", "constructor", "toString"]) {
      const response = await POST(
        post({ documentId: DOCUMENT_ID, conversationId: "conv-1", schema }),
      );
      assert.equal(response.status, 400, JSON.stringify(schema));
      assert.match((await payloadOf(response)).detail ?? "", /schema/i);
    }
  });
});

test("a document that cannot be read answers NOT_FOUND, revealing nothing about why", async () => {
  await withSealedConfig(async () => {
    const response = await POST(
      post({ documentId: DOCUMENT_ID, conversationId: "conv-1", schema: "invoice" }),
    );
    assert.equal(response.status, 404);
    const body = await payloadOf(response);
    assert.equal(body.code, "NOT_FOUND");
    // No hint as to whether the id exists, whether storage is configured, or
    // which conversation it might belong to.
    assert.doesNotMatch(body.detail ?? "", /storage|token|exists|another/i);
  });
});

test("both valid schemas are accepted by validation and fail only at the document lookup", async () => {
  await withSealedConfig(async () => {
    for (const schema of ["invoice", "contract"]) {
      const response = await POST(
        post({ documentId: DOCUMENT_ID, conversationId: "conv-1", schema }),
      );
      assert.equal(response.status, 404, `${schema} should pass validation and stop at the lookup`);
    }
  });
});
