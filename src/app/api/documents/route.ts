import {
  MAX_DOCUMENTS_PER_CONVERSATION,
  MAX_DOCUMENT_BYTES,
  type DocumentRef,
} from "@/lib/documents";
import {
  chunkSections,
  embedTexts,
  embeddingModelId,
  embeddingsConfigured,
  EmbeddingError,
} from "@/server/documents/embed";
import { DocumentParseError, parseDocument } from "@/server/documents/parse";
import { checkRateLimit, rateLimitResponse } from "@/server/rate-limit";
import {
  deleteDocument,
  documentStorageConfigured,
  DocumentStorageError,
  isValidDocumentId,
  newDocumentId,
  saveDocument,
  type StoredChunk,
} from "@/server/documents/store";

/**
 * Project 4: the document endpoint. Upload + index on POST, remove on DELETE,
 * capability probe on GET.
 *
 * Follows `/api/chat` and `/api/images` conventions exactly: `nodejs`
 * runtime, forced dynamic, a 300 s ceiling, and a `{ code, detail }` error
 * envelope. Parsing, embedding and storage all happen here on the server —
 * the browser never sees a blob URL, an API key, or the document text of a
 * conversation it does not own.
 *
 * `multipart/form-data`, not base64 JSON: base64 inflates a payload by 4/3,
 * which would waste a third of the ~4.5 MB a Vercel function can receive.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type ErrorCode =
  | "BAD_REQUEST"
  | "UNSUPPORTED_TYPE"
  | "TOO_LARGE"
  | "PARSE_FAILED"
  | "NOT_CONFIGURED"
  | "INDEX_FAILED"
  | "STORAGE_FAILED"
  | "NOT_FOUND";

function errorResponse(code: ErrorCode, status: number, detail: string) {
  return Response.json({ code, detail }, { status });
}

/**
 * A conversation id is only an association key here, never a security
 * boundary — `newId()` is guessable by design, so the real access control is
 * the 256-bit document id (see `store.ts`). This check is purely structural.
 */
function isValidConversationId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && /^[\w.:-]+$/.test(value);
}

export async function GET() {
  return Response.json(
    {
      configured: documentStorageConfigured() && embeddingsConfigured(),
      storage: documentStorageConfigured(),
      embeddings: embeddingsConfigured(),
      maxBytes: MAX_DOCUMENT_BYTES,
      maxDocuments: MAX_DOCUMENTS_PER_CONVERSATION,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  // Checked before anything is read: an upload parses the file and then
  // embeds every chunk of it, so a refused request must cost nothing.
  const limit = checkRateLimit("documents", request);
  if (!limit.ok) {
    return rateLimitResponse(
      limit.retryAfterSeconds,
      `Too many uploads. Try again in ${limit.retryAfterSeconds} seconds.`,
    );
  }

  if (!documentStorageConfigured()) {
    return errorResponse(
      "NOT_CONFIGURED",
      503,
      "Document storage is not configured on this server (BLOB_READ_WRITE_TOKEN).",
    );
  }
  if (!embeddingsConfigured()) {
    return errorResponse(
      "NOT_CONFIGURED",
      503,
      "Document search is not configured on this server (GEMINI_API_KEY is required for embeddings).",
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse("BAD_REQUEST", 400, "Expected a multipart/form-data upload.");
  }

  const conversationId = form.get("conversationId");
  if (!isValidConversationId(conversationId)) {
    return errorResponse("BAD_REQUEST", 400, "A conversation id is required.");
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return errorResponse("BAD_REQUEST", 400, "No file was uploaded.");
  }
  if (file.size === 0) {
    return errorResponse("BAD_REQUEST", 400, `${file.name} is empty.`);
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return errorResponse(
      "TOO_LARGE",
      413,
      `${file.name} is ${(file.size / 1_000_000).toFixed(1)} MB; the limit is ${MAX_DOCUMENT_BYTES / 1_000_000} MB.`,
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  // 1. Parse. The kind is re-derived from the bytes inside parseDocument, so
  //    a mislabelled file is refused here rather than deeper in a library.
  let parsed;
  try {
    parsed = await parseDocument(bytes, file.name);
  } catch (error) {
    if (error instanceof DocumentParseError) {
      const unsupported = /not a supported document|do not match its file extension/.test(error.message);
      return errorResponse(unsupported ? "UNSUPPORTED_TYPE" : "PARSE_FAILED", 415, error.message);
    }
    return errorResponse("PARSE_FAILED", 500, `${file.name} could not be read.`);
  }

  // A document with no extractable text is still stored-worthy information:
  // the warnings explain WHY (scanned PDF, image-only DOCX), and returning
  // them is more useful than a bare failure.
  if (parsed.sections.length === 0) {
    return Response.json(
      {
        document: null,
        warnings: parsed.warnings.length > 0 ? parsed.warnings : ["No readable text was found in this file."],
      },
      { status: 422 },
    );
  }

  // 2. Chunk, 3. Embed.
  const chunks = chunkSections(parsed.sections);
  let vectors: number[][];
  try {
    vectors = await embedTexts(chunks.map((chunk) => chunk.text), "RETRIEVAL_DOCUMENT");
  } catch (error) {
    const detail = error instanceof EmbeddingError ? error.message : "The document could not be indexed.";
    return errorResponse("INDEX_FAILED", 502, detail);
  }

  const stored: StoredChunk[] = chunks.map((chunk, i) => ({
    i,
    ref: chunk.ref,
    text: chunk.text,
    embedding: vectors[i],
  }));

  // 4. Store, keyed by an unguessable server-generated id.
  const id = newDocumentId();
  try {
    await saveDocument({
      id,
      conversationId,
      filename: parsed.filename,
      kind: parsed.kind,
      bytes: parsed.bytes,
      meta: parsed.meta,
      warnings: parsed.warnings,
      uploadedAt: Date.now(),
      // The model actually used, read from the one place that decides it --
      // a hardcoded copy here went stale the moment the default changed.
      embeddingModel: embeddingModelId(),
      chunks: stored,
    });
  } catch (error) {
    const detail =
      error instanceof DocumentStorageError ? error.message : "The document could not be stored.";
    return errorResponse("STORAGE_FAILED", 502, detail);
  }

  const ref: DocumentRef = {
    id,
    filename: parsed.filename,
    kind: parsed.kind,
    bytes: parsed.bytes,
    sections: stored.length,
    meta: parsed.meta,
    warnings: parsed.warnings,
    uploadedAt: Date.now(),
  };

  return Response.json({ document: ref, warnings: parsed.warnings });
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const conversationId = url.searchParams.get("conversationId");

  if (!isValidDocumentId(id) || !isValidConversationId(conversationId)) {
    return errorResponse("BAD_REQUEST", 400, "A document id and conversation id are required.");
  }
  const removed = await deleteDocument(id, conversationId);
  // The same answer whether it never existed or belongs to someone else, so
  // this endpoint cannot be used to discover which document ids are real.
  if (!removed) return errorResponse("NOT_FOUND", 404, "No such document in this conversation.");
  return Response.json({ deleted: true });
}
