import type {
  ChatErrorCode,
  ChatErrorInfo,
  StreamEvent,
  StreamOutcome,
  WireMessage,
} from "@/lib/chat";
import { MAX_CHARS, MAX_MESSAGES } from "@/lib/limits";
import { hasPreferences, validatePreferences, type Preferences } from "@/lib/preferences";
import { getProvider, providerAvailability } from "@/server/providers/registry";
import { ProviderError, type ProviderChunk } from "@/server/providers/types";
import { validateWireAttachments } from "@/server/attachments";
import { MAX_DOCUMENTS_PER_CONVERSATION } from "@/lib/documents";
import { buildDocumentContext } from "@/server/documents/retrieve";
import { isValidDocumentId } from "@/server/documents/store";
import { checkRateLimit, rateLimitResponse } from "@/server/rate-limit";

/**
 * Provider-neutral chat endpoint.
 *
 * This file contains NO vendor SDK, no model ids, and no provider-specific
 * error handling. It validates the request, dispatches through the registry,
 * and re-frames whatever the adapter yields as NDJSON. Adding a provider needs
 * a new adapter plus a registry entry — nothing here changes.
 *
 * API keys are read inside adapters, server-side only. They are never imported
 * into a client module and never prefixed NEXT_PUBLIC_, so they cannot reach
 * the browser bundle.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A streamed answer plus up to MAX_ATTEMPTS retries (with backoff) realistically
// finishes in well under a minute, but 300s -- the Hobby plan's own default AND
// maximum function duration -- is set explicitly here rather than left implicit,
// so a slow upstream response is never cut off mid-stream by a lower default a
// future project-level dashboard change could otherwise introduce.
export const maxDuration = 300;

const MAX_ATTEMPTS = 3;

function errorResponse(
  code: ChatErrorCode,
  status: number,
  detail?: string,
  info?: ChatErrorInfo,
) {
  return Response.json({ code, detail, info }, { status });
}

/**
 * Finding F4: a non-null, non-array object. `request.json()`'s result was
 * previously cast straight to a TypeScript type with no runtime check, so a
 * JSON body of `null` (a value `JSON.parse` accepts) threw a raw `TypeError`
 * reading `.provider` off it rather than returning the app's own normalized
 * error shape. `typeof null === "object"` is the classic trap this also
 * guards against.
 */
function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Finding F4: validates one history entry as a non-null object with an
 * allowed role and non-blank string content, before any of its fields are
 * dereferenced. Previously `messages.some(m => m.role !== ...)` dereferenced
 * `.role` on whatever `m` was -- a `null` entry (`{messages:[null]}`) threw a
 * raw `TypeError` reading `role` instead of a normalized `BAD_REQUEST`.
 */
function isValidWireMessage(v: unknown): v is WireMessage {
  if (!isPlainRecord(v)) return false;
  return (
    (v.role === "user" || v.role === "assistant") &&
    typeof v.content === "string" &&
    v.content.trim().length > 0 &&
    v.content.length <= MAX_CHARS &&
    // Interaction refinement: count/size/mime/magic-byte validation against
    // the DECODED bytes this process actually received -- never the
    // client's own claimed size or type. See validateWireAttachments's own
    // comment; `undefined` (no attachments, the common case) is valid.
    validateWireAttachments(v.attachments) &&
    // Attachments only ever originate from the user's own turn.
    (v.role === "user" || v.attachments === undefined)
  );
}

/**
 * Project 4: the ids of the conversation's uploaded documents.
 *
 * Both fields are optional — a request from before documents existed, or from
 * a conversation with no files, carries neither and behaves exactly as it
 * always did. When they ARE present they are validated strictly, because
 * `documentIds` is a list of capabilities: a malformed one is a bug or a
 * probe, never something to tolerate quietly.
 *
 * Note what this does NOT do: it does not treat `conversationId` as proof of
 * anything. It is the binding a document was stored with, and `loadDocument`
 * checks it in constant time against the stored value; the unguessable
 * document id is the actual access control. See `store.ts`.
 */
function validateDocumentIds(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_DOCUMENTS_PER_CONVERSATION) return null;
  if (!value.every((id) => isValidDocumentId(id))) return null;
  // De-duplicated: the same document twice would double its passages' share
  // of the context budget and crowd out the other files.
  return [...new Set(value as string[])];
}

function isValidConversationId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && /^[\w.:-]+$/.test(value);
}

/** Server-side diagnostics. Never logs credentials. */
function logUpstream(where: string, error: unknown) {
  const code = error instanceof ProviderError ? error.code : undefined;
  const status = (error as { status?: number })?.status;
  const message = (error as { message?: string })?.message ?? String(error);
  console.error("[chat] upstream failure", { where, code, status, message });
}

/**
 * Reports which providers are configured, so the UI can enable only the ones
 * that can actually answer. Returns booleans and model names — never a key.
 */
export async function GET() {
  const availability = providerAvailability();
  return Response.json(
    {
      providers: availability,
      // Retained for the existing setup state.
      configured: Boolean(availability.gemini?.configured),
      model: availability.gemini?.model ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  /**
   * Set far above interactive use -- a person sends a handful of messages a
   * minute -- so this never interferes with a real conversation and only
   * catches a client in a retry loop. See `rate-limit.ts` for what this
   * does and does not protect against.
   */
  const limit = checkRateLimit("chat", request);
  if (!limit.ok) {
    return rateLimitResponse(
      limit.retryAfterSeconds,
      `Too many requests. Try again in ${limit.retryAfterSeconds} seconds.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return errorResponse("BAD_REQUEST", 400, "Body was not valid JSON.");
  }
  // F4: a body of `null`, an array, or a primitive (string/number/boolean) is
  // valid JSON but not a request this endpoint can read. Rejected here, once,
  // before any field is dereferenced -- rather than letting each field access
  // below throw its own uncaught TypeError.
  if (!isPlainRecord(parsed)) {
    return errorResponse("BAD_REQUEST", 400, "Request body must be a JSON object.");
  }
  const body = parsed as {
    provider?: unknown;
    messages?: unknown;
    preferences?: unknown;
    conversationId?: unknown;
    documentIds?: unknown;
  };

  // Unknown or unregistered provider. Checked before configuration so a
  // disabled provider is refused as disabled, never mislabelled as a setup
  // problem, and never dependent on configuration to be safe. F4: a
  // non-string `provider` (an object, a number) is simply treated as
  // unregistered rather than coerced -- the registry lookup itself is also
  // immune to inherited-property ids like "constructor"/"__proto__" (see
  // `registry.ts`).
  const provider = getProvider(typeof body.provider === "string" ? body.provider : "");
  if (!provider) return errorResponse("PROVIDER_DISABLED", 403);

  const availability = provider.availability();
  if (!availability.configured) return errorResponse("MISSING_KEY", 503);

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return errorResponse("BAD_REQUEST", 400, "No messages supplied.");
  }
  if (messages.length > MAX_MESSAGES) {
    return errorResponse("BAD_REQUEST", 400, "Conversation is too long.");
  }
  // F4: every entry is validated as a non-null object with an allowed role
  // and non-blank string content before anything downstream reads it -- a
  // `null`/primitive/wrong-shaped entry anywhere in the array is rejected as
  // one normalized error, not an uncaught exception on whichever field was
  // dereferenced first.
  if (!messages.every(isValidWireMessage)) {
    return errorResponse("BAD_REQUEST", 400, "A message was malformed.");
  }
  const validMessages = messages as WireMessage[];
  if (validMessages.at(-1)?.role !== "user") {
    return errorResponse("BAD_REQUEST", 400, "Last message must be the user's.");
  }

  // Personalizations: optional and additive -- absent entirely on every
  // request from before this existed, and on any request with nothing
  // saved. Re-validated here independently of the client's own check
  // (`validatePreferences()` is the exact same function, shared, never
  // duplicated) against what actually arrived on the wire; a malformed or
  // oversized `preferences` fails the whole request rather than being
  // silently dropped or truncated.
  let preferences: Preferences | undefined;
  if (body.preferences !== undefined) {
    const validation = validatePreferences(body.preferences);
    if (!validation.ok) {
      return errorResponse("BAD_REQUEST", 400, "Preferences were malformed or too long.");
    }
    const p = body.preferences as Preferences;
    if (hasPreferences(p)) preferences = p;
  }

  /**
   * Project 4: ground this turn in the conversation's uploaded files.
   *
   * Retrieval runs on EVERY turn that has documents attached, against that
   * turn's own question -- not once at upload time. That is what makes a
   * follow-up ("and what about clause 9?") search the file again instead of
   * reusing whatever was relevant to the first question, and it is why a
   * model switch mid-conversation keeps the grounding: the passages are
   * fetched here, provider-neutrally, and handed to whichever adapter is
   * answering.
   */
  const documentIds = validateDocumentIds(body.documentIds);
  if (documentIds === null) {
    return errorResponse("BAD_REQUEST", 400, "Document references were malformed.");
  }
  if (documentIds.length > 0 && !isValidConversationId(body.conversationId)) {
    return errorResponse("BAD_REQUEST", 400, "A conversation id is required to search uploaded files.");
  }

  let documentContext: string | undefined;
  if (documentIds.length > 0) {
    const question = validMessages.at(-1)?.content ?? "";
    try {
      const retrieved = await buildDocumentContext(
        question,
        documentIds,
        body.conversationId as string,
      );
      // Ids were supplied but none resolved: the documents are gone, or
      // belong to another conversation. Answering anyway would produce a
      // reply that looks file-based and is not, so the turn fails instead.
      if (retrieved.searched.length === 0) {
        return errorResponse(
          "DOCUMENT_SEARCH_FAILED",
          502,
          "The uploaded files for this conversation could not be read back. Remove them and upload again.",
        );
      }
      documentContext = retrieved.context;
      // Counts and filenames only -- never passage text, never a blob URL.
      console.log("[chat] document retrieval", {
        mode: retrieved.mode,
        documents: retrieved.searched.length,
        grounded: Boolean(retrieved.context),
      });
    } catch (error) {
      logUpstream("document retrieval", error);
      return errorResponse(
        "DOCUMENT_SEARCH_FAILED",
        502,
        "The uploaded files could not be searched for this question.",
      );
    }
  }

  // Transient failures are common: capacity rejections and dropped transports.
  // Both are worth a couple of quick retries. Auth, quota and malformed-request
  // failures are never retried -- repeating them only burns quota and delays
  // the real error. Retryability is decided by the adapter, not here.
  let stream: AsyncIterable<ProviderChunk> | undefined;
  let lastError: ProviderError = new ProviderError("UPSTREAM");

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      stream = await provider.stream(validMessages, request.signal, preferences, documentContext);
      break;
    } catch (error) {
      if (request.signal.aborted) return new Response(null, { status: 499 });
      lastError =
        error instanceof ProviderError
          ? error
          : new ProviderError("UPSTREAM", { cause: error });
      logUpstream(`${provider.id} stream attempt ${attempt + 1}`, error);
      if (!lastError.retryable || attempt === MAX_ATTEMPTS - 1) {
        return errorResponse(lastError.code, 502, undefined, lastError.info);
      }
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    }
  }
  if (!stream) return errorResponse(lastError.code, 502, undefined, lastError.info);

  const encoder = new TextEncoder();
  const send = (event: StreamEvent) =>
    encoder.encode(`${JSON.stringify(event)}\n`);

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      // F2: every adapter yields exactly one "outcome" chunk as the last
      // thing it produces on any non-throwing end (see ProviderChunk's own
      // contract). Captured here rather than forwarded chunk-by-chunk,
      // because it carries no text of its own -- only once the loop below
      // actually ends do we know the adapter is done producing chunks, at
      // which point this is the single `done` event's payload. "unknown" is
      // the defensive default if an adapter somehow violates that contract
      // (the loop ends with no outcome ever captured) -- never "complete".
      let outcome: StreamOutcome = "unknown";
      let reason: string | undefined;
      try {
        for await (const chunk of stream) {
          if (request.signal.aborted) break;
          if (chunk.type === "delta") {
            if (chunk.text) controller.enqueue(send({ type: "delta", text: chunk.text }));
          } else if (chunk.type === "image") {
            // Project 3: forwarded verbatim. The route stays vendor-neutral --
            // it does not know what produced the image, only that the adapter
            // reported one for this turn.
            controller.enqueue(send({ type: "image", image: chunk.image }));
          } else {
            outcome = chunk.outcome;
            reason = chunk.reason;
          }
        }
        if (!request.signal.aborted) {
          controller.enqueue(send({ type: "done", outcome, reason }));
        }
      } catch (error) {
        if (!request.signal.aborted) {
          logUpstream(`${provider.id} mid-stream`, error);
          const pe =
            error instanceof ProviderError
              ? error
              : new ProviderError("UPSTREAM", { cause: error });
          controller.enqueue(
            send({
              type: "error",
              code: pe.code,
              message: pe.code,
              info: pe.info,
            }),
          );
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
