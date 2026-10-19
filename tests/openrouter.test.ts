import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyOpenRouterError, toModelMessages } from "@/server/providers/openrouter";
import { OPENROUTER_CHAT_MODELS, findOpenRouterModel, IMAGE_CAPABLE_MODELS, DEFAULT_IMAGE_MODEL } from "@/lib/models";
import { PROVIDERS } from "@/lib/providers";
import type { WireMessage } from "@/lib/chat";

/**
 * Project 3 unit tests for the pure, provider-independent logic:
 * message serialisation under each model's declared capabilities, error
 * classification, and the catalogue invariants that keep the selector and the
 * adapters from disagreeing.
 *
 * NOTE ON SCOPE: nothing here calls OpenRouter. These tests prove the parts
 * that are decidable without spending a provider call. The live round trips --
 * a real image analysed by each of the two vision models, a real generated
 * image, a real model-selected tool call -- are NOT covered here and are not
 * claimed to be verified anywhere else either; see PROJECT3_PROGRESS.md, which
 * records what the live run did and did not reach. The key IS configured; the
 * account has no credit, which is why the paid models return 402.
 */

const IMAGE_B64 = "iVBORw0KGgo=";

function userWithImage(content = "What is in this picture?"): WireMessage {
  return {
    role: "user",
    content,
    attachments: [{ kind: "image", mimeType: "image/png", name: "shot.png", data: IMAGE_B64 }],
  };
}

/* --------------------------------------------- capability-aware serialising */

test("a vision model receives the image as a real image part", () => {
  const [message] = toModelMessages([userWithImage()], true);
  assert.equal(message.role, "user");
  assert.ok(Array.isArray(message.content));
  const parts = message.content as Array<{ type: string; image?: string; mediaType?: string }>;
  const image = parts.find((p) => p.type === "image");
  assert.ok(image, "expected an image part");
  assert.equal(image.mediaType, "image/png");
  assert.ok(image.image?.startsWith("data:image/png;base64,"));
});

test("a text-only model never receives an image part, and the image is NOT silently dropped", () => {
  const [message] = toModelMessages([userWithImage()], false);
  const parts = message.content as Array<{ type: string; text?: string }>;
  assert.equal(
    parts.some((p) => p.type === "image"),
    false,
    "a text-only model must not be sent image parts",
  );
  const text = parts.find((p) => p.type === "text")?.text ?? "";
  assert.match(text, /shot\.png/, "the attachment must still be named in the text");
  assert.match(text, /cannot read images/i);
});

test("text attachments reach a text-only model unchanged", () => {
  const message: WireMessage = {
    role: "user",
    content: "Review this.",
    attachments: [{ kind: "text", mimeType: "text/plain", name: "notes.txt", text: "hello world" }],
  };
  const [converted] = toModelMessages([message], false);
  const parts = converted.content as Array<{ type: string; text?: string }>;
  assert.ok(parts.some((p) => p.type === "text" && p.text?.includes("hello world")));
});

test("messages without attachments stay plain strings for both roles", () => {
  const converted = toModelMessages(
    [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ],
    true,
  );
  assert.equal(converted[0].content, "hi");
  assert.equal(converted[1].role, "assistant");
  assert.equal(converted[1].content, "hello");
});

test("conversation order and length are preserved across serialisation", () => {
  const history: WireMessage[] = [
    { role: "user", content: "one" },
    { role: "assistant", content: "two" },
    userWithImage("three"),
  ];
  const converted = toModelMessages(history, true);
  assert.equal(converted.length, 3);
  assert.equal(converted[0].content, "one");
  assert.equal(converted[1].content, "two");
  // The third kept its text as the FIRST part, so the question still leads.
  const parts = converted[2].content as Array<{ type: string; text?: string }>;
  assert.equal(parts[0].type, "text");
  assert.match(parts[0].text ?? "", /three/);
});

/* ------------------------------------------------------ error classification */

test("HTTP status codes map onto the shared error vocabulary", () => {
  const cases: [number, string][] = [
    [401, "INVALID_KEY"],
    [403, "INVALID_KEY"],
    [402, "INSUFFICIENT_CREDIT"],
    [429, "RATE_LIMIT"],
    [400, "BAD_REQUEST"],
    [503, "MODEL_BUSY"],
    [500, "UPSTREAM"],
  ];
  for (const [status, expected] of cases) {
    const error = classifyOpenRouterError({ statusCode: status, message: "x" });
    assert.equal(error.code, expected, `status ${status}`);
  }
});

test("only transient classes are marked retryable", () => {
  assert.equal(classifyOpenRouterError({ statusCode: 429 }).retryable, true);
  assert.equal(classifyOpenRouterError({ statusCode: 503 }).retryable, true);
  assert.equal(classifyOpenRouterError({ statusCode: 401 }).retryable, false);
  assert.equal(classifyOpenRouterError({ statusCode: 400 }).retryable, false);
});

/**
 * Found by live testing against the deployed app, not by reading code: a real
 * OpenRouter 402 arrives with its status intact through `generateText`, but
 * the SAME failure through `streamText` reaches the classifier WRAPPED, so a
 * top-level status read missed it and every billing failure was reported as a
 * generic UPSTREAM "could not reach the provider" -- the opposite advice to
 * the truth. These cover each wrapper shape the SDK uses.
 */
test("a 402 nested inside a wrapper is still INSUFFICIENT_CREDIT", () => {
  const wrapped = { name: "AI_RetryError", message: "failed after 3 attempts", cause: { statusCode: 402 } };
  assert.equal(classifyOpenRouterError(wrapped).code, "INSUFFICIENT_CREDIT");
});

test("a 402 nested two levels deep is found", () => {
  const deep = { message: "x", cause: { message: "y", cause: { statusCode: 402 } } };
  assert.equal(classifyOpenRouterError(deep).code, "INSUFFICIENT_CREDIT");
});

test("a retry error carrying the status in `lastError` is found", () => {
  assert.equal(
    classifyOpenRouterError({ name: "AI_RetryError", lastError: { statusCode: 429 } }).code,
    "RATE_LIMIT",
  );
});

test("an errors[] array is searched too", () => {
  assert.equal(
    classifyOpenRouterError({ errors: [{ message: "a" }, { statusCode: 401 }] }).code,
    "INVALID_KEY",
  );
});

test("OpenRouter's credit wording is matched even with no status anywhere", () => {
  for (const message of [
    "This request requires more credits, or fewer max_tokens",
    "Insufficient credit to run this model",
    "You can only afford 0 tokens",
  ]) {
    assert.equal(classifyOpenRouterError({ message }).code, "INSUFFICIENT_CREDIT", message);
  }
});

test("a credit message found in a nested responseBody is matched", () => {
  const error = { message: "API call failed", cause: { responseBody: '{"error":{"message":"requires more credits"}}' } };
  assert.equal(classifyOpenRouterError(error).code, "INSUFFICIENT_CREDIT");
});

test("a cyclic error object does not hang the classifier", () => {
  const a: Record<string, unknown> = { message: "boom" };
  a.cause = a;
  assert.equal(classifyOpenRouterError(a).code, "UPSTREAM");
});

test("an abort is classified as ABORTED, never as a provider failure", () => {
  assert.equal(classifyOpenRouterError({ name: "AbortError" }).code, "ABORTED");
});

test("a transport failure with no status is NETWORK and retryable", () => {
  const error = classifyOpenRouterError(new TypeError("fetch failed"));
  assert.equal(error.code, "NETWORK");
  assert.equal(error.retryable, true);
});

/* ------------------------------------------------------- catalogue integrity */

test("every catalogue model is offered by the selector, with matching capabilities", () => {
  for (const model of OPENROUTER_CHAT_MODELS) {
    const listed = PROVIDERS.find((p) => p.id === model.id);
    assert.ok(listed, `${model.id} is missing from PROVIDERS`);
    assert.equal(
      listed.vision,
      model.capabilities.vision,
      `${model.id}: the selector and the catalogue disagree about vision support`,
    );
  }
});

test("at least two DISTINCT vision models are configured", () => {
  const vision = OPENROUTER_CHAT_MODELS.filter((m) => m.capabilities.vision);
  assert.ok(vision.length >= 2, "Project 3 requires two vision-capable models");
  const openrouterIds = new Set(vision.map((m) => m.openrouterId));
  assert.equal(openrouterIds.size, vision.length, "two entries point at the same model id");
  const vendors = new Set(vision.map((m) => m.openrouterId.split("/")[0]));
  assert.ok(vendors.size >= 2, "the two vision models must not be from one vendor");
});

test("a text-only model is configured, so the capability gate is reachable", () => {
  assert.ok(OPENROUTER_CHAT_MODELS.some((m) => !m.capabilities.vision));
});

test("the default image model is one of the image-capable models", () => {
  assert.ok(IMAGE_CAPABLE_MODELS.includes(DEFAULT_IMAGE_MODEL));
});

test("findOpenRouterModel resolves only real ids", () => {
  assert.ok(findOpenRouterModel("or-claude"));
  assert.equal(findOpenRouterModel("gemini"), null);
  assert.equal(findOpenRouterModel("__proto__"), null);
});
