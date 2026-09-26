import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyOpenAi, openaiProvider, parseRetryAfter, parseSse } from "@/server/providers/openai";
import { ProviderError } from "@/server/providers/types";
import type { WireMessage } from "@/lib/chat";

/**
 * These exercise the REAL adapter against mocked UPSTREAM responses: the fetch
 * the adapter itself performs is intercepted, so the SSE parsing, delta
 * normalisation, abort handling and error classification under test are the
 * ones that would run in production. No request leaves the process; the mock
 * below throws if any URL other than the OpenAI endpoint is requested, so a
 * miswired test fails loudly instead of reaching a live provider.
 */

const ENDPOINT = "https://api.openai.com/v1/responses";

type FetchArgs = { url: string; init: RequestInit };

/** Installs a fetch that only ever answers the OpenAI endpoint, from a script. */
function mockUpstream(respond: (args: FetchArgs) => Response | Promise<Response>) {
  const calls: FetchArgs[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : String(input);
    if (!url.startsWith(ENDPOINT)) {
      throw new Error(`refusing to leave the mock: ${url}`);
    }
    calls.push({ url, init });
    return respond({ url, init });
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function sse(...events: object[]): Response {
  const body = events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function errorResponse(status: number, error: object, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

type Chunk = { type: "delta"; text: string } | { type: "outcome"; outcome: string; reason?: string };

/** Concatenates only the delta chunks' text -- outcome chunks carry none. */
async function collect(iterable: AsyncIterable<Chunk>): Promise<string> {
  let out = "";
  for await (const d of iterable) if (d.type === "delta") out += d.text;
  return out;
}

/** Every chunk, in order -- for tests that need to see the outcome too. */
async function collectAll(iterable: AsyncIterable<Chunk>): Promise<Chunk[]> {
  const out: Chunk[] = [];
  for await (const d of iterable) out.push(d);
  return out;
}

const USER: WireMessage[] = [{ role: "user", content: "hello" }];

function withKey<T>(fn: () => Promise<T>): Promise<T> {
  process.env.OPENAI_API_KEY = "test-key-not-real";
  return fn().finally(() => {
    delete process.env.OPENAI_API_KEY;
  });
}

/* --- availability -------------------------------------------------------- */

test("availability reports configured only when a key is present", () => {
  delete process.env.OPENAI_API_KEY;
  const without = openaiProvider.availability();
  assert.equal(without.configured, false);
  assert.match(without.reason ?? "", /OPENAI_API_KEY/);

  process.env.OPENAI_API_KEY = "test-key-not-real";
  const withIt = openaiProvider.availability();
  assert.equal(withIt.configured, true);
  assert.equal(withIt.reason, undefined);
  delete process.env.OPENAI_API_KEY;
});

test("availability never leaks the key", () => {
  process.env.OPENAI_API_KEY = "sk-secret-value-abc";
  const json = JSON.stringify(openaiProvider.availability());
  assert.ok(!json.includes("sk-secret-value-abc"), "key appeared in availability");
  delete process.env.OPENAI_API_KEY;
});

test("the model is overridable and defaults to the documented economical tier", () => {
  process.env.OPENAI_API_KEY = "test-key-not-real";
  delete process.env.OPENAI_MODEL;
  assert.equal(openaiProvider.availability().model, "gpt-5.6-luna");
  process.env.OPENAI_MODEL = "gpt-5.6-terra";
  assert.equal(openaiProvider.availability().model, "gpt-5.6-terra");
  delete process.env.OPENAI_MODEL;
  delete process.env.OPENAI_API_KEY;
});

/* --- progressive text and completion ------------------------------------ */

test("streamed deltas are normalised and concatenate to the full answer", async () => {
  const mock = mockUpstream(() =>
    sse(
      { type: "response.created" },
      { type: "response.output_text.delta", delta: "Hello" },
      { type: "response.output_text.delta", delta: ", " },
      { type: "response.output_text.delta", delta: "world." },
      { type: "response.completed" },
    ),
  );
  try {
    await withKey(async () => {
      const stream = await openaiProvider.stream(USER, new AbortController().signal);
      assert.equal(await collect(stream), "Hello, world.");
    });
  } finally {
    mock.restore();
  }
});

test("non-text events are ignored rather than emitted as text", async () => {
  const mock = mockUpstream(() =>
    sse(
      { type: "response.created" },
      { type: "response.in_progress" },
      { type: "response.output_item.added", item: { type: "message" } },
      { type: "response.output_text.delta", delta: "only this" },
      { type: "response.output_text.done", text: "only this" },
      { type: "response.completed" },
    ),
  );
  try {
    await withKey(async () => {
      const stream = await openaiProvider.stream(USER, new AbortController().signal);
      assert.equal(await collect(stream), "only this");
    });
  } finally {
    mock.restore();
  }
});

test("an empty answer yields no deltas rather than throwing", async () => {
  const mock = mockUpstream(() => sse({ type: "response.created" }, { type: "response.completed" }));
  try {
    await withKey(async () => {
      const stream = await openaiProvider.stream(USER, new AbortController().signal);
      assert.equal(await collect(stream), "");
    });
  } finally {
    mock.restore();
  }
});

/* --- history mapping ----------------------------------------------------- */

test("the whole conversation is sent, in order, with roles mapped across", async () => {
  const mock = mockUpstream(() => sse({ type: "response.output_text.delta", delta: "ok" }, { type: "response.completed" }));
  try {
    await withKey(async () => {
      const history: WireMessage[] = [
        { role: "user", content: "first question" },
        { role: "assistant", content: "first answer" },
        { role: "user", content: "second question" },
        { role: "assistant", content: "second answer" },
        { role: "user", content: "third question" },
        { role: "assistant", content: "third answer" },
        { role: "user", content: "what did I ask first?" },
      ];
      const stream = await openaiProvider.stream(history, new AbortController().signal);
      await collect(stream);

      const body = JSON.parse(String(mock.calls[0].init.body));
      assert.equal(body.stream, true);
      assert.equal(body.model, "gpt-5.6-luna");
      assert.equal(body.input.length, 7, "every turn must be sent");
      // At least three earlier user turns survive the mapping.
      const users = body.input.filter((m: { role: string }) => m.role === "user");
      assert.equal(users.length, 4);
      assert.equal(body.input[0].content, "first question");
      assert.equal(body.input[1].role, "assistant");
      assert.equal(body.input.at(-1).content, "what did I ask first?");
    });
  } finally {
    mock.restore();
  }
});

test("the key travels in the Authorization header and nowhere else", async () => {
  const mock = mockUpstream(() => sse({ type: "response.completed" }));
  try {
    await withKey(async () => {
      const stream = await openaiProvider.stream(USER, new AbortController().signal);
      await collect(stream);
      const { init } = mock.calls[0];
      const headers = init.headers as Record<string, string>;
      assert.equal(headers.Authorization, "Bearer test-key-not-real");
      assert.ok(!String(init.body).includes("test-key-not-real"), "key leaked into the body");
    });
  } finally {
    mock.restore();
  }
});

/* --- abort --------------------------------------------------------------- */

test("the abort signal is handed to fetch", async () => {
  const mock = mockUpstream(() => sse({ type: "response.completed" }));
  try {
    await withKey(async () => {
      const controller = new AbortController();
      const stream = await openaiProvider.stream(USER, controller.signal);
      await collect(stream);
      assert.equal(mock.calls[0].init.signal, controller.signal);
    });
  } finally {
    mock.restore();
  }
});

test("aborting mid-stream stops delivery and does not throw", async () => {
  const controller = new AbortController();
  const mock = mockUpstream(
    () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            const enc = new TextEncoder();
            const push = (o: object) =>
              c.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
            push({ type: "response.output_text.delta", delta: "before " });
            // Abort arrives between chunks, as it does when Stop is pressed.
            controller.abort();
            push({ type: "response.output_text.delta", delta: "after" });
            c.close();
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      ),
  );
  try {
    await withKey(async () => {
      const stream = await openaiProvider.stream(USER, controller.signal);
      const text = await collect(stream);
      assert.ok(!text.includes("after"), `text after abort was delivered: ${text}`);
    });
  } finally {
    mock.restore();
  }
});

/* --- mid-stream error ---------------------------------------------------- */

test("a mid-stream error throws a ProviderError after delivered text", async () => {
  const mock = mockUpstream(() =>
    sse(
      { type: "response.output_text.delta", delta: "partial answer" },
      { type: "error", error: { type: "server_error", code: "server_is_overloaded" } },
    ),
  );
  try {
    await withKey(async () => {
      const stream = await openaiProvider.stream(USER, new AbortController().signal);
      let delivered = "";
      await assert.rejects(
        (async () => {
          for await (const d of stream) if (d.type === "delta") delivered += d.text;
        })(),
        (error: unknown) => {
          assert.ok(error instanceof ProviderError);
          assert.equal((error as ProviderError).code, "MODEL_BUSY");
          return true;
        },
      );
      // Text that already arrived is not discarded by the failure.
      assert.equal(delivered, "partial answer");
    });
  } finally {
    mock.restore();
  }
});

/* --- HTTP error classification ------------------------------------------- */

test("an invalid key is reported as INVALID_KEY and never retried", async () => {
  const mock = mockUpstream(() =>
    errorResponse(401, { message: "Incorrect API key provided", type: "invalid_request_error" }),
  );
  try {
    await withKey(async () => {
      await assert.rejects(
        openaiProvider.stream(USER, new AbortController().signal),
        (error: unknown) => {
          assert.ok(error instanceof ProviderError);
          assert.equal((error as ProviderError).code, "INVALID_KEY");
          assert.equal((error as ProviderError).retryable, false);
          return true;
        },
      );
    });
  } finally {
    mock.restore();
  }
});

test("insufficient credit is distinguished from a rate limit, though both are 429", async () => {
  // Billing: must NOT be retried -- waiting never clears it.
  for (const code of [
    "credit_balance_exhausted",
    "organization_spend_limit_exceeded",
    "project_spend_limit_exceeded",
    "organization_usage_limit_exceeded",
  ]) {
    const mock = mockUpstream(() =>
      errorResponse(429, { message: "quota", type: "insufficient_quota", code }),
    );
    try {
      await withKey(async () => {
        await assert.rejects(
          openaiProvider.stream(USER, new AbortController().signal),
          (error: unknown) => {
            assert.equal((error as ProviderError).code, "INSUFFICIENT_CREDIT", code);
            assert.equal((error as ProviderError).retryable, false, code);
            return true;
          },
        );
      });
    } finally {
      mock.restore();
    }
  }

  // A genuine throttle on the same status is a different code.
  const mock = mockUpstream(() =>
    errorResponse(429, { message: "slow down", type: "rate_limit_error", code: "slow_down" }, { "Retry-After": "12" }),
  );
  try {
    await withKey(async () => {
      await assert.rejects(
        openaiProvider.stream(USER, new AbortController().signal),
        (error: unknown) => {
          assert.equal((error as ProviderError).code, "RATE_LIMIT");
          assert.equal((error as ProviderError).info?.retryAfterSeconds, 12);
          return true;
        },
      );
    });
  } finally {
    mock.restore();
  }
});

test("server faults are retryable, client faults are not", async () => {
  const cases: [number, object, string, boolean][] = [
    [500, { type: "server_error" }, "UPSTREAM", true],
    [503, { type: "service_unavailable_error", code: "server_is_overloaded" }, "MODEL_BUSY", true],
    [400, { type: "invalid_request_error" }, "BAD_REQUEST", false],
    [404, { type: "invalid_request_error", code: "model_not_found" }, "BAD_REQUEST", false],
    [403, { type: "permission_error" }, "INVALID_KEY", false],
  ];
  for (const [status, error, code, retryable] of cases) {
    const mock = mockUpstream(() => errorResponse(status, error));
    try {
      await withKey(async () => {
        await assert.rejects(
          openaiProvider.stream(USER, new AbortController().signal),
          (e: unknown) => {
            assert.equal((e as ProviderError).code, code, `status ${status}`);
            assert.equal((e as ProviderError).retryable, retryable, `status ${status}`);
            return true;
          },
        );
      });
    } finally {
      mock.restore();
    }
  }
});

test("a missing key fails before any request is attempted", async () => {
  delete process.env.OPENAI_API_KEY;
  const mock = mockUpstream(() => {
    throw new Error("must not be called");
  });
  try {
    await assert.rejects(
      openaiProvider.stream(USER, new AbortController().signal),
      (error: unknown) => {
        assert.equal((error as ProviderError).code, "MISSING_KEY");
        return true;
      },
    );
    assert.equal(mock.calls.length, 0, "a request was attempted without a key");
  } finally {
    mock.restore();
  }
});

test("a transport failure is reported as NETWORK, not as a provider fault", async () => {
  const mock = mockUpstream(() => {
    throw new Error("fetch failed");
  });
  try {
    await withKey(async () => {
      await assert.rejects(
        openaiProvider.stream(USER, new AbortController().signal),
        (error: unknown) => {
          assert.equal((error as ProviderError).code, "NETWORK");
          return true;
        },
      );
    });
  } finally {
    mock.restore();
  }
});

/* --- unit-level helpers -------------------------------------------------- */

test("classifyOpenAi maps statuses and codes as documented", () => {
  assert.deepEqual(classifyOpenAi(401, null), { code: "INVALID_KEY", retryable: false });
  assert.deepEqual(classifyOpenAi(429, { error: { type: "rate_limit_error" } }), {
    code: "RATE_LIMIT",
    retryable: false,
  });
  assert.deepEqual(
    classifyOpenAi(429, { error: { code: "credit_balance_exhausted" } }),
    { code: "INSUFFICIENT_CREDIT", retryable: false },
  );
  assert.deepEqual(classifyOpenAi(503, null), { code: "MODEL_BUSY", retryable: true });
  assert.deepEqual(classifyOpenAi(500, null), { code: "UPSTREAM", retryable: true });
  assert.deepEqual(classifyOpenAi(400, null), { code: "BAD_REQUEST", retryable: false });
});

test("Retry-After is read when supplied and invented when not", () => {
  assert.deepEqual(parseRetryAfter(new Headers({ "Retry-After": "30" })), {
    retryAfterSeconds: 30,
  });
  assert.equal(parseRetryAfter(new Headers()), undefined);
  assert.equal(parseRetryAfter(new Headers({ "Retry-After": "not-a-number" })), undefined);
});

test("SSE parsing tolerates chunk boundaries splitting an event", async () => {
  // The transport may break anywhere, including mid-JSON.
  const pieces = [
    'data: {"type":"response.output_text.delta","del',
    'ta":"split"}\n\n',
    'data: {"type":"response.completed"}\n\n',
  ];
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      for (const p of pieces) c.enqueue(enc.encode(p));
      c.close();
    },
  });
  const seen: string[] = [];
  for await (const event of parseSse(body, new AbortController().signal)) {
    seen.push(String(event.type));
  }
  assert.deepEqual(seen, ["response.output_text.delta", "response.completed"]);
});

test("SSE parsing skips the [DONE] sentinel and malformed lines", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      c.enqueue(enc.encode('data: {"type":"a"}\n\n'));
      c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.enqueue(enc.encode("data: not json\n\n"));
      c.enqueue(enc.encode('data: {"type":"b"}\n\n'));
      c.close();
    },
  });
  const seen: string[] = [];
  for await (const event of parseSse(body, new AbortController().signal)) {
    seen.push(String(event.type));
  }
  assert.deepEqual(seen, ["a", "b"]);
});

/* --- F7: SSE line-ending and field-combination robustness ---------------- */

test("F7: a CRLF-delimited SSE stream parses exactly like an LF one", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      c.enqueue(
        enc.encode(
          'data: {"type":"response.output_text.delta","delta":"crlf"}\r\n\r\n' +
            'data: {"type":"response.completed"}\r\n\r\n',
        ),
      );
      c.close();
    },
  });
  const seen: string[] = [];
  for await (const event of parseSse(body, new AbortController().signal)) {
    seen.push(String(event.type));
  }
  assert.deepEqual(seen, ["response.output_text.delta", "response.completed"]);
});

test("F7: a bare-CR-delimited SSE stream also parses correctly", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      c.enqueue(enc.encode('data: {"type":"a"}\r\rdata: {"type":"b"}\r\r'));
      c.close();
    },
  });
  const seen: string[] = [];
  for await (const event of parseSse(body, new AbortController().signal)) {
    seen.push(String(event.type));
  }
  assert.deepEqual(seen, ["a", "b"]);
});

test("F7: a CRLF event delimiter split exactly across two transport chunks still parses", async () => {
  // The \r lands in one chunk and its paired \n in the next -- the classic
  // case a naive "\n\n" search, or a naive line splitter that treats a
  // trailing \r as an immediate terminator, gets wrong. Two full events, each
  // terminated by its own \r\n\r\n, with the split landing inside the first
  // one's terminator.
  const pieces = [
    'data: {"type":"split-crlf"}\r',
    '\n\r\ndata: {"type":"after"}\r\n\r\n',
  ];
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      for (const p of pieces) c.enqueue(enc.encode(p));
      c.close();
    },
  });
  const seen: string[] = [];
  for await (const event of parseSse(body, new AbortController().signal)) {
    seen.push(String(event.type));
  }
  // Both events recognised, and the split \r\n did not get misread as two
  // separate blank-line terminators (which would have injected a spurious
  // empty event between them).
  assert.deepEqual(seen, ["split-crlf", "after"]);
});

test("F7: multiple data: lines in one event are combined into a single payload", async () => {
  // Per the SSE spec, each data: line's value is appended with a "\n" between
  // them and parsed as ONE payload, not several. A JSON document split across
  // two data: lines is only valid once rejoined this way.
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      c.enqueue(enc.encode('data: {"type":"combined",\ndata: "note":"two lines"}\n\n'));
      c.close();
    },
  });
  const seen: Record<string, unknown>[] = [];
  for await (const event of parseSse(body, new AbortController().signal)) {
    seen.push(event);
  }
  assert.deepEqual(seen, [{ type: "combined", note: "two lines" }]);
});

test("F7: a comment line is ignored and does not dispatch a spurious event", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      c.enqueue(
        enc.encode(
          ": keep-alive\n\ndata: {\"type\":\"real\"}\nevent: message\nid: 1\n\n",
        ),
      );
      c.close();
    },
  });
  const seen: string[] = [];
  for await (const event of parseSse(body, new AbortController().signal)) {
    seen.push(String(event.type));
  }
  assert.deepEqual(seen, ["real"]);
});

test("the request bounds its output and turns reasoning off", async () => {
  const mock = mockUpstream(() =>
    sse({ type: "response.output_text.delta", delta: "ok" }, { type: "response.completed" }),
  );
  try {
    await withKey(async () => {
      const stream = await openaiProvider.stream(USER, new AbortController().signal);
      await collect(stream);
      const body = JSON.parse(String(mock.calls[0].init.body));
      // A cap is sent, and it is the documented Responses API field name.
      assert.equal(typeof body.max_output_tokens, "number");
      assert.ok(body.max_output_tokens > 0 && body.max_output_tokens <= 128_000);
      // On a reasoning model the cap alone is a trap: reasoning tokens spend
      // the same budget and can exhaust it before any visible text. Effort
      // must be off for a small cap to be safe.
      assert.equal(body.reasoning?.effort, "none");
    });
  } finally {
    mock.restore();
  }
});

/* ------------------------------------------------------ Personalizations */

test("Personalizations: preferred name + custom instructions are prepended to input as a developer-role message", async () => {
  const mock = mockUpstream(() =>
    sse({ type: "response.output_text.delta", delta: "ok" }, { type: "response.completed" }),
  );
  try {
    await withKey(async () => {
      const stream = await openaiProvider.stream(USER, new AbortController().signal, {
        preferredName: "Alex",
        customInstructions: "Keep answers short.",
      });
      await collect(stream);
      const body = JSON.parse(String(mock.calls[0].init.body));
      assert.ok(Array.isArray(body.input));
      const first = body.input[0];
      assert.equal(first.role, "developer");
      assert.match(first.content, /preferred name is "Alex"/);
      assert.match(first.content, /Keep answers short\./);
      // The original conversation is still there afterward, untouched.
      assert.equal(body.input.at(-1).role, "user");
      assert.equal(body.input.at(-1).content, "hello");
      // Never forced to repeat the name in every reply.
      assert.match(first.content, /without forcing it into every reply/);
    });
  } finally {
    mock.restore();
  }
});

test("Personalizations: no saved preferences means the input array is unchanged -- byte-identical to before this existed", async () => {
  const mock = mockUpstream(() =>
    sse({ type: "response.output_text.delta", delta: "ok" }, { type: "response.completed" }),
  );
  try {
    await withKey(async () => {
      const stream = await openaiProvider.stream(USER, new AbortController().signal, undefined);
      await collect(stream);
      const body = JSON.parse(String(mock.calls[0].init.body));
      assert.deepEqual(body.input, [{ role: "user", content: "hello" }]);
    });
  } finally {
    mock.restore();
  }
});

test("Personalizations: empty-string preferences (both fields blank) also leave the input array unchanged", async () => {
  const mock = mockUpstream(() =>
    sse({ type: "response.output_text.delta", delta: "ok" }, { type: "response.completed" }),
  );
  try {
    await withKey(async () => {
      const stream = await openaiProvider.stream(USER, new AbortController().signal, {
        preferredName: "",
        customInstructions: "",
      });
      await collect(stream);
      const body = JSON.parse(String(mock.calls[0].init.body));
      assert.deepEqual(body.input, [{ role: "user", content: "hello" }]);
    });
  } finally {
    mock.restore();
  }
});

test("a response truncated by the token cap keeps the text it delivered", async () => {
  const mock = mockUpstream(() =>
    sse(
      { type: "response.output_text.delta", delta: "a partial " },
      { type: "response.output_text.delta", delta: "answer" },
      { type: "response.incomplete", response: { status: "incomplete" } },
    ),
  );
  try {
    await withKey(async () => {
      const stream = await openaiProvider.stream(USER, new AbortController().signal);
      // Ending cleanly, not throwing: a truncated answer is still an answer.
      assert.equal(await collect(stream), "a partial answer");
    });
  } finally {
    mock.restore();
  }
});

/* --- F2: normalized terminal outcome ------------------------------------- */

test("F2: a normal completion yields an explicit outcome:complete chunk", async () => {
  const mock = mockUpstream(() =>
    sse(
      { type: "response.output_text.delta", delta: "all done" },
      { type: "response.completed" },
    ),
  );
  try {
    await withKey(async () => {
      const stream = await openaiProvider.stream(USER, new AbortController().signal);
      const chunks = await collectAll(stream);
      assert.deepEqual(chunks.at(-1), { type: "outcome", outcome: "complete" });
      assert.equal(chunks.filter((c) => c.type === "outcome").length, 1);
    });
  } finally {
    mock.restore();
  }
});

test("F2: response.incomplete for a length cap reports a specific, non-vendor-vocabulary reason", async () => {
  const mock = mockUpstream(() =>
    sse(
      { type: "response.output_text.delta", delta: "a partial answer" },
      {
        type: "response.incomplete",
        response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } },
      },
    ),
  );
  try {
    await withKey(async () => {
      const stream = await openaiProvider.stream(USER, new AbortController().signal);
      const chunks = await collectAll(stream);
      assert.deepEqual(chunks.at(-1), {
        type: "outcome",
        outcome: "truncated",
        reason: "reached the length limit",
      });
      // The raw OpenAI field name never reaches this far.
      assert.ok(!JSON.stringify(chunks).includes("max_output_tokens"));
    });
  } finally {
    mock.restore();
  }
});

test("F2: response.incomplete for content filtering reports its own distinct reason", async () => {
  const mock = mockUpstream(() =>
    sse({
      type: "response.incomplete",
      response: { status: "incomplete", incomplete_details: { reason: "content_filter" } },
    }),
  );
  try {
    await withKey(async () => {
      const stream = await openaiProvider.stream(USER, new AbortController().signal);
      const chunks = await collectAll(stream);
      assert.deepEqual(chunks.at(-1), {
        type: "outcome",
        outcome: "truncated",
        reason: "stopped by content filtering",
      });
    });
  } finally {
    mock.restore();
  }
});

test("F2: an unrecognised incomplete reason is still reported truncated, with no invented reason", async () => {
  const mock = mockUpstream(() =>
    sse({
      type: "response.incomplete",
      response: { status: "incomplete", incomplete_details: { reason: "something_new" } },
    }),
  );
  try {
    await withKey(async () => {
      const stream = await openaiProvider.stream(USER, new AbortController().signal);
      const chunks = await collectAll(stream);
      const last = chunks.at(-1) as { type: string; outcome: string; reason?: string };
      assert.equal(last.type, "outcome");
      assert.equal(last.outcome, "truncated");
      assert.equal(last.reason, undefined, "must not fabricate a specific reason");
    });
  } finally {
    mock.restore();
  }
});

test("F2: a bare EOF with no terminal event at all reports outcome:unknown, never complete", async () => {
  // The SSE connection just closes after some text -- no response.completed,
  // no response.incomplete, no error. A real upstream drop, not simulated by
  // any event type at all.
  const mock = mockUpstream(
    () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            const enc = new TextEncoder();
            c.enqueue(
              enc.encode(
                'data: {"type":"response.output_text.delta","delta":"cut off mid"}\n\n',
              ),
            );
            c.close(); // no terminal event of any kind before this
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      ),
  );
  try {
    await withKey(async () => {
      const stream = await openaiProvider.stream(USER, new AbortController().signal);
      const chunks = await collectAll(stream);
      assert.deepEqual(chunks.at(-1), { type: "outcome", outcome: "unknown" });
      const text = chunks
        .filter((c): c is { type: "delta"; text: string } => c.type === "delta")
        .map((c) => c.text)
        .join("");
      assert.equal(text, "cut off mid", "text already delivered must survive");
    });
  } finally {
    mock.restore();
  }
});

test("F2: an empty answer still yields exactly one outcome:complete chunk", async () => {
  const mock = mockUpstream(() => sse({ type: "response.completed" }));
  try {
    await withKey(async () => {
      const stream = await openaiProvider.stream(USER, new AbortController().signal);
      const chunks = await collectAll(stream);
      assert.deepEqual(chunks, [{ type: "outcome", outcome: "complete" }]);
    });
  } finally {
    mock.restore();
  }
});
