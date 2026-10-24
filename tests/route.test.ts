import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { GET, POST } from "@/app/api/chat/route";
import type { StreamEvent } from "@/lib/chat";
import { MAX_CUSTOM_INSTRUCTIONS_CHARS, MAX_PREFERRED_NAME_CHARS } from "@/lib/preferences";

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
 * Genuine route-level tests: calls the real, unmodified `POST`/`GET` handlers
 * from `@/app/api/chat/route` directly with real `Request` objects, and reads
 * back the real streamed `Response` body -- not a duplicate of the route's
 * logic. The route dispatches through the real provider registry to the real
 * OpenAI adapter; only that adapter's own `fetch` to the OpenAI endpoint is
 * intercepted (the same pattern `tests/openai.test.ts` uses), so what is
 * under test end to end is: route validation -> registry -> real adapter ->
 * NDJSON framing -> the bytes a browser would actually receive. No request
 * ever leaves this process. `mockUpstream()` throws if any URL other than
 * the OpenAI endpoint is requested, so a miswired test fails loudly instead
 * of reaching a live provider.
 *
 * This closes a real, pre-existing gap: before this file, `route.ts` had no
 * automated test of any kind.
 */

const ENDPOINT = "https://api.openai.com/v1/responses";

function sse(...events: object[]): Response {
  const body = events
    .map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`)
    .join("");
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function mockUpstream(respond: (init: RequestInit) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  const calls: RequestInit[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : String(input);
    if (!url.startsWith(ENDPOINT)) throw new Error(`refusing to leave the mock: ${url}`);
    calls.push(init);
    return respond(init);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function withKey<T>(fn: () => Promise<T>): Promise<T> {
  process.env.OPENAI_API_KEY = "test-key-not-real";
  return fn().finally(() => {
    delete process.env.OPENAI_API_KEY;
  });
}

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Reads the whole NDJSON response body and parses each line. */
async function readEvents(response: Response): Promise<StreamEvent[]> {
  const text = await response.text();
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as StreamEvent);
}

/* -------------------------------------------------------------------- GET */

test("GET reports configured providers with model names, never a key value", async () => {
  await withKey(async () => {
    const response = await GET();
    const body = (await response.json()) as {
      providers: Record<string, { configured: boolean; model: string }>;
    };
    assert.equal(body.providers.gpt.configured, true);
    assert.equal(body.providers.gpt.model, "gpt-5.6-luna");
    assert.ok(!JSON.stringify(body).includes("test-key-not-real"));
  });
});

/* ------------------------------------------------------- F2: terminal outcome */

test("F2: a normal completion streams deltas then a done event with outcome:complete", async () => {
  const mock = mockUpstream(() =>
    sse(
      { type: "response.output_text.delta", delta: "Hello" },
      { type: "response.output_text.delta", delta: ", world." },
      { type: "response.completed" },
    ),
  );
  try {
    await withKey(async () => {
      const response = await POST(
        postRequest({ provider: "gpt", messages: [{ role: "user", content: "hi" }] }),
      );
      assert.equal(response.status, 200);
      const events = await readEvents(response);
      const deltas = events.filter((e) => e.type === "delta") as Extract<StreamEvent, { type: "delta" }>[];
      assert.equal(deltas.map((d) => d.text).join(""), "Hello, world.");
      const done = events.at(-1) as Extract<StreamEvent, { type: "done" }>;
      assert.equal(done.type, "done");
      assert.equal(done.outcome, "complete");
    });
  } finally {
    mock.restore();
  }
});

test("F2: an incomplete response streams a done event with outcome:truncated and a reason", async () => {
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
      const response = await POST(
        postRequest({ provider: "gpt", messages: [{ role: "user", content: "hi" }] }),
      );
      const events = await readEvents(response);
      const done = events.at(-1) as Extract<StreamEvent, { type: "done" }>;
      assert.equal(done.type, "done");
      assert.equal(done.outcome, "truncated");
      assert.equal(done.reason, "reached the length limit");
      const deltas = events.filter((e) => e.type === "delta") as Extract<StreamEvent, { type: "delta" }>[];
      assert.equal(deltas.map((d) => d.text).join(""), "a partial answer");
    });
  } finally {
    mock.restore();
  }
});

test("F2: an upstream EOF with no terminal event streams a done event with outcome:unknown", async () => {
  const mock = mockUpstream(
    () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            const enc = new TextEncoder();
            c.enqueue(
              enc.encode('data: {"type":"response.output_text.delta","delta":"cut off"}\n\n'),
            );
            c.close();
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      ),
  );
  try {
    await withKey(async () => {
      const response = await POST(
        postRequest({ provider: "gpt", messages: [{ role: "user", content: "hi" }] }),
      );
      const events = await readEvents(response);
      const done = events.at(-1) as Extract<StreamEvent, { type: "done" }>;
      assert.equal(done.type, "done");
      assert.equal(done.outcome, "unknown");
    });
  } finally {
    mock.restore();
  }
});

test("F2: a mid-stream error sends an error event, never a done event, and keeps delivered text visible on the wire", async () => {
  const mock = mockUpstream(() =>
    sse(
      { type: "response.output_text.delta", delta: "partial" },
      { type: "error", error: { type: "server_error", code: "server_is_overloaded" } },
    ),
  );
  try {
    await withKey(async () => {
      const response = await POST(
        postRequest({ provider: "gpt", messages: [{ role: "user", content: "hi" }] }),
      );
      const events = await readEvents(response);
      assert.ok(events.some((e) => e.type === "delta" && e.text === "partial"));
      assert.equal(events.at(-1)?.type, "error");
      assert.equal((events.at(-1) as Extract<StreamEvent, { type: "error" }>).code, "MODEL_BUSY");
      assert.ok(!events.some((e) => e.type === "done"), "no done event after a mid-stream error");
    });
  } finally {
    mock.restore();
  }
});

/* --------------------------------------------------------------- validation */

test("an unregistered provider is refused before any adapter call", async () => {
  const mock = mockUpstream(() => {
    throw new Error("must not be called");
  });
  try {
    const response = await POST(
      postRequest({ provider: "nonsense", messages: [{ role: "user", content: "hi" }] }),
    );
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.code, "PROVIDER_DISABLED");
  } finally {
    mock.restore();
  }
});

test("a missing key is reported without ever attempting a request", async () => {
  const mock = mockUpstream(() => {
    throw new Error("must not be called");
  });
  delete process.env.OPENAI_API_KEY;
  try {
    const response = await POST(
      postRequest({ provider: "gpt", messages: [{ role: "user", content: "hi" }] }),
    );
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.code, "MISSING_KEY");
  } finally {
    mock.restore();
  }
});

test("a malformed body returns a normalized error, not a raw exception", async () => {
  const request = new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not json",
  });
  const response = await POST(request);
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.code, "BAD_REQUEST");
});

/* --------------------------------------------------- F4: normalized errors */

test("F4: a JSON body of null returns a normalized BAD_REQUEST, not an uncaught TypeError", async () => {
  const mock = mockUpstream(() => {
    throw new Error("must not be called");
  });
  try {
    const response = await POST(postRequest(null));
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "BAD_REQUEST");
  } finally {
    mock.restore();
  }
});

test("F4: a JSON array or primitive body is also rejected, not crashed on", async () => {
  const mock = mockUpstream(() => {
    throw new Error("must not be called");
  });
  try {
    for (const payload of [[], "just a string", 42, true]) {
      const response = await POST(postRequest(payload));
      assert.equal(response.status, 400, JSON.stringify(payload));
      const body = await response.json();
      assert.equal(body.code, "BAD_REQUEST", JSON.stringify(payload));
    }
  } finally {
    mock.restore();
  }
});

test("F4: a null entry inside messages returns a normalized error, zero adapter calls", async () => {
  const mock = mockUpstream(() => {
    throw new Error("must not be called");
  });
  try {
    await withKey(async () => {
      const response = await POST(
        postRequest({ provider: "gpt", messages: [null] }),
      );
      assert.equal(response.status, 400);
      const body = await response.json();
      assert.equal(body.code, "BAD_REQUEST");
      assert.equal(mock.calls.length, 0);
    });
  } finally {
    mock.restore();
  }
});

test("F4: a message with a wrong role, blank content, or non-string content is rejected", async () => {
  const mock = mockUpstream(() => {
    throw new Error("must not be called");
  });
  try {
    await withKey(async () => {
      for (const messages of [
        [{ role: "system", content: "hi" }],
        [{ role: "user", content: "   " }],
        [{ role: "user", content: 42 }],
        [{ role: "user" }],
        ["just a string"],
      ]) {
        const response = await POST(postRequest({ provider: "gpt", messages }));
        assert.equal(response.status, 400, JSON.stringify(messages));
        const body = await response.json();
        assert.equal(body.code, "BAD_REQUEST", JSON.stringify(messages));
      }
      assert.equal(mock.calls.length, 0);
    });
  } finally {
    mock.restore();
  }
});

test("F4: __proto__ and constructor provider ids are refused as disabled, never treated as an inherited adapter", async () => {
  const mock = mockUpstream(() => {
    throw new Error("must not be called");
  });
  try {
    for (const provider of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      const response = await POST(
        postRequest({ provider, messages: [{ role: "user", content: "hi" }] }),
      );
      assert.equal(response.status, 403, provider);
      const body = await response.json();
      assert.equal(body.code, "PROVIDER_DISABLED", provider);
    }
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

test("F4: a non-string provider field is refused as disabled rather than coerced", async () => {
  const mock = mockUpstream(() => {
    throw new Error("must not be called");
  });
  try {
    for (const provider of [{}, [], 42, true, null]) {
      const response = await POST(
        postRequest({ provider, messages: [{ role: "user", content: "hi" }] }),
      );
      assert.equal(response.status, 403, JSON.stringify(provider));
    }
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

/* ------------------------------------------------------ Personalizations */

test("Personalizations: a valid preferences field reaches the real adapter and maps onto its request", async () => {
  const mock = mockUpstream(() =>
    sse({ type: "response.output_text.delta", delta: "ok" }, { type: "response.completed" }),
  );
  try {
    await withKey(async () => {
      const response = await POST(
        postRequest({
          provider: "gpt",
          messages: [{ role: "user", content: "hi" }],
          preferences: { preferredName: "Sam", customInstructions: "Be brief." },
        }),
      );
      assert.equal(response.status, 200);
      const body = JSON.parse(String(mock.calls[0].body));
      assert.equal(body.input[0].role, "developer");
      assert.match(body.input[0].content, /preferred name is "Sam"/);
      assert.match(body.input[0].content, /Be brief\./);
    });
  } finally {
    mock.restore();
  }
});

test("Personalizations: an oversized preferredName is refused with BAD_REQUEST, zero adapter calls", async () => {
  const mock = mockUpstream(() => {
    throw new Error("must not be called");
  });
  try {
    await withKey(async () => {
      const response = await POST(
        postRequest({
          provider: "gpt",
          messages: [{ role: "user", content: "hi" }],
          preferences: { preferredName: "x".repeat(MAX_PREFERRED_NAME_CHARS + 1), customInstructions: "" },
        }),
      );
      const payload = await response.json();
      assert.equal(response.status, 400);
      assert.equal(payload.code, "BAD_REQUEST");
    });
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

test("Personalizations: oversized customInstructions is also refused with BAD_REQUEST, zero adapter calls", async () => {
  const mock = mockUpstream(() => {
    throw new Error("must not be called");
  });
  try {
    await withKey(async () => {
      const response = await POST(
        postRequest({
          provider: "gpt",
          messages: [{ role: "user", content: "hi" }],
          preferences: { preferredName: "", customInstructions: "x".repeat(MAX_CUSTOM_INSTRUCTIONS_CHARS + 1) },
        }),
      );
      assert.equal(response.status, 400);
    });
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

test("Personalizations: a malformed preferences shape (wrong field types) is refused with BAD_REQUEST", async () => {
  const mock = mockUpstream(() => {
    throw new Error("must not be called");
  });
  try {
    await withKey(async () => {
      for (const bad of [{ preferredName: 5, customInstructions: "" }, "not an object", null, []]) {
        const response = await POST(
          postRequest({ provider: "gpt", messages: [{ role: "user", content: "hi" }], preferences: bad }),
        );
        assert.equal(response.status, 400, JSON.stringify(bad));
      }
    });
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

test("Personalizations: no preferences field at all still succeeds exactly as before this existed", async () => {
  const mock = mockUpstream(() =>
    sse({ type: "response.output_text.delta", delta: "ok" }, { type: "response.completed" }),
  );
  try {
    await withKey(async () => {
      const response = await POST(
        postRequest({ provider: "gpt", messages: [{ role: "user", content: "hi" }] }),
      );
      assert.equal(response.status, 200);
      const body = JSON.parse(String(mock.calls[0].body));
      assert.deepEqual(body.input, [{ role: "user", content: "hi" }]);
    });
  } finally {
    mock.restore();
  }
});

/* ------------------------------------------- Project 4: document grounding */

/**
 * These exercise `/api/chat`'s document path through the real handler.
 *
 * `mockUpstream` throws on any URL except the OpenAI endpoint, so these also
 * prove something worth proving: when the uploaded files cannot be read, the
 * provider is NEVER called. An answer that looked file-based but was not is
 * the failure these guard against, and `mock.calls.length === 0` is what
 * shows it did not happen.
 *
 * No `BLOB_READ_WRITE_TOKEN` is set in the test environment, so the store
 * declines before any request leaves the process.
 */

const DOCUMENT_ID = "A".repeat(43);

test("documents: a malformed document id fails the request rather than being ignored", async () => {
  const mock = mockUpstream(() => sse({ type: "response.completed" }));
  try {
    await withKey(async () => {
      for (const documentIds of [
        ["../../etc/passwd"],
        ["short"],
        [""],
        ["a/b"],
        [42],
        [null],
        "not-an-array",
        [{}],
      ]) {
        const response = await POST(
          postRequest({
            provider: "gpt",
            messages: [{ role: "user", content: "what is the total?" }],
            conversationId: "conv-1",
            documentIds,
          }),
        );
        assert.equal(response.status, 400, JSON.stringify(documentIds));
        const payload = (await response.json()) as { code?: string };
        assert.equal(payload.code, "BAD_REQUEST");
      }
    });
    assert.equal(mock.calls.length, 0, "a malformed reference must never reach a provider");
  } finally {
    mock.restore();
  }
});

test("documents: more ids than the per-conversation cap is refused", async () => {
  const mock = mockUpstream(() => sse({ type: "response.completed" }));
  try {
    await withKey(async () => {
      const documentIds = Array.from({ length: 11 }, (_, i) =>
        `${String.fromCharCode(66 + i)}`.repeat(43),
      );
      const response = await POST(
        postRequest({
          provider: "gpt",
          messages: [{ role: "user", content: "hi" }],
          conversationId: "conv-1",
          documentIds,
        }),
      );
      assert.equal(response.status, 400);
    });
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

test("documents: ids without a conversation id are refused, since nothing could authorise them", async () => {
  const mock = mockUpstream(() => sse({ type: "response.completed" }));
  try {
    await withKey(async () => {
      for (const conversationId of [undefined, "", "../../x", "has space", "x".repeat(129)]) {
        const response = await POST(
          postRequest({
            provider: "gpt",
            messages: [{ role: "user", content: "hi" }],
            ...(conversationId === undefined ? {} : { conversationId }),
            documentIds: [DOCUMENT_ID],
          }),
        );
        assert.equal(response.status, 400, String(conversationId));
      }
    });
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

test("documents: files that cannot be read FAIL the turn instead of answering ungrounded", async () => {
  const mock = mockUpstream(() => sse({ type: "response.completed" }));
  try {
    await withKey(async () => {
      const response = await POST(
        postRequest({
          provider: "gpt",
          messages: [{ role: "user", content: "what does the contract say about termination?" }],
          conversationId: "conv-1",
          documentIds: [DOCUMENT_ID],
        }),
      );
      assert.equal(response.status, 502);
      const payload = (await response.json()) as { code?: string };
      assert.equal(payload.code, "DOCUMENT_SEARCH_FAILED");
    });
    // The point of the whole error code: the model was not asked a question
    // about documents nobody could read.
    assert.equal(mock.calls.length, 0, "the provider must not be called when retrieval found nothing");
  } finally {
    mock.restore();
  }
});

test("documents: an empty documentIds array behaves exactly like no documents at all", async () => {
  const mock = mockUpstream(() =>
    sse({ type: "response.output_text.delta", delta: "ok" }, { type: "response.completed" }),
  );
  try {
    await withKey(async () => {
      const response = await POST(
        postRequest({
          provider: "gpt",
          messages: [{ role: "user", content: "hi" }],
          conversationId: "conv-1",
          documentIds: [],
        }),
      );
      assert.equal(response.status, 200);
      const body = JSON.parse(String(mock.calls[0].body));
      // No retrieval ran, so no instructions were added: byte-for-byte the
      // request this endpoint sent before documents existed.
      assert.deepEqual(body.input, [{ role: "user", content: "hi" }]);
      assert.equal(body.instructions, undefined);
    });
  } finally {
    mock.restore();
  }
});

test("documents: a conversation with no files sends no document fields and is unaffected", async () => {
  const mock = mockUpstream(() =>
    sse({ type: "response.output_text.delta", delta: "ok" }, { type: "response.completed" }),
  );
  try {
    await withKey(async () => {
      const response = await POST(
        postRequest({ provider: "gpt", messages: [{ role: "user", content: "hi" }] }),
      );
      assert.equal(response.status, 200);
      const events = await readEvents(response);
      assert.ok(events.some((e) => e.type === "done"));
    });
  } finally {
    mock.restore();
  }
});


/** The system instruction as THIS adapter sends it: a leading developer message. */
function systemInstructionOf(call: RequestInit): string | undefined {
  const body = JSON.parse(String(call.body)) as { input?: { role: string; content: string }[] };
  const first = body.input?.[0];
  return first && first.role === "developer" ? first.content : undefined;
}

/* ------------------------- Project 4 fix: the file-capability note ------- */

/**
 * The reported bug: asked to "create a Word document", the app answered
 * "I can't directly create downloadable docs or PDF files."
 *
 * That was true of the MODEL and false of the APP -- `SaveAnswerMenu` turns
 * any answer into a real .docx/.pdf/.xlsx. Nothing ever told the model the
 * capability existed, so it declined. These assert that it is now told, and
 * equally important, that it is told ONLY when relevant: a request with no
 * preferences, no documents and no file ask must still send no system
 * instruction at all.
 */

test("a request for a Word document tells the model the app can produce one", async () => {
  const mock = mockUpstream(() =>
    sse({ type: "response.output_text.delta", delta: "ok" }, { type: "response.completed" }),
  );
  try {
    await withKey(async () => {
      const response = await POST(
        postRequest({
          provider: "gpt",
          messages: [{ role: "user", content: "Create a Word document summarising remote work." }],
        }),
      );
      assert.equal(response.status, 200);
      const instruction = systemInstructionOf(mock.calls[0]);
      assert.ok(instruction, "a file request must carry a system instruction");
      assert.match(instruction, /download button/i);
      assert.match(instruction, /never say you cannot create files/i);
      // It must NOT tell the user to go hunting for a menu: the card has the
      // button, and duplicate instructions are how a reply ends up padded
      // with "to save this, use ..." boilerplate.
      assert.match(instruction, /do not explain how to save/i);
    });
  } finally {
    mock.restore();
  }
});

test("every file wording that was reported, and the obvious neighbours, are recognised", async () => {
  const mock = mockUpstream(() =>
    sse({ type: "response.output_text.delta", delta: "ok" }, { type: "response.completed" }),
  );
  try {
    await withKey(async () => {
      const asks = [
        "Create a Word document summarising the benefits of remote work.",
        "Can you make me a PDF of this?",
        "Export this as an Excel spreadsheet",
        "Give me a downloadable file",
        "Write a report on Q3 performance",
        "generate a csv of the results",
        "draft a letter to the supplier",
        "produce a docx version",
      ];
      for (const content of asks) {
        mock.calls.length = 0;
        const response = await POST(postRequest({ provider: "gpt", messages: [{ role: "user", content }] }));
        assert.equal(response.status, 200, content);
        const instruction = systemInstructionOf(mock.calls[0]);
        assert.ok(instruction, `not recognised as a file request: ${content}`);
        assert.match(instruction, /download button/i, content);
      }
    });
  } finally {
    mock.restore();
  }
});

test("an ordinary question still sends NO system instruction at all", async () => {
  const mock = mockUpstream(() =>
    sse({ type: "response.output_text.delta", delta: "ok" }, { type: "response.completed" }),
  );
  try {
    await withKey(async () => {
      for (const content of ["hi", "what is the capital of France?", "explain recursion"]) {
        mock.calls.length = 0;
        const response = await POST(postRequest({ provider: "gpt", messages: [{ role: "user", content }] }));
        assert.equal(response.status, 200, content);
        assert.equal(
          systemInstructionOf(mock.calls[0]),
          undefined,
          `a non-file question must stay byte-identical to before: ${content}`,
        );
      }
    });
  } finally {
    mock.restore();
  }
});

test("the capability note does not displace the user's own preferences", async () => {
  const mock = mockUpstream(() =>
    sse({ type: "response.output_text.delta", delta: "ok" }, { type: "response.completed" }),
  );
  try {
    await withKey(async () => {
      const response = await POST(
        postRequest({
          provider: "gpt",
          messages: [{ role: "user", content: "Write me a report as a PDF." }],
          preferences: { preferredName: "Sam", customInstructions: "Be concise." },
        }),
      );
      assert.equal(response.status, 200);
      const instruction = systemInstructionOf(mock.calls[0]) ?? "";
      assert.match(instruction, /preferred name is "Sam"/);
      assert.match(instruction, /Be concise\./);
      assert.match(instruction, /download button/i);
    });
  } finally {
    mock.restore();
  }
});
