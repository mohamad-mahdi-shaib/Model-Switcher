import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  deleteDocument,
  loadDocument,
  loadDocuments,
  newDocumentId,
  saveDocument,
  type StoredDocument,
} from "@/server/documents/store";

/**
 * Project 4, Milestone 6: the isolation guarantee, tested end to end.
 *
 * This is the single most important property of the document feature, and
 * the one that unit-testing an id regex cannot establish: a document stored
 * by one conversation must be unreadable and undeletable from another, even
 * by someone holding the document id.
 *
 * It runs against a REAL store round trip. `@vercel/blob` reads its API base
 * from `VERCEL_BLOB_API_URL`, so a local HTTP server standing in for the
 * blob service lets `saveDocument` / `loadDocument` / `deleteDocument` run
 * their actual code -- the real pathname construction, the real HTTP calls,
 * the real constant-time conversation comparison -- rather than a
 * reimplementation of them. Nothing leaves the machine and no blob account
 * is involved.
 *
 * Note the SDK uses undici's `fetch`, not `globalThis.fetch`, which is why
 * this needs a socket rather than a stubbed global.
 */

type StoredBlob = { body: Buffer; contentType: string };

const blobs = new Map<string, StoredBlob>();
let server: Server;
let base: string;
const deleted: string[] = [];

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const json = (status: number, payload: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };

    // PUT /?pathname=... -- the upload.
    if (req.method === "PUT" && url.searchParams.has("pathname")) {
      const pathname = url.searchParams.get("pathname")!;
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        blobs.set(pathname, {
          body: Buffer.concat(chunks),
          contentType: req.headers["x-content-type"]?.toString() ?? "application/json",
        });
        json(200, {
          url: `${base}/content/${pathname}`,
          downloadUrl: `${base}/content/${pathname}`,
          pathname,
          contentType: "application/json",
          contentDisposition: `inline; filename="${pathname}"`,
          etag: "test-etag",
        });
      });
      return;
    }

    // GET /?url=... -- head().
    if (req.method === "GET" && url.searchParams.has("url")) {
      const pathname = url.searchParams.get("url")!;
      const blob = blobs.get(pathname);
      if (!blob) {
        json(404, { error: { code: "not_found", message: "not found" } });
        return;
      }
      json(200, {
        url: `${base}/content/${pathname}`,
        downloadUrl: `${base}/content/${pathname}`,
        pathname,
        size: blob.body.length,
        contentType: blob.contentType,
        contentDisposition: `inline; filename="${pathname}"`,
        cacheControl: "public, max-age=60",
        uploadedAt: new Date().toISOString(),
        etag: "test-etag",
      });
      return;
    }

    // POST /delete
    if (req.method === "POST" && url.pathname === "/delete") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        try {
          const { urls } = JSON.parse(Buffer.concat(chunks).toString()) as { urls: string[] };
          for (const target of urls) {
            deleted.push(target);
            const pathname = target.replace(`${base}/content/`, "");
            blobs.delete(pathname);
          }
        } catch {
          // Malformed delete: ignored, like the real API would.
        }
        json(200, {});
      });
      return;
    }

    // GET /content/<pathname> -- serving the stored bytes back.
    if (req.method === "GET" && url.pathname.startsWith("/content/")) {
      const pathname = url.pathname.slice("/content/".length);
      const blob = blobs.get(pathname);
      if (!blob) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": blob.contentType });
      res.end(blob.body);
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
  process.env.VERCEL_BLOB_API_URL = base;
  process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_teststore_testsecret";
});

after(async () => {
  delete process.env.VERCEL_BLOB_API_URL;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function documentFor(id: string, conversationId: string, filename = "contract.pdf"): StoredDocument {
  return {
    id,
    conversationId,
    filename,
    kind: "pdf",
    bytes: 2048,
    meta: { chars: 400, truncated: false, pages: 3 },
    warnings: [],
    uploadedAt: Date.now(),
    embeddingModel: "gemini-embedding-001",
    chunks: [
      { i: 0, ref: "p. 1", text: "Confidential: the fee is 40,000.", embedding: [1, 0] },
      { i: 1, ref: "p. 2", text: "Termination requires 30 days notice.", embedding: [0, 1] },
    ],
  };
}

/* ------------------------------------------------------- the round trip -- */

test("a stored document loads back intact for the conversation that owns it", async () => {
  const id = newDocumentId();
  await saveDocument(documentFor(id, "conv-A"));

  const loaded = await loadDocument(id, "conv-A");
  assert.ok(loaded, "the owning conversation must be able to read it");
  assert.equal(loaded.filename, "contract.pdf");
  assert.equal(loaded.chunks.length, 2);
  assert.equal(loaded.chunks[0].ref, "p. 1");
  assert.deepEqual(loaded.chunks[1].embedding, [0, 1]);
});

test("the blob is stored under the document id, so its URL cannot be guessed from the conversation", async () => {
  const id = newDocumentId();
  await saveDocument(documentFor(id, "conv-A"));
  const paths = [...blobs.keys()];
  assert.ok(paths.includes(`documents/${id}.json`), JSON.stringify(paths));
  // The conversation id -- which IS guessable -- appears nowhere in any path.
  assert.equal(
    paths.some((path) => path.includes("conv-A")),
    false,
    "a guessable conversation id must never appear in a storage path",
  );
});

/* ---------------------------------------------------------- isolation ---- */

test("ANOTHER conversation holding the document id still cannot read it", async () => {
  const id = newDocumentId();
  await saveDocument(documentFor(id, "conv-A"));

  // The attacker has the full 256-bit id -- the strongest position short of
  // owning the conversation -- and still gets nothing.
  assert.equal(await loadDocument(id, "conv-B"), null);
  assert.equal(await loadDocument(id, "conv-a"), null, "the check is case-sensitive");
  assert.equal(await loadDocument(id, "conv-A "), null, "and not trimmed into a match");
  assert.equal(await loadDocument(id, ""), null);
});

test("a document that does not exist is indistinguishable from one that is not yours", async () => {
  const mine = newDocumentId();
  await saveDocument(documentFor(mine, "conv-A"));
  const neverExisted = newDocumentId();

  // Both answers are exactly null, so the API cannot be used to discover
  // which ids are real.
  assert.equal(await loadDocument(mine, "conv-B"), null);
  assert.equal(await loadDocument(neverExisted, "conv-B"), null);
});

test("a malformed id never reaches storage at all", async () => {
  const before = blobs.size;
  for (const id of ["../../etc/passwd", "documents/x", "short", ""]) {
    assert.equal(await loadDocument(id, "conv-A"), null, id);
  }
  assert.equal(blobs.size, before, "nothing was created or read by a malformed lookup");
});

test("loading several documents returns only the ones this conversation owns", async () => {
  const mine = newDocumentId();
  const theirs = newDocumentId();
  await saveDocument(documentFor(mine, "conv-A", "mine.pdf"));
  await saveDocument(documentFor(theirs, "conv-B", "theirs.pdf"));

  const loaded = await loadDocuments([mine, theirs], "conv-A");
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].filename, "mine.pdf");
});

test("retrieval across a mixed list silently drops the foreign document rather than failing", async () => {
  // Important for the chat route: one stale id must not break a question
  // about the files the user DOES own.
  const mine = newDocumentId();
  await saveDocument(documentFor(mine, "conv-A", "mine.pdf"));
  const loaded = await loadDocuments([newDocumentId(), mine, newDocumentId()], "conv-A");
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].filename, "mine.pdf");
});

/* ----------------------------------------------------------- deletion ---- */

test("another conversation cannot delete a document it cannot read", async () => {
  const id = newDocumentId();
  await saveDocument(documentFor(id, "conv-A"));
  const deletesBefore = deleted.length;

  assert.equal(await deleteDocument(id, "conv-B"), false);
  assert.equal(deleted.length, deletesBefore, "no delete was even attempted against storage");
  assert.ok(await loadDocument(id, "conv-A"), "and the document is still there for its owner");
});

test("the owning conversation can delete it, and it is really gone", async () => {
  const id = newDocumentId();
  await saveDocument(documentFor(id, "conv-A"));

  assert.equal(await deleteDocument(id, "conv-A"), true);
  assert.equal(blobs.has(`documents/${id}.json`), false, "the blob itself is removed");
  assert.equal(await loadDocument(id, "conv-A"), null);
});

test("deleting something that is already gone reports false rather than throwing", async () => {
  assert.equal(await deleteDocument(newDocumentId(), "conv-A"), false);
});

/* --------------------------------------------------- storage not set up -- */

test("with no storage token, every read and write declines instead of half-working", async () => {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  try {
    const id = newDocumentId();
    assert.equal(await loadDocument(id, "conv-A"), null);
    assert.equal(await deleteDocument(id, "conv-A"), false);
    await assert.rejects(
      () => saveDocument(documentFor(id, "conv-A")),
      /not configured/i,
      "a save must fail loudly, not pretend to have stored something",
    );
  } finally {
    process.env.BLOB_READ_WRITE_TOKEN = token;
  }
});
