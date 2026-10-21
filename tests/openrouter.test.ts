import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyOpenRouterError, toModelMessages } from "@/server/providers/openrouter";
import {
  OPENROUTER_CHAT_MODELS,
  findOpenRouterModel,
  isOpenRouterModelId,
  IMAGE_CAPABLE_MODELS,
  DEFAULT_IMAGE_MODEL,
} from "@/lib/models";
import { DEFAULT_PROVIDER, migrateProviderId, PROVIDERS } from "@/lib/providers";
import type { WireMessage } from "@/lib/chat";
import { migrateBackgroundId } from "@/lib/backgrounds";

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

/**
 * Catalogue-simplification pass. The requirement is still "at least two
 * distinct vision-capable models the user can select" -- what changed is
 * WHERE they come from: the two direct integrations rather than two extra
 * OpenRouter entries. This asserts the requirement against the selector the
 * user actually sees, which is the thing that has to hold.
 */
test("at least two DISTINCT vision models are selectable", () => {
  const vision = PROVIDERS.filter((p) => p.vision && p.enabled);
  assert.ok(vision.length >= 2, "two vision-capable models must be selectable");
  const ids = new Set(vision.map((p) => p.id));
  assert.equal(ids.size, vision.length, "two entries share an id");
});

/**
 * The brief's technology list asks for vision-capable models reached THROUGH
 * OpenRouter, not merely for vision to work somehow. Gemini and OpenAI are
 * direct integrations and bypass OpenRouter entirely, so this asserts the
 * routing requirement separately from the capability requirement above.
 */
test("at least one vision model is reached through OpenRouter", () => {
  const visionViaOpenRouter = OPENROUTER_CHAT_MODELS.filter((m) => m.capabilities.vision);
  assert.ok(
    visionViaOpenRouter.length >= 1,
    "the technology requirement needs a vision model routed through OpenRouter",
  );
  for (const model of visionViaOpenRouter) {
    assert.ok(
      PROVIDERS.some((p) => p.id === model.id && p.vision && p.enabled),
      `${model.id} must be selectable and advertised as vision-capable`,
    );
  }
});

test("the OpenRouter vision model is Mistral Small 3.2, from a third vendor", () => {
  const mistral = findOpenRouterModel("or-mistral");
  assert.ok(mistral, "or-mistral must be registered");
  assert.equal(mistral.openrouterId, "mistralai/mistral-small-3.2-24b-instruct");
  assert.equal(mistral.capabilities.vision, true);
  // Distinct from the two direct integrations' vendors, so "distinct vision
  // models" holds however it is counted.
  assert.equal(mistral.openrouterId.split("/")[0], "mistralai");
});

test("the OpenRouter vision model also hosts the image tool", () => {
  // Every OpenRouter chat model gets the tool (openrouter.ts), so a vision
  // model there can both read an image and be asked to generate one.
  const ids = OPENROUTER_CHAT_MODELS.map((m) => m.id);
  assert.ok(ids.includes("or-mistral"));
  assert.ok(ids.includes("or-deepseek"));
});

test("an image is serialised for the OpenRouter vision model, not stripped", () => {
  const model = findOpenRouterModel("or-mistral");
  assert.ok(model);
  const [message] = toModelMessages([userWithImage()], model.capabilities.vision);
  const parts = message.content as Array<{ type: string }>;
  assert.ok(parts.some((p) => p.type === "image"), "the image part must survive");
});

test("the two vision models are the direct Gemini and OpenAI integrations", () => {
  const vision = PROVIDERS.filter((p) => p.vision && p.enabled).map((p) => p.id);
  assert.ok(vision.includes("gemini"), "Gemini must remain a selectable vision model");
  assert.ok(vision.includes("gpt"), "OpenAI must remain a selectable vision model");
  // Adding the OpenRouter vision model must not have displaced either.
  assert.ok(vision.length >= 3, "all three vision models should be selectable");
});

test("the removed models are no longer selectable anywhere", () => {
  for (const removed of ["or-claude", "or-qwen"]) {
    assert.equal(
      PROVIDERS.some((p) => p.id === removed),
      false,
      `${removed} is still in the selector`,
    );
    assert.equal(findOpenRouterModel(removed), null, `${removed} is still in the catalogue`);
    assert.equal(isOpenRouterModelId(removed), false);
  }
});

test("a text-only model is configured, so the capability gate is reachable", () => {
  assert.ok(OPENROUTER_CHAT_MODELS.some((m) => !m.capabilities.vision));
});

/**
 * `openrouter.ts` is the only adapter that attaches the `generate_image`
 * tool, so at least one OpenRouter chat model has to stay registered or
 * model-SELECTED generation silently becomes button-only -- the exact
 * substitution the requirement forbids. This is the unit-level guard; the
 * live proof is the production smoke test recorded in PROJECT3_PROGRESS.md.
 */
test("an OpenRouter chat model remains registered to host the image tool", () => {
  assert.ok(
    OPENROUTER_CHAT_MODELS.length >= 1,
    "removing every OpenRouter chat model would remove model-selected tool calling",
  );
  const listed = OPENROUTER_CHAT_MODELS.every((m) => PROVIDERS.some((p) => p.id === m.id));
  assert.ok(listed, "a catalogue model is not offered in the selector");
});

test("DeepSeek specifically is the retained tool host", () => {
  const deepseek = findOpenRouterModel("or-deepseek");
  assert.ok(deepseek, "or-deepseek must stay registered");
  assert.equal(deepseek.openrouterId, "deepseek/deepseek-chat-v3.1");
  assert.equal(deepseek.capabilities.vision, false);
});

/* ------------------------------------------- persisted provider migration */

test("a conversation saved with a removed model id migrates to a real one", () => {
  assert.equal(migrateProviderId("or-claude"), "gemini");
  assert.equal(migrateProviderId("or-qwen"), "gemini");
});

test("current ids pass through migration unchanged", () => {
  for (const id of ["gemini", "gpt", "or-deepseek"] as const) {
    assert.equal(migrateProviderId(id), id);
  }
});

test("the background migration shares the same prototype-safety guard", () => {
  // Same class of bug, same fix: a persisted string must never resolve to an
  // inherited Object.prototype value.
  assert.equal(migrateBackgroundId("__proto__"), "pearl");
  assert.equal(migrateBackgroundId("constructor"), "pearl");
  assert.equal(migrateBackgroundId("obsidian"), "aurora");
});

test("an unknown or malformed provider id falls back to the default", () => {
  assert.equal(migrateProviderId("nonsense"), DEFAULT_PROVIDER);
  assert.equal(migrateProviderId(undefined), DEFAULT_PROVIDER);
  assert.equal(migrateProviderId(null), DEFAULT_PROVIDER);
  assert.equal(migrateProviderId("__proto__"), DEFAULT_PROVIDER);
});

test("the default image model is one of the image-capable models", () => {
  assert.ok(IMAGE_CAPABLE_MODELS.includes(DEFAULT_IMAGE_MODEL));
});

test("findOpenRouterModel resolves only real ids", () => {
  assert.ok(findOpenRouterModel("or-deepseek"));
  // A direct integration is not an OpenRouter model.
  assert.equal(findOpenRouterModel("gemini"), null);
  assert.equal(findOpenRouterModel("gpt"), null);
  assert.equal(findOpenRouterModel("__proto__"), null);
});
