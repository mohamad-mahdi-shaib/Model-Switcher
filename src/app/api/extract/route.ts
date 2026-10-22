import { isExtractionSchemaId } from "@/lib/extraction";
import { loadDocument, isValidDocumentId, documentStorageConfigured } from "@/server/documents/store";
import { ExtractionError, extractionConfigured, runExtraction } from "@/server/extract/run";
import { checkRateLimit, rateLimitResponse } from "@/server/rate-limit";

/**
 * Project 4: structured extraction.
 *
 * Same envelope and conventions as `/api/chat`, `/api/images` and
 * `/api/documents`: nodejs runtime, forced dynamic, a 300 s ceiling, and a
 * `{ code, detail }` error body.
 *
 * Access control is the document's own, unchanged and not re-invented here:
 * `loadDocument` requires the 256-bit capability id AND the conversation it
 * was bound to, and answers null for "no such document" and "not yours"
 * alike. So this endpoint cannot be used to extract from, or probe for, a
 * document the caller could not already read.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type ErrorCode =
  | "BAD_REQUEST"
  | "NOT_CONFIGURED"
  | "NOT_FOUND"
  | "EMPTY_DOCUMENT"
  | "INVALID_OUTPUT"
  | "UPSTREAM";

function errorResponse(code: ErrorCode, status: number, detail: string) {
  return Response.json({ code, detail }, { status });
}

function isValidConversationId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && /^[\w.:-]+$/.test(value);
}

export async function GET() {
  return Response.json(
    { configured: extractionConfigured() && documentStorageConfigured() },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  // An extraction reads a whole document through a model; refuse early.
  const limit = checkRateLimit("extract", request);
  if (!limit.ok) {
    return rateLimitResponse(
      limit.retryAfterSeconds,
      `Too many extractions. Try again in ${limit.retryAfterSeconds} seconds.`,
    );
  }

  if (!extractionConfigured()) {
    return errorResponse(
      "NOT_CONFIGURED",
      503,
      "Structured extraction is not configured on this server (GEMINI_API_KEY).",
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("BAD_REQUEST", 400, "Body was not valid JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return errorResponse("BAD_REQUEST", 400, "Request body must be a JSON object.");
  }

  const { documentId, conversationId, schema } = body as Record<string, unknown>;
  if (!isValidDocumentId(documentId) || !isValidConversationId(conversationId)) {
    return errorResponse("BAD_REQUEST", 400, "A document id and conversation id are required.");
  }
  if (!isExtractionSchemaId(schema)) {
    return errorResponse("BAD_REQUEST", 400, "Unknown extraction schema.");
  }

  const document = await loadDocument(documentId, conversationId);
  // The same answer for "never existed" and "belongs to another
  // conversation", so this cannot be used to discover real document ids.
  if (!document) {
    return errorResponse("NOT_FOUND", 404, "No such document in this conversation.");
  }

  try {
    const { result } = await runExtraction(document, schema, request.signal);
    return Response.json({ result });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    if (error instanceof ExtractionError) {
      const status =
        error.code === "NOT_CONFIGURED" ? 503 : error.code === "EMPTY_DOCUMENT" ? 422 : 502;
      return errorResponse(error.code, status, error.message);
    }
    // Never echo a raw provider error: those can carry request metadata.
    console.error("[extract] failure", {
      schema,
      message: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("UPSTREAM", 502, "The extraction could not be completed.");
  }
}
