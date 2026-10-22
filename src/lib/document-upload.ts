"use client";

import {
  documentRejectionMessage,
  validateDocumentFile,
  type DocumentKind,
  type DocumentRef,
} from "@/lib/documents";

/**
 * Project 4: the browser half of document upload.
 *
 * Deliberately thin. The file is sent to `/api/documents` as multipart and
 * everything that matters -- sniffing the real type, parsing, chunking,
 * embedding, storing -- happens on the server, where the keys are. The
 * browser never sees a blob URL, an embedding, or an API key; it holds only
 * the `DocumentRef` metadata the route hands back.
 *
 * The one check that IS done here is the cheap one: a file that is obviously
 * the wrong type or over the size cap is refused locally so the user is told
 * instantly instead of after uploading 4 MB. The server re-checks everything
 * anyway and never trusts this (see `parseDocument`'s own sniffing).
 */

/** A chip in the composer's document tray while its upload is in flight. */
export type DraftDocument = {
  /** Client-side only, for React keys and removal before the upload lands. */
  key: string;
  name: string;
  size: number;
  kind: DocumentKind | null;
  status: "uploading" | "error";
  error?: string;
};

export type DocumentCapability = {
  configured: boolean;
  storage: boolean;
  embeddings: boolean;
  maxBytes: number;
  maxDocuments: number;
};

/**
 * Asks the server whether documents can be indexed at all.
 *
 * Used to decide where a picked file goes: a configured server indexes it as
 * a searchable document, an unconfigured one falls back to the existing
 * inline chat attachment path. Returns null if the probe itself fails, which
 * callers treat as "not configured" -- the fallback path, never an error
 * message about a feature the user did not ask for.
 */
export async function probeDocumentSupport(signal?: AbortSignal): Promise<DocumentCapability | null> {
  try {
    const response = await fetch("/api/documents", { signal, cache: "no-store" });
    if (!response.ok) return null;
    const payload = (await response.json()) as Partial<DocumentCapability>;
    if (typeof payload.configured !== "boolean") return null;
    return {
      configured: payload.configured,
      storage: Boolean(payload.storage),
      embeddings: Boolean(payload.embeddings),
      maxBytes: typeof payload.maxBytes === "number" ? payload.maxBytes : 0,
      maxDocuments: typeof payload.maxDocuments === "number" ? payload.maxDocuments : 0,
    };
  } catch {
    return null;
  }
}

export type UploadOutcome =
  | { ok: true; document: DocumentRef; warnings: string[] }
  | { ok: false; message: string };

/**
 * Uploads and indexes one file.
 *
 * Every failure path returns a sentence a user can act on, not a status code:
 * the route's own `detail` is preferred when it has one (it names the file,
 * the limit, or what was unreadable), with a fallback for the cases where
 * there is no response body to read at all.
 */
export async function uploadDocument(
  file: File,
  conversationId: string,
  options: { existingCount?: number; signal?: AbortSignal } = {},
): Promise<UploadOutcome> {
  const { existingCount = 0, signal } = options;
  const validation = validateDocumentFile(file, existingCount);
  if (!validation.ok) return { ok: false, message: documentRejectionMessage(validation) };

  const form = new FormData();
  form.append("conversationId", conversationId);
  form.append("file", file);

  let response: Response;
  try {
    response = await fetch("/api/documents", { method: "POST", body: form, signal });
  } catch (error) {
    if (signal?.aborted) return { ok: false, message: "Upload cancelled." };
    void error;
    return { ok: false, message: `Could not reach the server to upload ${file.name}.` };
  }

  const payload = (await response.json().catch(() => null)) as
    | { document?: DocumentRef | null; warnings?: string[]; detail?: string }
    | null;

  if (!response.ok) {
    return {
      ok: false,
      message: payload?.detail ?? `${file.name} could not be uploaded.`,
    };
  }
  // 422: parsed successfully, but there was no text in it. The warnings say
  // why (a scanned PDF, an image-only DOCX) and are shown as the reason --
  // this is the one failure the server knows more about than the client.
  if (!payload?.document) {
    return {
      ok: false,
      message: payload?.warnings?.[0] ?? `No readable text was found in ${file.name}.`,
    };
  }

  return { ok: true, document: payload.document, warnings: payload.warnings ?? [] };
}

/**
 * Removes a document from the server.
 *
 * Both ids are required: the capability AND the conversation it was bound to,
 * exactly as a read requires them -- a caller who could not read a document
 * cannot delete it either.
 */
export async function deleteStoredDocument(id: string, conversationId: string): Promise<boolean> {
  try {
    const query = `id=${encodeURIComponent(id)}&conversationId=${encodeURIComponent(conversationId)}`;
    const response = await fetch(`/api/documents?${query}`, { method: "DELETE" });
    return response.ok;
  } catch {
    return false;
  }
}
