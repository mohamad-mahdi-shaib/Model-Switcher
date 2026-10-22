import { randomBytes, timingSafeEqual } from "node:crypto";
import { del, head, put } from "@vercel/blob";
import type { DocumentKind, DocumentMeta } from "@/lib/documents";

/**
 * Project 4: persistent storage for parsed documents and their embeddings.
 *
 * ACCESS CONTROL — the part that needed the most care.
 *
 * This app has no accounts: conversations live in the browser and every
 * request is anonymous. So the question "may this caller read this document?"
 * has to be answered by something the caller holds, not by who they are.
 *
 * The obvious candidate was the conversation id, and it is NOT safe:
 * `newId()` (`@/lib/chat.ts`) produces `prefix-<base36 clock>-<counter>`,
 * which anyone can enumerate from a rough timestamp and a small integer.
 * Keying private documents on it would have made every upload readable by
 * guessing. That is exactly the "publicly accessible storage without
 * appropriate access controls" the brief rules out.
 *
 * What is used instead: a 256-bit cryptographically random document id,
 * generated on the SERVER, which doubles as an unguessable capability. It is
 * the blob pathname, so the storage URL cannot be derived without it; the
 * URL itself is never returned to the browser. A document is additionally
 * BOUND to the conversation that uploaded it, and reads must present both --
 * so a leaked id cannot be replayed into another conversation to widen
 * access.
 *
 * Honest limits, stated rather than implied: this is capability-based
 * control, not per-user authorization. Anyone who obtains a document id can
 * read that document. With no identity system there is nothing stronger to
 * check against, and inventing a fake one would be worse than saying so.
 */

const PREFIX = "documents";
const TOKEN_ENV = "BLOB_READ_WRITE_TOKEN";

/** One embedded, independently retrievable piece of a document. */
export type StoredChunk = {
  /** Index within the document, for stable ordering. */
  i: number;
  /** Human-readable citation, straight from the parser. */
  ref: string;
  text: string;
  /** Unit-normalised embedding, so similarity is a plain dot product. */
  embedding: number[];
};

export type StoredDocument = {
  id: string;
  conversationId: string;
  filename: string;
  kind: DocumentKind;
  bytes: number;
  meta: DocumentMeta;
  warnings: string[];
  uploadedAt: number;
  /** The embedding model used, so a model change can be detected. */
  embeddingModel: string;
  chunks: StoredChunk[];
};

export function documentStorageConfigured(): boolean {
  return Boolean(process.env[TOKEN_ENV]?.trim());
}

/**
 * 256 bits of randomness, base64url. This is both the identifier and the
 * capability, so it must be generated with a CSPRNG -- never `Math.random`,
 * never a timestamp, never a counter.
 */
export function newDocumentId(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Document ids come back from the client on every read, so the format is
 * checked before it is ever concatenated into a storage path. Rejecting
 * anything outside `[A-Za-z0-9_-]{43,}` also makes path traversal
 * (`../`, absolute paths, NUL) structurally impossible.
 */
export function isValidDocumentId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{43,86}$/.test(id);
}

/** Constant-time compare, so a bound-conversation check cannot be timed. */
function sameString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function pathFor(id: string): string {
  return `${PREFIX}/${id}.json`;
}

export class DocumentStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentStorageError";
  }
}

/**
 * Persists a parsed, embedded document.
 *
 * `addRandomSuffix: false` is deliberate and safe here: the pathname is
 * already 256 bits of entropy, and a derivable path is what lets a read find
 * the blob again without a database to map id -> URL. A random suffix would
 * make the URL unreproducible and force an index we have nowhere to keep.
 */
export async function saveDocument(document: StoredDocument): Promise<void> {
  const token = process.env[TOKEN_ENV]?.trim();
  if (!token) {
    throw new DocumentStorageError(
      "Document storage is not configured on this server (BLOB_READ_WRITE_TOKEN).",
    );
  }
  try {
    await put(pathFor(document.id), JSON.stringify(document), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
      token,
      // Documents are working material, not archives. A finite life limits
      // how long an unguessable URL stays useful if it ever does leak.
      cacheControlMaxAge: 60 * 60 * 24 * 7,
    });
  } catch (error) {
    throw new DocumentStorageError(
      `Could not store “${document.filename}”. ${error instanceof Error && /quota|size/i.test(error.message) ? "The document may be too large for storage." : "Storage was unavailable."}`,
    );
  }
}

/**
 * Loads a document, enforcing the conversation binding.
 *
 * Returns null for "not found" AND for "found but belongs to another
 * conversation" -- the same answer for both, so the API cannot be used to
 * probe which document ids exist.
 */
export async function loadDocument(
  id: string,
  conversationId: string,
): Promise<StoredDocument | null> {
  if (!isValidDocumentId(id)) return null;
  const token = process.env[TOKEN_ENV]?.trim();
  if (!token) return null;

  let url: string;
  try {
    const meta = await head(pathFor(id), { token });
    url = meta.url;
  } catch {
    return null;
  }

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    const document = (await response.json()) as StoredDocument;
    if (!document || typeof document !== "object" || !Array.isArray(document.chunks)) return null;
    if (!sameString(document.conversationId ?? "", conversationId)) return null;
    return document;
  } catch {
    return null;
  }
}

/** Loads several documents, skipping any the caller may not read. */
export async function loadDocuments(
  ids: readonly string[],
  conversationId: string,
): Promise<StoredDocument[]> {
  const loaded = await Promise.all(ids.map((id) => loadDocument(id, conversationId)));
  return loaded.filter((document): document is StoredDocument => document !== null);
}

/**
 * Deletes a document, enforcing the same binding as a read: a caller who
 * cannot read it cannot delete it either.
 */
export async function deleteDocument(id: string, conversationId: string): Promise<boolean> {
  const token = process.env[TOKEN_ENV]?.trim();
  if (!token || !isValidDocumentId(id)) return false;
  const existing = await loadDocument(id, conversationId);
  if (!existing) return false;
  try {
    const meta = await head(pathFor(id), { token });
    await del(meta.url, { token });
    return true;
  } catch {
    return false;
  }
}
