/**
 * Project 4: the document model, shared by client and server.
 *
 * Documents are deliberately NOT the same thing as the existing attachments
 * (`@/lib/attachments.ts`). An attachment is small, is held in the browser,
 * and is sent inline to the model on every turn. That is exactly the wrong
 * shape for a 200-page PDF: it would blow the context window, re-send
 * megabytes per message, and still give the model no way to cite a page.
 *
 * A document instead goes: upload -> parse on the server -> split into
 * sections with stable references -> embed -> store. A turn then retrieves
 * only the passages it needs. The two systems coexist; neither replaces the
 * other.
 *
 * Nothing here imports a parser, so this module is safe on the client.
 */

export type DocumentKind = "pdf" | "docx" | "xlsx" | "csv" | "code" | "text" | "markdown";

/**
 * One addressable piece of a parsed document.
 *
 * `ref` is the human-readable citation the model is asked to quote back
 * ("invoice.pdf p. 4", "books.xlsx Sheet1!A12:F31"). It is built at parse
 * time, from the real structure, so a citation can never be invented later:
 * if the parser could not determine a page or row, there is no ref to cite.
 */
export type DocumentSection = {
  /** Stable, human-readable location, e.g. "p. 4" or "Sheet1!A12:F31". */
  ref: string;
  text: string;
  /** 1-based page, for PDFs. */
  page?: number;
  /** Sheet name, for spreadsheets. */
  sheet?: string;
  /** 1-based inclusive row range, for spreadsheets. */
  rowStart?: number;
  rowEnd?: number;
  /** 1-based inclusive line range, for text and code. */
  lineStart?: number;
  lineEnd?: number;
  /** Nearest preceding heading, for DOCX/Markdown. */
  heading?: string;
};

export type DocumentMeta = {
  pages?: number;
  sheets?: string[];
  rows?: number;
  /** Characters of text actually extracted. */
  chars: number;
  /** True when the parser stopped early at a limit -- never silent. */
  truncated: boolean;
};

export type ParsedDocument = {
  kind: DocumentKind;
  filename: string;
  mimeType: string;
  bytes: number;
  sections: DocumentSection[];
  meta: DocumentMeta;
  /**
   * Extraction problems worth telling the user about: a scanned PDF with no
   * selectable text, a sheet that was too large, a table that could not be
   * reconstructed. Reported rather than papered over -- the brief is
   * explicit that a limitation must be surfaced, not fabricated around.
   */
  warnings: string[];
};

/* --------------------------------------------------------------- limits -- */

/**
 * Per-file ceiling for a document upload.
 *
 * 4 MB, not an arbitrary round number: a Vercel serverless function receives
 * at most ~4.5 MB of request body, and the upload is `multipart/form-data`
 * (so the file is sent as raw bytes, not base64-inflated by 4/3). 4 MB leaves
 * room for the form envelope and the other fields. A larger file is refused
 * with that reason stated, never silently truncated.
 */
export const MAX_DOCUMENT_BYTES = 4_000_000;

/** Documents retained per conversation. */
export const MAX_DOCUMENTS_PER_CONVERSATION = 10;

/**
 * Hard ceiling on extracted text per document (~1.5 M characters, roughly a
 * 400-page book). Beyond this the parser stops and sets `truncated`, which
 * the UI shows: a partial analysis is only honest if it says it is partial.
 */
export const MAX_DOCUMENT_CHARS = 1_500_000;

/** Spreadsheet rows read per sheet before truncating. */
export const MAX_SHEET_ROWS = 5_000;

/* ----------------------------------------------------- type classification */

/**
 * Extensions accepted as documents, by kind.
 *
 * The code list is the brief's own list plus the ones the app already
 * accepted as chat attachments, so nothing that used to upload stops
 * uploading.
 */
export const DOCUMENT_EXTENSIONS: Record<DocumentKind, readonly string[]> = {
  pdf: [".pdf"],
  docx: [".docx"],
  xlsx: [".xlsx", ".xlsm"],
  csv: [".csv", ".tsv"],
  markdown: [".md", ".markdown"],
  text: [".txt", ".log"],
  code: [
    ".js", ".jsx", ".ts", ".tsx", ".py", ".java", ".c", ".cpp", ".h", ".hpp",
    ".cs", ".go", ".rs", ".php", ".rb", ".swift", ".kt", ".scala",
    ".html", ".css", ".scss", ".sql", ".json", ".yaml", ".yml", ".xml",
    ".sh", ".bash", ".toml", ".ini", ".env.example",
  ],
};

export const ALL_DOCUMENT_EXTENSIONS: readonly string[] = Object.values(DOCUMENT_EXTENSIONS).flat();

/** The `accept` attribute for the file picker. */
export const DOCUMENT_ACCEPT_ATTRIBUTE = ALL_DOCUMENT_EXTENSIONS.join(",");

/**
 * Kind from a filename. Extension only -- this is a HINT, never trusted on
 * its own: the server re-checks the real bytes (`sniffDocumentKind`) before
 * handing anything to a parser, because a `.pdf` extension on a ZIP is the
 * oldest trick there is.
 */
export function documentKindFromName(filename: string): DocumentKind | null {
  const lower = filename.toLowerCase();
  // Longest extension first, so ".env.example" beats ".example" style overlaps.
  const entries = Object.entries(DOCUMENT_EXTENSIONS) as [DocumentKind, readonly string[]][];
  let best: { kind: DocumentKind; length: number } | null = null;
  for (const [kind, extensions] of entries) {
    for (const extension of extensions) {
      if (lower.endsWith(extension) && (!best || extension.length > best.length)) {
        best = { kind, length: extension.length };
      }
    }
  }
  return best?.kind ?? null;
}

export type DocumentRejection =
  | { ok: false; reason: "unsupportedType"; name: string }
  | { ok: false; reason: "tooLarge"; name: string; limit: number }
  | { ok: false; reason: "empty"; name: string }
  | { ok: false; reason: "tooMany"; limit: number };

export type DocumentValidation = { ok: true; kind: DocumentKind } | DocumentRejection;

/** Client-side pre-check. The server repeats all of it independently. */
export function validateDocumentFile(
  file: { name: string; size: number },
  existingCount = 0,
): DocumentValidation {
  if (existingCount >= MAX_DOCUMENTS_PER_CONVERSATION) {
    return { ok: false, reason: "tooMany", limit: MAX_DOCUMENTS_PER_CONVERSATION };
  }
  const kind = documentKindFromName(file.name);
  if (!kind) return { ok: false, reason: "unsupportedType", name: file.name };
  if (file.size === 0) return { ok: false, reason: "empty", name: file.name };
  if (file.size > MAX_DOCUMENT_BYTES) {
    return { ok: false, reason: "tooLarge", name: file.name, limit: MAX_DOCUMENT_BYTES };
  }
  return { ok: true, kind };
}

export function documentRejectionMessage(rejection: DocumentRejection): string {
  switch (rejection.reason) {
    case "unsupportedType":
      return `${rejection.name} is not a supported document type.`;
    case "tooLarge":
      return `${rejection.name} is over the ${Math.round(rejection.limit / 1_000_000)} MB limit for documents.`;
    case "empty":
      return `${rejection.name} is empty.`;
    case "tooMany":
      return `At most ${rejection.limit} documents per conversation.`;
  }
}

/* ------------------------------------------------- the stored document ref */

/**
 * What a conversation persists about a document. Deliberately small: the
 * text, the sections and the embeddings all live server-side, keyed by `id`,
 * so switching models or reloading the page costs nothing and the browser
 * never holds a 200-page PDF.
 */
export type DocumentRef = {
  id: string;
  filename: string;
  kind: DocumentKind;
  bytes: number;
  /** Section count after parsing -- what retrieval searches over. */
  sections: number;
  meta: DocumentMeta;
  warnings: string[];
  uploadedAt: number;
};

export function describeDocument(ref: DocumentRef): string {
  const parts: string[] = [];
  if (ref.meta.pages) parts.push(`${ref.meta.pages} page${ref.meta.pages === 1 ? "" : "s"}`);
  if (ref.meta.sheets?.length) parts.push(`${ref.meta.sheets.length} sheet${ref.meta.sheets.length === 1 ? "" : "s"}`);
  if (ref.meta.rows) parts.push(`${ref.meta.rows.toLocaleString()} rows`);
  parts.push(`${ref.sections} section${ref.sections === 1 ? "" : "s"}`);
  return parts.join(" · ");
}
