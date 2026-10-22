import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DELETE, GET, POST } from "@/app/api/documents/route";
import { MAX_DOCUMENT_BYTES } from "@/lib/documents";

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
 * Project 4: route-level tests for `/api/documents`, calling the real
 * exported handlers with real `Request` objects -- the same approach
 * `tests/route.test.ts` and `tests/images-route.test.ts` take.
 *
 * TWO ENVIRONMENTS ARE EXERCISED HERE.
 *
 * 1. As `npm test` runs it: no `BLOB_READ_WRITE_TOKEN`, no `GEMINI_API_KEY`
 *    (node is run directly and never loads `.env.local`). This proves an
 *    unconfigured server says so, naming the missing variable only.
 *
 * 2. With placeholder values for both, so the validation layer downstream of
 *    the configuration gate can be reached. Throughout that block
 *    `globalThis.fetch` is replaced with a stub that THROWS, making the
 *    isolation fail-closed: if any of these inputs ever reached the embedding
 *    service or blob storage, the test would fail rather than quietly make a
 *    network call. Nothing in this file contacts a provider, and no test here
 *    costs anything to run.
 *
 * The successful-upload path is therefore deliberately NOT tested here -- it
 * requires a real embedding call. Parsing is covered end-to-end by
 * `documents-parse.test.ts` (real PDF/DOCX/XLSX round-trips); the indexed
 * upload is covered by live verification.
 */

const TOKEN_ENV = "BLOB_READ_WRITE_TOKEN";
const KEY_ENV = "GEMINI_API_KEY";

function upload(parts: Record<string, string | File | undefined>): Request {
  const form = new FormData();
  for (const [name, value] of Object.entries(parts)) {
    if (value !== undefined) form.append(name, value);
  }
  return new Request("http://localhost/api/documents", { method: "POST", body: form });
}

function file(name: string, contents: Uint8Array | string, type = "application/octet-stream"): File {
  return new File([contents as BlobPart], name, { type });
}

async function payloadOf(response: Response): Promise<{ code?: string; detail?: string; warnings?: string[] }> {
  return (await response.json()) as { code?: string; detail?: string; warnings?: string[] };
}

/**
 * Runs `body` with placeholder credentials present and the network sealed.
 * Restores the previous environment and `fetch` afterwards, whatever happens.
 */
async function withSealedConfig(body: () => Promise<void>): Promise<void> {
  const previous = { token: process.env[TOKEN_ENV], key: process.env[KEY_ENV] };
  const realFetch = globalThis.fetch;
  process.env[TOKEN_ENV] = "placeholder-not-a-real-token";
  process.env[KEY_ENV] = "placeholder-not-a-real-key";
  globalThis.fetch = (() => {
    throw new Error("network access attempted -- validation must return before any provider call");
  }) as typeof fetch;
  try {
    await body();
  } finally {
    globalThis.fetch = realFetch;
    if (previous.token === undefined) delete process.env[TOKEN_ENV];
    else process.env[TOKEN_ENV] = previous.token;
    if (previous.key === undefined) delete process.env[KEY_ENV];
    else process.env[KEY_ENV] = previous.key;
  }
}

/* ------------------------------------------------------------- the probe -- */

test("GET reports capability without leaking any secret", async () => {
  const response = await GET();
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(typeof body.configured, "boolean");
  assert.equal(typeof body.storage, "boolean");
  assert.equal(typeof body.embeddings, "boolean");
  assert.equal(body.maxBytes, MAX_DOCUMENT_BYTES);
  // Nothing key-, token- or storage-URL-shaped anywhere in the probe.
  const serialised = JSON.stringify(body);
  assert.doesNotMatch(serialised, /sk-[A-Za-z0-9_-]{10,}/);
  assert.doesNotMatch(serialised, /vercel_blob_rw_/);
  assert.doesNotMatch(serialised, /AIza[A-Za-z0-9_-]{10,}/);
  assert.doesNotMatch(serialised, /blob\.vercel-storage\.com/);
});

test("GET is not cached, so a probe cannot go stale after configuration changes", async () => {
  const response = await GET();
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
});

/* --------------------------------------------- the unconfigured server --- */

test("an unconfigured server names the missing VARIABLE, never a value", async () => {
  const response = await POST(upload({ conversationId: "conv-1", file: file("a.txt", "hello") }));
  assert.equal(response.status, 503);
  const body = await payloadOf(response);
  assert.equal(body.code, "NOT_CONFIGURED");
  assert.match(body.detail ?? "", /BLOB_READ_WRITE_TOKEN|GEMINI_API_KEY/);
  assert.doesNotMatch(body.detail ?? "", /sk-|vercel_blob_rw_|AIza/);
});

/* -------------------------------------------------- upload validation ---- */

test("a body that is not multipart/form-data is refused", async () => {
  await withSealedConfig(async () => {
    const request = new Request("http://localhost/api/documents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId: "conv-1" }),
    });
    const response = await POST(request);
    assert.equal(response.status, 400);
    assert.equal((await payloadOf(response)).code, "BAD_REQUEST");
  });
});

test("a missing or malformed conversation id is refused before the file is read", async () => {
  await withSealedConfig(async () => {
    const bad: (string | undefined)[] = [
      undefined,
      "",
      "../../etc/passwd",
      "has space",
      "has/slash",
      "x".repeat(129),
    ];
    for (const conversationId of bad) {
      const response = await POST(upload({ conversationId, file: file("a.txt", "hello") }));
      assert.equal(response.status, 400, `should reject conversation id: ${String(conversationId)}`);
      assert.equal((await payloadOf(response)).code, "BAD_REQUEST");
    }
  });
});

test("a request with no file is refused", async () => {
  await withSealedConfig(async () => {
    const response = await POST(upload({ conversationId: "conv-1" }));
    assert.equal(response.status, 400);
    assert.equal((await payloadOf(response)).code, "BAD_REQUEST");
  });
});

test("a field that is text rather than a file is refused, not coerced", async () => {
  await withSealedConfig(async () => {
    const response = await POST(upload({ conversationId: "conv-1", file: "just a string" }));
    assert.equal(response.status, 400);
    assert.equal((await payloadOf(response)).code, "BAD_REQUEST");
  });
});

test("an empty file is refused by name", async () => {
  await withSealedConfig(async () => {
    const response = await POST(upload({ conversationId: "conv-1", file: file("empty.txt", "") }));
    assert.equal(response.status, 400);
    const body = await payloadOf(response);
    assert.equal(body.code, "BAD_REQUEST");
    assert.match(body.detail ?? "", /empty\.txt/);
  });
});

test("an oversized file is refused with the limit stated", async () => {
  await withSealedConfig(async () => {
    // Rejected on the reported `size`, before arrayBuffer() is ever called.
    const oversized = file("huge.pdf", new Uint8Array(MAX_DOCUMENT_BYTES + 1), "application/pdf");
    const response = await POST(upload({ conversationId: "conv-1", file: oversized }));
    assert.equal(response.status, 413);
    const body = await payloadOf(response);
    assert.equal(body.code, "TOO_LARGE");
    assert.match(body.detail ?? "", /huge\.pdf/);
    assert.match(body.detail ?? "", /\d/);
  });
});

test("an unsupported file type is refused", async () => {
  await withSealedConfig(async () => {
    const response = await POST(
      upload({ conversationId: "conv-1", file: file("installer.exe", "MZ binary") }),
    );
    assert.equal(response.status, 415);
    assert.ok(["UNSUPPORTED_TYPE", "PARSE_FAILED"].includes((await payloadOf(response)).code ?? ""));
  });
});

test("a file whose BYTES contradict its extension is refused, not handed to a parser", async () => {
  await withSealedConfig(async () => {
    // PNG magic bytes wearing a .pdf name. Sniffing has to win over the
    // extension, or a parser is fed something it cannot read.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
    const response = await POST(
      upload({ conversationId: "conv-1", file: file("report.pdf", png, "application/pdf") }),
    );
    assert.equal(response.status, 415);
    const body = await payloadOf(response);
    assert.ok(["UNSUPPORTED_TYPE", "PARSE_FAILED"].includes(body.code ?? ""));
  });
});

test("a declared content-type is never trusted over the bytes", async () => {
  await withSealedConfig(async () => {
    // Claims to be a spreadsheet; is in fact a PNG. The ZIP signature check
    // is what stands between this and SheetJS.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const response = await POST(
      upload({
        conversationId: "conv-1",
        file: file("book.xlsx", png, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
      }),
    );
    assert.equal(response.status, 415);
  });
});

/* ------------------------------------------------------------- deletion -- */

test("DELETE refuses a malformed document id without touching storage", async () => {
  await withSealedConfig(async () => {
    const bad = ["../../secret", "short", "a/b", "", "x".repeat(200)];
    for (const id of bad) {
      const url = `http://localhost/api/documents?id=${encodeURIComponent(id)}&conversationId=conv-1`;
      const response = await DELETE(new Request(url, { method: "DELETE" }));
      assert.equal(response.status, 400, `should reject id: ${id}`);
      assert.equal((await payloadOf(response)).code, "BAD_REQUEST");
    }
  });
});

test("DELETE requires a conversation id as well as a document id", async () => {
  await withSealedConfig(async () => {
    const id = "A".repeat(43);
    const response = await DELETE(
      new Request(`http://localhost/api/documents?id=${id}`, { method: "DELETE" }),
    );
    assert.equal(response.status, 400);
    assert.equal((await payloadOf(response)).code, "BAD_REQUEST");
  });
});

test("DELETE on an unconfigured server reports NOT_FOUND, not a storage error", async () => {
  // No token in the environment here: deleteDocument must bail out before any
  // network call, and the route must answer with the same 404 it gives for a
  // document that belongs to another conversation.
  const id = "B".repeat(43);
  const response = await DELETE(
    new Request(`http://localhost/api/documents?id=${id}&conversationId=conv-1`, { method: "DELETE" }),
  );
  assert.equal(response.status, 404);
  assert.equal((await payloadOf(response)).code, "NOT_FOUND");
});
