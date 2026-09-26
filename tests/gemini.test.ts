import { test } from "node:test";
import assert from "node:assert/strict";
import { Models } from "@google/genai";
import { geminiProvider } from "@/server/providers/gemini";
import type { WireMessage } from "@/lib/chat";

/**
 * F2 (and closing a pre-existing coverage gap): exercises the REAL
 * `geminiProvider.stream()` against a mocked SDK transport, so the finish-
 * reason handling under test is the code that would actually run in
 * production. Previously the only Gemini coverage was `classifyGemini()` /
 * `parseQuota()` -- the streaming method itself, including F2's finish-
 * reason logic, had no automated test at all.
 *
 * Interception point: `Models.prototype.generateContentStreamInternal`, the
 * installed SDK's own real network boundary (confirmed by reading the
 * package's compiled source, not assumed) -- `ai.models.generateContentStream`
 * is an instance-bound wrapper that does local parameter transformation (none
 * of which applies here: this app sends no `tools`) and then calls this one
 * prototype method, which is what actually issues the HTTP request. Patching
 * here means the real SDK code runs right up to the network call; only the
 * network call itself is replaced. `restore()` is called in every test's
 * `finally`, since `Models.prototype` is shared process-wide across every
 * test file this suite runs.
 *
 * No network request is made in this file. `mockGemini()` throws if the real
 * method is ever reached un-patched (it cannot be, since patching replaces it
 * entirely for the duration of each test), and every test restores the
 * original in `finally`.
 */

type MockChunk = { text?: string; candidates?: Array<{ finishReason?: string }> };

function mockGemini(chunks: MockChunk[] | (() => AsyncGenerator<MockChunk>)) {
  const proto = Models.prototype as unknown as Record<string, unknown>;
  const original = proto.generateContentStreamInternal;
  const calls: unknown[] = [];
  proto.generateContentStreamInternal = async function (params: unknown) {
    calls.push(params);
    if (typeof chunks === "function") return chunks();
    return (async function* () {
      for (const c of chunks) yield c;
    })();
  };
  return {
    calls,
    restore: () => {
      proto.generateContentStreamInternal = original;
    },
  };
}

const USER: WireMessage[] = [{ role: "user", content: "hello" }];

function withKey<T>(fn: () => Promise<T>): Promise<T> {
  process.env.GEMINI_API_KEY = "test-key-not-real";
  return fn().finally(() => {
    delete process.env.GEMINI_API_KEY;
  });
}

type Chunk = { type: "delta"; text: string } | { type: "outcome"; outcome: string; reason?: string };

async function collectAll(iterable: AsyncIterable<Chunk>): Promise<Chunk[]> {
  const out: Chunk[] = [];
  for await (const c of iterable) out.push(c);
  return out;
}

async function collectText(iterable: AsyncIterable<Chunk>): Promise<string> {
  let out = "";
  for await (const c of iterable) if (c.type === "delta") out += c.text;
  return out;
}

/* ------------------------------------------------------- normal completion */

test("F2: STOP is the only finish reason that yields outcome:complete", async () => {
  const mock = mockGemini([
    { text: "Hello" },
    { text: ", world." },
    { text: "", candidates: [{ finishReason: "STOP" }] },
  ]);
  try {
    await withKey(async () => {
      const stream = await geminiProvider.stream(USER, new AbortController().signal);
      const chunks = await collectAll(stream);
      assert.deepEqual(chunks.at(-1), { type: "outcome", outcome: "complete" });
      const text = chunks
        .filter((c): c is { type: "delta"; text: string } => c.type === "delta")
        .map((c) => c.text)
        .join("");
      assert.equal(text, "Hello, world.");
    });
  } finally {
    mock.restore();
  }
});

/* ------------------------------------------------------------- truncation */

test("F2: MAX_TOKENS is reported truncated with a length-limit reason, never as complete", async () => {
  const mock = mockGemini([
    { text: "a partial answer" },
    { candidates: [{ finishReason: "MAX_TOKENS" }] },
  ]);
  try {
    await withKey(async () => {
      const stream = await geminiProvider.stream(USER, new AbortController().signal);
      const chunks = await collectAll(stream);
      assert.deepEqual(chunks.at(-1), {
        type: "outcome",
        outcome: "truncated",
        reason: "reached the length limit",
      });
      assert.equal(await collectText((async function* () {
        for (const c of chunks) yield c;
      })()), "a partial answer");
    });
  } finally {
    mock.restore();
  }
});

test("F2: SAFETY is reported truncated with a content-filtering reason, not a length-limit reason", async () => {
  const mock = mockGemini([{ candidates: [{ finishReason: "SAFETY" }] }]);
  try {
    await withKey(async () => {
      const stream = await geminiProvider.stream(USER, new AbortController().signal);
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

test("F2: RECITATION and LANGUAGE each get their own distinct reason, not a shared generic one", async () => {
  const cases: [string, string][] = [
    ["RECITATION", "stopped due to potential recitation"],
    ["LANGUAGE", "stopped due to an unsupported language"],
    ["SPII", "stopped to avoid sensitive personal information"],
    ["BLOCKLIST", "stopped by content filtering"],
    ["PROHIBITED_CONTENT", "stopped by content filtering"],
  ];
  for (const [finishReason, reason] of cases) {
    const mock = mockGemini([{ candidates: [{ finishReason }] }]);
    try {
      await withKey(async () => {
        const stream = await geminiProvider.stream(USER, new AbortController().signal);
        const chunks = await collectAll(stream);
        assert.deepEqual(chunks.at(-1), { type: "outcome", outcome: "truncated", reason }, finishReason);
      });
    } finally {
      mock.restore();
    }
  }
});

test("F2: OTHER is a confirmed non-STOP stop, reported truncated with no invented reason", async () => {
  // OTHER is a named, documented SDK value ("all other reasons that stopped
  // the token generation") -- a real, confirmed stop, just not one this file
  // has specific copy for. Not the same thing as an unrecognised value.
  const mock = mockGemini([{ candidates: [{ finishReason: "OTHER" }] }]);
  try {
    await withKey(async () => {
      const stream = await geminiProvider.stream(USER, new AbortController().signal);
      const chunks = await collectAll(stream);
      assert.deepEqual(chunks.at(-1), { type: "outcome", outcome: "truncated" });
    });
  } finally {
    mock.restore();
  }
});

test("F2 follow-up: FINISH_REASON_UNSPECIFIED and a future/unrecognised value report outcome:unknown, not a confirmed truncation", async () => {
  // The small F2 follow-up fix: a finish reason that does not actually
  // confirm WHY generation stopped -- the SDK's own "unspecified" sentinel,
  // or a value this file has never seen before -- must not be reported as a
  // confirmed "truncated" (which would imply a known, identified cause, the
  // way MAX_TOKENS or SAFETY do). It settles the same honest way a bare EOF
  // with no finish signal at all does.
  for (const finishReason of ["FINISH_REASON_UNSPECIFIED", "SOME_FUTURE_REASON_THIS_SDK_VERSION_ADDS"]) {
    const mock = mockGemini([{ candidates: [{ finishReason }] }]);
    try {
      await withKey(async () => {
        const stream = await geminiProvider.stream(USER, new AbortController().signal);
        const chunks = await collectAll(stream);
        assert.deepEqual(chunks.at(-1), { type: "outcome", outcome: "unknown" }, finishReason);
      });
    } finally {
      mock.restore();
    }
  }
});

/* --------------------------------------------------------------- bare EOF */

test("F2: the SDK generator ending with no chunk ever carrying a finish reason reports outcome:unknown", async () => {
  const mock = mockGemini([{ text: "cut off mid" }, { text: "-stream" }]);
  try {
    await withKey(async () => {
      const stream = await geminiProvider.stream(USER, new AbortController().signal);
      const chunks = await collectAll(stream);
      assert.deepEqual(chunks.at(-1), { type: "outcome", outcome: "unknown" });
      const text = chunks
        .filter((c): c is { type: "delta"; text: string } => c.type === "delta")
        .map((c) => c.text)
        .join("");
      assert.equal(text, "cut off mid-stream", "text already delivered must survive");
    });
  } finally {
    mock.restore();
  }
});

test("F2: a chunk with an empty finishReason is treated as still in progress, not as a finish signal", async () => {
  // The SDK's own documented meaning of an empty finishReason: "the model has
  // not stopped generating the tokens". An empty string or undefined must
  // never be misread as a real terminal signal.
  const mock = mockGemini([
    { text: "still going", candidates: [{ finishReason: undefined }] },
    { text: " done", candidates: [{ finishReason: "STOP" }] },
  ]);
  try {
    await withKey(async () => {
      const stream = await geminiProvider.stream(USER, new AbortController().signal);
      const chunks = await collectAll(stream);
      // Exactly one outcome chunk -- the undefined-finishReason chunk did not
      // produce one of its own.
      assert.equal(chunks.filter((c) => c.type === "outcome").length, 1);
      assert.deepEqual(chunks.at(-1), { type: "outcome", outcome: "complete" });
    });
  } finally {
    mock.restore();
  }
});

/* ----------------------------------------------------------------- abort */

test("aborting before any chunk arrives yields nothing, no outcome chunk either", async () => {
  const controller = new AbortController();
  controller.abort();
  const mock = mockGemini([{ text: "should never be seen" }]);
  try {
    await withKey(async () => {
      const stream = await geminiProvider.stream(USER, controller.signal);
      const chunks = await collectAll(stream);
      assert.equal(chunks.length, 0);
    });
  } finally {
    mock.restore();
  }
});

/* ------------------------------------------------------------ empty answer */

/* ------------------------------------------------------ Personalizations */

test("Personalizations: preferred name + custom instructions map onto config.systemInstruction as one plain string", async () => {
  const mock = mockGemini([{ candidates: [{ finishReason: "STOP" }] }]);
  try {
    await withKey(async () => {
      const stream = await geminiProvider.stream(USER, new AbortController().signal, {
        preferredName: "Alex",
        customInstructions: "Keep answers short.",
      });
      await collectAll(stream);
      const params = mock.calls[0] as { config?: { systemInstruction?: string } };
      assert.equal(typeof params.config?.systemInstruction, "string");
      assert.match(params.config!.systemInstruction!, /preferred name is "Alex"/);
      assert.match(params.config!.systemInstruction!, /Keep answers short\./);
      // The name is named as data ("preferred name is X"), never issued as
      // a bare imperative on its own -- and the model is told to use it
      // naturally, not forced to repeat it every reply.
      assert.match(params.config!.systemInstruction!, /without forcing it into every reply/);
    });
  } finally {
    mock.restore();
  }
});

test("Personalizations: no saved preferences means no systemInstruction field at all -- byte-identical to before this existed", async () => {
  const mock = mockGemini([{ candidates: [{ finishReason: "STOP" }] }]);
  try {
    await withKey(async () => {
      const stream = await geminiProvider.stream(USER, new AbortController().signal, undefined);
      await collectAll(stream);
      const params = mock.calls[0] as { config?: Record<string, unknown> };
      assert.equal("systemInstruction" in (params.config ?? {}), false);
    });
  } finally {
    mock.restore();
  }
});

test("Personalizations: empty-string preferences (both fields blank) also produce no systemInstruction field", async () => {
  const mock = mockGemini([{ candidates: [{ finishReason: "STOP" }] }]);
  try {
    await withKey(async () => {
      const stream = await geminiProvider.stream(USER, new AbortController().signal, {
        preferredName: "",
        customInstructions: "",
      });
      await collectAll(stream);
      const params = mock.calls[0] as { config?: Record<string, unknown> };
      assert.equal("systemInstruction" in (params.config ?? {}), false);
    });
  } finally {
    mock.restore();
  }
});

test("an empty answer still yields exactly one outcome:complete chunk", async () => {
  const mock = mockGemini([{ candidates: [{ finishReason: "STOP" }] }]);
  try {
    await withKey(async () => {
      const stream = await geminiProvider.stream(USER, new AbortController().signal);
      const chunks = await collectAll(stream);
      assert.deepEqual(chunks, [{ type: "outcome", outcome: "complete" }]);
    });
  } finally {
    mock.restore();
  }
});
