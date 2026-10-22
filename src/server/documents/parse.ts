import mammoth from "mammoth";
import * as XLSX from "xlsx";
import {
  MAX_DOCUMENT_CHARS,
  MAX_SHEET_ROWS,
  documentKindFromName,
  type DocumentKind,
  type DocumentSection,
  type ParsedDocument,
} from "@/lib/documents";

/**
 * Project 4: real document parsing. Server-only -- every library here needs
 * Node APIs, and the uploaded bytes must never be handed to the browser's
 * parser or to the model raw.
 *
 * Two rules this file holds to throughout:
 *
 * 1. **Never fabricate structure.** A section's `ref` ("p. 4",
 *    "Sheet1!A12:F31") is derived from what the parser actually found. If a
 *    page yields no text, it produces no section -- so the model can never
 *    cite a page it was never shown.
 * 2. **Report limits, don't hide them.** Scanned PDFs, truncated sheets and
 *    documents over the character ceiling all set `warnings`/`truncated`
 *    rather than silently returning a partial result that reads as complete.
 *
 * Uploaded content is DATA, never instruction. Nothing here evaluates,
 * executes or follows it; the prompt builder (`@/server/documents/context.ts`)
 * is what fences it off when it reaches a model.
 */

/* --------------------------------------------------------- byte sniffing -- */

const ZIP_SIG = [0x50, 0x4b, 0x03, 0x04]; // DOCX and XLSX are both ZIP containers
const PDF_SIG = [0x25, 0x50, 0x44, 0x46]; // "%PDF"

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

/**
 * Confirms the real type from the bytes, independent of the filename.
 *
 * Returns the kind the CONTENT supports, or null when the content
 * contradicts the extension. A `.pdf` that is really a ZIP is rejected here
 * rather than crashing a parser three frames deeper.
 *
 * Text-ish kinds (code/text/markdown/csv) have no signature, so they are
 * validated differently: by decoding as UTF-8 and rejecting content that
 * looks binary (see `looksBinary`).
 */
export function sniffDocumentKind(bytes: Uint8Array, filename: string): DocumentKind | null {
  const claimed = documentKindFromName(filename);
  if (!claimed) return null;

  if (claimed === "pdf") return startsWith(bytes, PDF_SIG) ? "pdf" : null;
  if (claimed === "docx" || claimed === "xlsx") {
    return startsWith(bytes, ZIP_SIG) ? claimed : null;
  }
  // csv/text/markdown/code: must not be binary.
  return looksBinary(bytes) ? null : claimed;
}

/**
 * Heuristic for "these bytes are not text". A NUL byte in the first 8 KB is
 * the strongest single signal -- real UTF-8 text does not contain one -- and
 * it is what distinguishes a renamed executable from a source file.
 */
export function looksBinary(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 8192);
  for (const byte of sample) {
    if (byte === 0) return true;
  }
  return false;
}

/* ------------------------------------------------------------ text split -- */

/** Characters per section for flowing text. Small enough to cite precisely. */
const TEXT_SECTION_CHARS = 1_800;

/**
 * Splits plain text or code into sections on LINE boundaries, so a citation
 * can name real line numbers and a code section never ends mid-statement.
 */
function splitLines(text: string, label: (from: number, to: number) => string): DocumentSection[] {
  const lines = text.split(/\r?\n/);
  const sections: DocumentSection[] = [];
  let buffer: string[] = [];
  let startLine = 1;
  let length = 0;

  const flush = (endLine: number) => {
    const body = buffer.join("\n").trim();
    if (body.length > 0) {
      sections.push({
        ref: label(startLine, endLine),
        text: body,
        lineStart: startLine,
        lineEnd: endLine,
      });
    }
    buffer = [];
    length = 0;
  };

  for (let i = 0; i < lines.length; i += 1) {
    buffer.push(lines[i]);
    length += lines[i].length + 1;
    if (length >= TEXT_SECTION_CHARS) {
      flush(i + 1);
      startLine = i + 2;
    }
  }
  flush(lines.length);
  return sections;
}

/* ------------------------------------------------------------------- PDF -- */

/**
 * `unpdf` rather than `pdf-parse`: it ships a serverless build of PDF.js with
 * no native dependency and no filesystem access at import time, which is what
 * makes it work inside a Vercel function. `mergePages: false` is the reason
 * it was chosen over the simpler call -- it returns text PER PAGE, which is
 * what makes "p. 4" a real citation rather than a guess.
 */
async function parsePdf(bytes: Uint8Array, filename: string): Promise<ParsedDocument> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const warnings: string[] = [];

  let totalPages = 0;
  let pages: string[] = [];
  try {
    const pdf = await getDocumentProxy(bytes);
    const result = await extractText(pdf, { mergePages: false });
    totalPages = result.totalPages;
    pages = Array.isArray(result.text) ? result.text : [result.text];
  } catch (error) {
    throw new DocumentParseError(
      "This PDF could not be read. It may be corrupted, encrypted, or password-protected.",
      error,
    );
  }

  const sections: DocumentSection[] = [];
  const emptyPages: number[] = [];
  let chars = 0;
  let truncated = false;

  for (let index = 0; index < pages.length; index += 1) {
    const pageNumber = index + 1;
    const text = (pages[index] ?? "").replace(/\s+\n/g, "\n").trim();
    if (text.length === 0) {
      emptyPages.push(pageNumber);
      continue;
    }
    if (chars >= MAX_DOCUMENT_CHARS) {
      truncated = true;
      break;
    }
    // A long page is split further so one section is never too big to cite
    // usefully, but the page number is preserved on every piece.
    const pieces = text.length > TEXT_SECTION_CHARS * 2
      ? splitLines(text, () => `p. ${pageNumber}`)
      : [{ ref: `p. ${pageNumber}`, text }];
    for (const piece of pieces) {
      sections.push({ ...piece, ref: `p. ${pageNumber}`, page: pageNumber });
      chars += piece.text.length;
    }
  }

  /**
   * Scanned-PDF detection. A PDF of page images has pages but no selectable
   * text, so extraction "succeeds" and returns nothing useful. Saying so is
   * the whole point: the brief forbids presenting that as a complete read.
   */
  if (sections.length === 0 && totalPages > 0) {
    warnings.push(
      `No selectable text found in any of the ${totalPages} page(s). This is usually a scanned PDF — ` +
        `it needs OCR, which this app does not perform on PDFs. Tip: a screenshot of a page can be ` +
        `attached as an image instead, where the vision models do read text.`,
    );
  } else if (emptyPages.length > 0) {
    warnings.push(
      `No selectable text on page(s) ${summariseRange(emptyPages)} — likely scanned or image-only. ` +
        `Answers will not cover them.`,
    );
  }
  if (truncated) {
    warnings.push(
      `Only the first ${chars.toLocaleString()} characters were indexed (document limit). ` +
        `Later pages are not searchable.`,
    );
  }

  return {
    kind: "pdf",
    filename,
    mimeType: "application/pdf",
    bytes: bytes.byteLength,
    sections,
    meta: { pages: totalPages, chars, truncated },
    warnings,
  };
}

/** "1, 2, 5-9" rather than a wall of numbers. */
function summariseRange(numbers: readonly number[]): string {
  const out: string[] = [];
  let start = numbers[0];
  let previous = numbers[0];
  for (let i = 1; i <= numbers.length; i += 1) {
    const current = numbers[i];
    if (current !== previous + 1) {
      out.push(start === previous ? `${start}` : `${start}-${previous}`);
      start = current;
    }
    previous = current;
  }
  return out.join(", ");
}

/* ------------------------------------------------------------------ DOCX -- */

/**
 * `mammoth` with `convertToHtml`, not `extractRawText`: the HTML keeps the
 * heading structure, which becomes the section boundaries and the `heading`
 * on each section. Raw text would flatten a report into one undifferentiated
 * blob with nothing to cite.
 */
async function parseDocx(bytes: Uint8Array, filename: string): Promise<ParsedDocument> {
  let html: string;
  const warnings: string[] = [];
  try {
    const result = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
    html = result.value;
    for (const message of result.messages.slice(0, 5)) {
      if (message.type === "warning") warnings.push(`DOCX: ${message.message}`);
    }
  } catch (error) {
    throw new DocumentParseError(
      "This Word file could not be read. It may be corrupted, or saved in the older .doc format, which is not supported.",
      error,
    );
  }

  // Block-level split, then tag-strip. Entities are decoded for the five that
  // matter; this is text extraction, not HTML rendering, and the output is
  // never treated as markup anywhere downstream.
  const blocks = html
    .split(/<\/(?:h[1-6]|p|li|tr|div)>/i)
    .map((block) => ({
      heading: /<h[1-6][^>]*>/i.test(block),
      text: block
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
        .trim(),
    }))
    .filter((block) => block.text.length > 0);

  const sections: DocumentSection[] = [];
  let currentHeading = "";
  let buffer: string[] = [];
  let sectionIndex = 1;
  let chars = 0;
  let truncated = false;

  const flush = () => {
    const text = buffer.join("\n").trim();
    if (text.length === 0) return;
    sections.push({
      ref: currentHeading ? `“${currentHeading.slice(0, 60)}”` : `section ${sectionIndex}`,
      text,
      heading: currentHeading || undefined,
    });
    sectionIndex += 1;
    chars += text.length;
    buffer = [];
  };

  for (const block of blocks) {
    if (chars >= MAX_DOCUMENT_CHARS) {
      truncated = true;
      break;
    }
    if (block.heading) {
      flush();
      currentHeading = block.text;
      buffer.push(block.text);
      continue;
    }
    buffer.push(block.text);
    if (buffer.join("\n").length >= TEXT_SECTION_CHARS) flush();
  }
  flush();

  if (sections.length === 0) {
    warnings.push("No text could be extracted from this Word file — it may contain only images.");
  }
  if (truncated) {
    warnings.push(`Only the first ${chars.toLocaleString()} characters were indexed (document limit).`);
  }

  return {
    kind: "docx",
    filename,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    bytes: bytes.byteLength,
    sections,
    meta: { chars, truncated },
    warnings,
  };
}

/* ------------------------------------------------------ XLSX / CSV / TSV -- */

/** Rows per section. Small enough to cite, big enough to keep a table coherent. */
const SHEET_ROWS_PER_SECTION = 40;

/** 0-based column index -> spreadsheet letter, so refs read like a real app. */
function columnLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    out = String.fromCharCode(65 + remainder) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/**
 * Spreadsheets become TSV-shaped text with the header row repeated on every
 * section. The repetition is deliberate: a retrieved chunk from row 900 is
 * meaningless without its column names, and re-attaching them later would
 * mean guessing which header belonged to which chunk.
 */
function parseSheets(
  workbook: XLSX.WorkBook,
  filename: string,
  kind: DocumentKind,
  mimeType: string,
  bytes: number,
): ParsedDocument {
  const sections: DocumentSection[] = [];
  const warnings: string[] = [];
  const sheets: string[] = [];
  let totalRows = 0;
  let chars = 0;
  let truncated = false;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    sheets.push(sheetName);

    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      blankrows: false,
      defval: "",
    });
    if (rows.length === 0) continue;

    const limited = rows.slice(0, MAX_SHEET_ROWS);
    if (rows.length > MAX_SHEET_ROWS) {
      truncated = true;
      warnings.push(
        `Sheet “${sheetName}” has ${rows.length.toLocaleString()} rows; only the first ` +
          `${MAX_SHEET_ROWS.toLocaleString()} were indexed.`,
      );
    }
    totalRows += limited.length;

    const header = (limited[0] ?? []).map((cell) => String(cell ?? "").trim());
    const headerLine = header.join("\t");
    const lastColumn = columnLetter(Math.max(0, header.length - 1));

    for (let start = 1; start < limited.length; start += SHEET_ROWS_PER_SECTION) {
      if (chars >= MAX_DOCUMENT_CHARS) {
        truncated = true;
        break;
      }
      const slice = limited.slice(start, start + SHEET_ROWS_PER_SECTION);
      const body = slice
        .map((row) => (row as unknown[]).map((cell) => String(cell ?? "").trim()).join("\t"))
        .join("\n");
      // +1 twice: sheet_to_json is 0-based, spreadsheets are 1-based.
      const firstRow = start + 1;
      const lastRow = start + slice.length;
      const text = `${headerLine}\n${body}`;
      sections.push({
        ref: `${sheetName}!A${firstRow}:${lastColumn}${lastRow}`,
        text,
        sheet: sheetName,
        rowStart: firstRow,
        rowEnd: lastRow,
      });
      chars += text.length;
    }
  }

  if (sections.length === 0) {
    warnings.push("No data rows were found in this spreadsheet.");
  }

  return {
    kind,
    filename,
    mimeType,
    bytes,
    sections,
    meta: { sheets, rows: totalRows, chars, truncated },
    warnings,
  };
}

/* ------------------------------------------------------------- the error -- */

/** A parse failure the user can act on. Never carries the raw library error. */
export class DocumentParseError extends Error {
  cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "DocumentParseError";
    this.cause = cause;
  }
}

/* ---------------------------------------------------------------- parse() -- */

/**
 * Parses one uploaded document. The kind is re-derived from the BYTES, not
 * taken from the caller, so a mislabelled file is refused rather than routed
 * to the wrong parser.
 */
export async function parseDocument(
  bytes: Uint8Array,
  filename: string,
): Promise<ParsedDocument> {
  const kind = sniffDocumentKind(bytes, filename);
  if (!kind) {
    throw new DocumentParseError(
      `${filename} is not a supported document, or its contents do not match its file extension.`,
    );
  }
  if (bytes.byteLength === 0) {
    throw new DocumentParseError(`${filename} is empty.`);
  }

  if (kind === "pdf") return parsePdf(bytes, filename);
  if (kind === "docx") return parseDocx(bytes, filename);

  if (kind === "xlsx") {
    try {
      const workbook = XLSX.read(bytes, { type: "array" });
      return parseSheets(
        workbook,
        filename,
        "xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        bytes.byteLength,
      );
    } catch (error) {
      throw new DocumentParseError("This spreadsheet could not be read. It may be corrupted.", error);
    }
  }

  // csv / tsv / text / markdown / code all arrive as UTF-8 text.
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (text.trim().length === 0) {
    throw new DocumentParseError(`${filename} contains no readable text.`);
  }

  if (kind === "csv") {
    try {
      const workbook = XLSX.read(text, { type: "string", raw: true });
      const parsed = parseSheets(workbook, filename, "csv", "text/csv", bytes.byteLength);
      // A CSV has one anonymous sheet; name the refs after the file instead.
      parsed.sections = parsed.sections.map((section) => ({
        ...section,
        ref: section.rowStart ? `rows ${section.rowStart}-${section.rowEnd}` : section.ref,
      }));
      return parsed;
    } catch (error) {
      throw new DocumentParseError("This CSV could not be parsed.", error);
    }
  }

  const truncatedText = text.slice(0, MAX_DOCUMENT_CHARS);
  const sections = splitLines(truncatedText, (from, to) => `lines ${from}-${to}`);
  const warnings: string[] = [];
  if (text.length > MAX_DOCUMENT_CHARS) {
    warnings.push(`Only the first ${MAX_DOCUMENT_CHARS.toLocaleString()} characters were indexed.`);
  }

  return {
    kind,
    filename,
    mimeType: kind === "markdown" ? "text/markdown" : "text/plain",
    bytes: bytes.byteLength,
    sections,
    meta: { chars: truncatedText.length, truncated: text.length > MAX_DOCUMENT_CHARS },
    warnings,
  };
}
