import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyGemini, parseQuota } from "@/server/providers/gemini";
import { ProviderError, type ChatProvider } from "@/server/providers/types";
import { getProvider, listProviders } from "@/server/providers/registry";

/**
 * Adapter contract tests. Every provider failure is mocked — no request is
 * made to any model, so these cost no quota.
 */

/* ------------------------------------------- Gemini error classification */

const REAL_429 = JSON.stringify({
  error: {
    message: JSON.stringify({
      error: {
        code: 429,
        message:
          "You exceeded your current quota.\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20\nPlease retry in 15.478739171s.",
        status: "RESOURCE_EXHAUSTED",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.QuotaFailure",
            violations: [
              {
                quotaMetric:
                  "generativelanguage.googleapis.com/generate_content_free_tier_requests",
                quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
                quotaDimensions: { location: "global", model: "gemini-3.6-flash" },
                quotaValue: "20",
              },
            ],
          },
          { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "15s" },
        ],
      },
    }),
    code: 429,
    status: "Too Many Requests",
  },
});

const REAL_503 = JSON.stringify({
  error: {
    message: JSON.stringify({
      error: {
        code: 503,
        message: "This model is currently experiencing high demand.",
        status: "UNAVAILABLE",
      },
    }),
    code: 503,
    status: "Service Unavailable",
  },
});

test("a transport failure is NETWORK, never an upstream fault", () => {
  assert.equal(classifyGemini({ message: "fetch failed" }), "NETWORK");
  assert.equal(classifyGemini({ message: "socket hang up" }), "NETWORK");
});

test("a 429 quota payload is RATE_LIMIT, not MODEL_BUSY", () => {
  assert.equal(classifyGemini({ status: 429, message: REAL_429 }), "RATE_LIMIT");
});

test("a 503 capacity payload is MODEL_BUSY, not RATE_LIMIT", () => {
  assert.equal(classifyGemini({ status: 503, message: REAL_503 }), "MODEL_BUSY");
});

test("an invalid key returned as HTTP 400 is INVALID_KEY, not BAD_REQUEST", () => {
  assert.equal(
    classifyGemini({ status: 400, message: "API key not valid. Please pass a valid API key." }),
    "INVALID_KEY",
  );
});

test("quota details parse out of the real 429 payload", () => {
  const info = parseQuota({ message: REAL_429 });
  assert.ok(info);
  assert.equal(info.quotaScope, "day");
  assert.equal(info.quotaValue, 20);
  assert.equal(info.retryAfterSeconds, 15);
  assert.equal(info.quotaModel, "gemini-3.6-flash");
});

test("a per-minute quota id is reported as a minute scope", () => {
  const payload = JSON.stringify({
    error: {
      message: JSON.stringify({
        error: {
          details: [
            {
              violations: [
                { quotaId: "GenerateRequestsPerMinutePerProject-FreeTier", quotaValue: "15" },
              ],
            },
          ],
        },
      }),
    },
  });
  assert.equal(parseQuota({ message: payload })?.quotaScope, "minute");
});

/* ------------------------------------------------------ registry contract */

test("the registry exposes its two adapters and refuses everything else", () => {
  assert.ok(getProvider("gemini"));
  // GPT joined the registry when the OpenAI adapter landed. Anthropic is still
  // deliberately absent rather than stubbed.
  assert.ok(getProvider("gpt"));
  assert.equal(getProvider("anthropic"), null);
  assert.equal(getProvider("claude"), null);
  assert.equal(getProvider("nonsense"), null);
});

test("being registered is not the same as being usable", () => {
  // The route gates on availability(), not on registry membership: an adapter
  // with no key present must report itself unconfigured rather than accept a
  // request it cannot serve.
  const prev = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const gpt = getProvider("gpt");
    assert.ok(gpt);
    assert.equal(gpt.availability().configured, false);
  } finally {
    if (prev === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prev;
  }
});

test("every registered provider satisfies the ChatProvider shape", () => {
  for (const provider of listProviders()) {
    assert.equal(typeof provider.id, "string");
    assert.equal(typeof provider.label, "string");
    assert.equal(typeof provider.availability, "function");
    assert.equal(typeof provider.stream, "function");
    assert.equal(provider.capabilities.streaming, true);
    assert.equal(provider.capabilities.multiTurn, true);
    assert.equal(provider.capabilities.cancellation, true);
  }
});

test("availability never leaks a key value", () => {
  const prev = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "super-secret-value-should-never-appear";
  try {
    const a = getProvider("gemini")!.availability();
    assert.equal(a.configured, true);
    assert.equal(JSON.stringify(a).includes("super-secret"), false);
  } finally {
    if (prev === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prev;
  }
});

test("Gemini reports unconfigured when no key is present", () => {
  const prev = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const a = getProvider("gemini")!.availability();
    assert.equal(a.configured, false);
    assert.match(a.reason ?? "", /GEMINI_API_KEY/);
  } finally {
    if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
  }
});

/* ------------------- ChatProvider contract, exercised via a fixture adapter */
/*
 * T1: these three tests exercise `mockProvider` below, a local fixture --
 * NOT either real adapter (`openaiProvider`/`geminiProvider` have their own
 * dedicated test files: `tests/openai.test.ts`, `tests/gemini.test.ts`, both
 * driving the real adapter against a mocked transport). Renamed from
 * "adapters …" to make that explicit: the point of a fixture adapter is only
 * to prove the `ChatProvider` interface itself is generic -- that the route
 * and its retry/abort/streaming plumbing depend on nothing Gemini- or
 * OpenAI-specific -- not to add coverage of either real provider.
 */

const mockProvider: ChatProvider = {
  id: "gpt",
  label: "Mock",
  capabilities: { streaming: true, multiTurn: true, cancellation: true, attachments: false },
  availability: () => ({ configured: true, model: "mock-1" }),
  async stream(messages, signal) {
    if (messages.length === 0) throw new ProviderError("BAD_REQUEST");
    return (async function* () {
      for (const word of ["mock ", "reply"]) {
        if (signal.aborted) return;
        yield { type: "delta", text: word } as const;
      }
      if (!signal.aborted) yield { type: "outcome", outcome: "complete" } as const;
    })();
  },
};

test("the ChatProvider contract: a fixture adapter streams deltas then outcome:complete", async () => {
  const chunks: string[] = [];
  const stream = await mockProvider.stream(
    [{ role: "user", content: "hi" }],
    new AbortController().signal,
  );
  for await (const d of stream) if (d.type === "delta") chunks.push(d.text);
  assert.equal(chunks.join(""), "mock reply");
});

test("the ChatProvider contract: a fixture adapter honours an already-aborted signal", async () => {
  const controller = new AbortController();
  controller.abort();
  const stream = await mockProvider.stream(
    [{ role: "user", content: "hi" }],
    controller.signal,
  );
  const chunks: string[] = [];
  for await (const d of stream) if (d.type === "delta") chunks.push(d.text);
  assert.equal(chunks.length, 0);
});

test("the ChatProvider contract: a fixture adapter throws ProviderError for invalid input, never a raw error", async () => {
  await assert.rejects(
    () => mockProvider.stream([], new AbortController().signal),
    (e: unknown) => e instanceof ProviderError && e.code === "BAD_REQUEST",
  );
});

test("only transient classes are marked retryable", () => {
  assert.equal(new ProviderError("MODEL_BUSY", { retryable: true }).retryable, true);
  assert.equal(new ProviderError("RATE_LIMIT").retryable, false);
  assert.equal(new ProviderError("INVALID_KEY").retryable, false);
});
