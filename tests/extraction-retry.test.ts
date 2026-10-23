import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { GoogleGenAI } from "@google/genai";
import { ExtractionError, runExtraction } from "@/server/extract/run";
import type { StoredDocument } from "@/server/documents/store";

/**
 * MOCKED — but mocked at the SOCKET, not at the function.
 *
 * `@google/genai` uses undici rather than `globalThis.fetch`, so a stubbed
 * global cannot intercept it. Instead a local HTTP server stands in for the
 * Gemini endpoint (`httpOptions.baseUrl`), which means these exercise the
 * REAL SDK, the REAL request, and the REAL retry loop in `runExtraction` --
 * only the far end is fake. No provider is contacted and no quota is spent.
 *
 * This is the scenario the bug was: a 503 on the first attempt. Before the
 * fix, extraction made one attempt and reported "the model is busy" as
 * though it were final.
 *
 * The extracted values are asserted against what the fake model RETURNS, and
 * the document text is asserted to have reached the request, so nothing here
 * can pass on a hardcoded result.
 */

const BUSY_BODY = JSON.stringify({
  error: {
    code: 503,
    message: "This model is currently experiencing high demand. Spikes in demand are usually temporary.",
    status: "UNAVAILABLE",
  },
});

const AUTH_BODY = JSON.stringify({
  error: { code: 403, message: "Permission denied", status: "PERMISSION_DENIED" },
});

/** What the fake model "extracts". Deliberately NOT the real sample values. */
const MODEL_OUTPUT = {
  vendorName: "Fixture Vendor Ltd",
  billedTo: "Fixture Client",
  invoiceNumber: "FIX-001",
  issueDate: "2026-01-02",
  dueDate: "2026-02-01",
  currency: "EUR",
  lineItems: [{ description: "Widget", quantity: 2, unitPrice: 50, amount: 100 }],
  subtotal: 100,
  tax: 20,
  total: 120,
  notes: null,
  sourceRefs: ["lines 1-4"],
};

let server: Server;
let baseUrl: string;

/** Status codes to serve, one per request, then 200 for the rest. */
let script: number[] = [];
let requests: { path: string; body: string }[] = [];

before(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      requests.push({ path: req.url ?? "", body: Buffer.concat(chunks).toString() });
      const status = script.shift() ?? 200;
      if (status === 503) {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(BUSY_BODY);
        return;
      }
      if (status === 403) {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(AUTH_BODY);
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(MODEL_OUTPUT) }], role: "model" } }],
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.GEMINI_API_KEY = "test-key-not-real";
});

after(async () => {
  delete process.env.GEMINI_API_KEY;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  script = [];
  requests = [];
});

function client() {
  return new GoogleGenAI({ apiKey: "test-key-not-real", httpOptions: { baseUrl } });
}

/** No real waiting: the backoff is exercised, not endured. */
const noSleep = async () => {};

const invoiceDocument = (): StoredDocument => ({
  id: "A".repeat(43),
  conversationId: "conv-1",
  filename: "fixture-invoice.txt",
  kind: "text",
  bytes: 200,
  meta: { chars: 200, truncated: false },
  warnings: [],
  uploadedAt: 1,
  embeddingModel: "gemini-embedding-001",
  chunks: [
    {
      i: 0,
      ref: "lines 1-4",
      text: "Invoice FIX-001 from Fixture Vendor Ltd. Widget x2 at 50.00 = 100.00. Tax 20.00. Total 120.00 EUR.",
      embedding: [1, 0],
    },
  ],
});

/* ------------------------------------- 1. transient 503, then success ---- */

test("a 503 on the first attempt is retried and the extraction succeeds", async () => {
  script = [503];

  const { result } = await runExtraction(invoiceDocument(), "invoice", undefined, {
    client: client(),
    sleep: noSleep,
  });

  assert.equal(requests.length, 2, "exactly one retry");
  // Genuinely extracted: these are the fake model's values, and they reached
  // the caller through real Zod validation.
  assert.equal(result.data.invoiceNumber, "FIX-001");
  assert.equal(result.data.total, 120);
  assert.equal(result.data.currency, "EUR");
  assert.equal(result.warnings.length, 0, "100 + 20 = 120, so the audit is clean");

  // The document's own text was actually sent -- a hardcoded result could
  // not satisfy this.
  assert.match(requests[0].body, /Widget x2 at 50\.00/);
  assert.match(requests[0].body, /fixture-invoice\.txt/);
});

test("two 503s then success still recovers inside the budget", async () => {
  script = [503, 503];
  const { result } = await runExtraction(invoiceDocument(), "invoice", undefined, {
    client: client(),
    sleep: noSleep,
  });
  assert.equal(requests.length, 3);
  assert.equal(result.data.invoiceNumber, "FIX-001");
});

/* ------------------------------- 2. repeated 503s exhaust the retries ---- */

test("unrelenting 503s exhaust the budget, then try the fallback, then fail as BUSY", async () => {
  // Every request fails. The primary gets 3 attempts, the fallback model one.
  script = Array.from({ length: 10 }, () => 503);

  await assert.rejects(
    () => runExtraction(invoiceDocument(), "invoice", undefined, { client: client(), sleep: noSleep }),
    (error: unknown) => {
      assert.ok(error instanceof ExtractionError);
      assert.equal(error.code, "BUSY", "capacity, reported as capacity");
      assert.match(error.message, /overloaded/i);
      // It must say it tried, not imply a single shot.
      assert.match(error.message, /tried|temporary/i);
      return true;
    },
  );

  assert.equal(requests.length, 4, "3 attempts on the primary, then 1 on the fallback");
});

test("the fallback model is a DIFFERENT model from the primary", async () => {
  script = Array.from({ length: 10 }, () => 503);
  await assert.rejects(() =>
    runExtraction(invoiceDocument(), "invoice", undefined, { client: client(), sleep: noSleep }),
  );
  // The model name is in the request path.
  const models = [...new Set(requests.map((r) => /models\/([^:]+):/.exec(r.path)?.[1]))];
  assert.equal(models.length, 2, `expected two distinct models, saw ${JSON.stringify(models)}`);
});

test("the fallback can rescue an extraction the primary could not serve", async () => {
  // Primary fails all three attempts; the fallback answers.
  script = [503, 503, 503];
  const { result } = await runExtraction(invoiceDocument(), "invoice", undefined, {
    client: client(),
    sleep: noSleep,
  });
  assert.equal(requests.length, 4);
  assert.equal(result.data.total, 120);
  // The result names the model that actually answered, not the one configured.
  const fallbackModel = /models\/([^:]+):/.exec(requests[3].path)?.[1];
  assert.equal(result.model, fallbackModel);
});

/* ---------------------------- 3. a permanent error is NOT retried -------- */

test("a 403 is attempted exactly once -- no retry, no fallback", async () => {
  script = Array.from({ length: 10 }, () => 403);

  await assert.rejects(
    () => runExtraction(invoiceDocument(), "invoice", undefined, { client: client(), sleep: noSleep }),
    (error: unknown) => {
      assert.ok(error instanceof ExtractionError);
      assert.equal(error.code, "AUTH");
      assert.match(error.message, /credentials/i);
      assert.doesNotMatch(error.message, /busy|overloaded/i, "an auth failure is not a capacity failure");
      return true;
    },
  );

  assert.equal(
    requests.length,
    1,
    "every model is reached with the same key, so neither retry nor fallback can help",
  );
});

test("a permanent failure never leaks the provider's raw body to the client", async () => {
  script = [403];
  await assert.rejects(
    () => runExtraction(invoiceDocument(), "invoice", undefined, { client: client(), sleep: noSleep }),
    (error: unknown) => {
      const message = (error as Error).message;
      assert.doesNotMatch(message, /PERMISSION_DENIED/, "no raw provider status");
      assert.doesNotMatch(message, /test-key-not-real/, "and certainly no credential");
      return true;
    },
  );
});

/* ------------------------------------------------- output is validated --- */

test("output that does not match the schema is reported as INVALID_OUTPUT, not as success", async () => {
  // The fake model returns a total as a string, which Zod must refuse.
  const broken = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify({ ...MODEL_OUTPUT, total: "one hundred and twenty" }) }],
                role: "model",
              },
            },
          ],
        }),
      );
    });
  });
  await new Promise<void>((resolve) => broken.listen(0, "127.0.0.1", resolve));
  const brokenUrl = `http://127.0.0.1:${(broken.address() as AddressInfo).port}`;

  try {
    await assert.rejects(
      () =>
        runExtraction(invoiceDocument(), "invoice", undefined, {
          client: new GoogleGenAI({ apiKey: "test-key-not-real", httpOptions: { baseUrl: brokenUrl } }),
          sleep: noSleep,
        }),
      (error: unknown) => {
        assert.ok(error instanceof ExtractionError);
        assert.equal(error.code, "INVALID_OUTPUT");
        assert.match(error.message, /did not match the schema/i);
        return true;
      },
    );
  } finally {
    await new Promise<void>((resolve) => broken.close(() => resolve()));
  }
});
