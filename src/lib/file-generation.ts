import { parseMarkdown, type BlockNode, type InlineNode } from "@/lib/markdown";

/**
 * Project 4, Milestone 5: turning an answer into a real file.
 *
 * REAL means a file the receiving application opens on its own terms: a
 * .docx whose headings are Word headings and whose tables are Word tables,
 * an .xlsx whose numbers are numeric cells, a .pdf with a genuine text layer
 * that can be searched, selected and -- the test this project actually runs
 * -- parsed back out again. A text file renamed `.docx` would satisfy a
 * download button and nothing else.
 *
 * The structure comes from the SAME parser that renders the answer on screen
 * (`markdown.ts`), so the file matches what the user saw. Nothing re-parses
 * the text with different rules, which is how exported documents usually end
 * up subtly different from the thing that was exported.
 *
 * Every generator is loaded on demand. `docx`, `jspdf` and `xlsx` together
 * are far larger than the rest of this app, and most sessions never save a
 * file.
 */

export type FileFormat = "docx" | "pdf" | "xlsx" | "json" | "markdown" | "code";

export type GeneratedFile = {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
};

/* ------------------------------------------------------------- naming ---- */

/** Maps a fenced block's language to the extension a developer expects. */
const CODE_EXTENSIONS: Record<string, string> = {
  javascript: "js",
  js: "js",
  jsx: "jsx",
  typescript: "ts",
  ts: "ts",
  tsx: "tsx",
  python: "py",
  py: "py",
  java: "java",
  c: "c",
  cpp: "cpp",
  "c++": "cpp",
  csharp: "cs",
  cs: "cs",
  go: "go",
  rust: "rs",
  rs: "rs",
  ruby: "rb",
  rb: "rb",
  php: "php",
  swift: "swift",
  kotlin: "kt",
  sql: "sql",
  bash: "sh",
  sh: "sh",
  shell: "sh",
  yaml: "yml",
  yml: "yml",
  json: "json",
  html: "html",
  css: "css",
  xml: "xml",
  markdown: "md",
  md: "md",
};

export function codeExtension(lang: string | null): string {
  if (!lang) return "txt";
  return CODE_EXTENSIONS[lang.toLowerCase()] ?? "txt";
}

/**
 * A filename from the answer's own first heading or sentence.
 *
 * Better than "download (3).docx": the file is findable later by what it is
 * about. Restricted to characters every filesystem accepts, and capped so a
 * rambling first sentence cannot produce an unusable name.
 */
export function suggestFilename(blocks: readonly BlockNode[], fallback = "answer"): string {
  const heading = blocks.find((block) => block.type === "heading");
  const source =
    heading && heading.type === "heading"
      ? inlineToText(heading.children)
      : (() => {
          const paragraph = blocks.find((block) => block.type === "paragraph");
          return paragraph && paragraph.type === "paragraph" ? inlineToText(paragraph.children) : "";
        })();

  const cleaned = source
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .split(/\s+/)
    .slice(0, 8)
    .join("-")
    .toLowerCase();
  return cleaned.length >= 3 ? cleaned.slice(0, 60) : fallback;
}

/* ------------------------------------------------------------- inline ---- */

export function inlineToText(nodes: readonly InlineNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text") return node.value;
      if (node.type === "code") return node.value;
      return inlineToText(node.children);
    })
    .join("");
}

type Styled = { text: string; bold: boolean; italic: boolean; code: boolean; href?: string };

/** Flattens the inline tree into styled spans, preserving nested emphasis. */
export function flattenInline(
  nodes: readonly InlineNode[],
  inherited: { bold?: boolean; italic?: boolean; href?: string } = {},
): Styled[] {
  const out: Styled[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      out.push({
        text: node.value,
        bold: Boolean(inherited.bold),
        italic: Boolean(inherited.italic),
        code: false,
        href: inherited.href,
      });
    } else if (node.type === "code") {
      out.push({
        text: node.value,
        bold: Boolean(inherited.bold),
        italic: Boolean(inherited.italic),
        code: true,
        href: inherited.href,
      });
    } else if (node.type === "strong") {
      out.push(...flattenInline(node.children, { ...inherited, bold: true }));
    } else if (node.type === "em") {
      out.push(...flattenInline(node.children, { ...inherited, italic: true }));
    } else {
      out.push(...flattenInline(node.children, { ...inherited, href: node.href }));
    }
  }
  return out;
}

/* ------------------------------------------------- what can be offered --- */

export function findTables(blocks: readonly BlockNode[]): Extract<BlockNode, { type: "table" }>[] {
  return blocks.filter((block): block is Extract<BlockNode, { type: "table" }> => block.type === "table");
}

export function findCodeBlocks(blocks: readonly BlockNode[]): Extract<BlockNode, { type: "code" }>[] {
  return blocks.filter((block): block is Extract<BlockNode, { type: "code" }> => block.type === "code");
}

/**
 * Characters the standard PDF fonts can draw: Latin-1, Latin Extended-A/B,
 * general punctuation (curly quotes, dashes, ellipsis) and the euro sign.
 * The range starts at U+0000 so ordinary whitespace counts as supported.
 */
const PDF_RENDERABLE = /[\u0000-ɏ‐-›€]/;

/**
 * Symbols worth KEEPING as an ASCII equivalent rather than dropping.
 *
 * These are what a model actually emits in an English report -- arrows in a
 * flow, a tick in a checklist, a maths comparator -- and losing them silently
 * changes what a sentence says. Anything not listed here and not renderable
 * (emoji, CJK, Arabic) is dropped instead: lossy, but honest, because the
 * built-in fonts genuinely cannot draw it.
 */
const PDF_SUBSTITUTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/[→➡⇒]/g, "->"],
  [/[←⇐]/g, "<-"],
  [/[↔⇔]/g, "<->"],
  [/[↑↓]/g, "|"],
  [/[✓✔✅]/g, "[x]"],
  [/[✗✘❌]/g, "[ ]"],
  [/≈/g, "~"],
  [/≤/g, "<="],
  [/≥/g, ">="],
  [/≠/g, "!="],
  [/™/g, "(TM)"],
  [/…/g, "..."],
  [/[•●▪■]/g, "-"],
  [/₹/g, "INR "],
  [/¥/g, "JPY "],
];

function applySubstitutions(text: string): string {
  let out = text;
  for (const [pattern, replacement] of PDF_SUBSTITUTIONS) out = out.replace(pattern, replacement);
  return out;
}

/**
 * Makes text drawable by jsPDF's built-in fonts.
 *
 * Applied to every string the PDF generator writes. Without it, an answer was
 * REFUSED a PDF outright for containing a single arrow or emoji -- which is
 * exactly what users hit: Word, Excel and Markdown worked while PDF stayed
 * permanently greyed out. Refusing a whole document over one stray symbol was
 * the wrong trade. Substituting what has an ASCII equivalent, and dropping
 * only what genuinely cannot be drawn, keeps the document.
 */
export function sanitiseForPdf(text: string): string {
  return [...applySubstitutions(text)]
    .filter((character) => PDF_RENDERABLE.test(character))
    .join("");
}

/**
 * The share of real content the PDF fonts cannot draw, AFTER substitution.
 * Whitespace is ignored, so line breaks cannot dilute the measurement.
 */
export function unsupportedPdfShare(text: string): number {
  const characters = [...applySubstitutions(text)].filter((character) => !/\s/.test(character));
  if (characters.length === 0) return 0;
  const unsupported = characters.filter((character) => !PDF_RENDERABLE.test(character)).length;
  return unsupported / characters.length;
}

/**
 * Above this share of undrawable content, a PDF is refused.
 *
 * A threshold rather than "contains anything unusual". An English report with
 * an emoji in it loses the emoji and keeps every word -- a perfectly good
 * PDF. An Arabic or CJK answer would lose nearly everything, and handing
 * someone a near-empty document is worse than pointing them at Word.
 */
const PDF_REFUSAL_THRESHOLD = 0.1;

export function hasUnsupportedPdfText(text: string): boolean {
  return unsupportedPdfShare(text) > PDF_REFUSAL_THRESHOLD;
}

export type FormatAvailability = {
  format: FileFormat;
  label: string;
  available: boolean;
  /** Why it is unavailable, shown rather than leaving a dead control. */
  reason?: string;
};

/** Whether an answer contains something that would parse as JSON. */
function hasJson(blocks: readonly BlockNode[], text: string): boolean {
  const fenced = findCodeBlocks(blocks).find((block) => (block.lang ?? "").toLowerCase() === "json");
  const candidate = (fenced?.value ?? text).trim();
  if (!candidate.startsWith("{") && !candidate.startsWith("[")) return false;
  try {
    JSON.parse(candidate);
    return true;
  } catch {
    return false;
  }
}

export function availableFormats(text: string): FormatAvailability[] {
  const blocks = parseMarkdown(text);
  const tables = findTables(blocks);
  const code = findCodeBlocks(blocks);
  return [
    { format: "docx", label: "Word (.docx)", available: true },
    {
      format: "pdf",
      label: "PDF",
      available: !hasUnsupportedPdfText(text),
      reason: hasUnsupportedPdfText(text)
        ? "PDF export cannot render this script — use Word, which handles it correctly."
        : undefined,
    },
    {
      format: "xlsx",
      label: "Excel (.xlsx)",
      available: tables.length > 0,
      reason: tables.length === 0 ? "This answer has no table to put in a spreadsheet." : undefined,
    },
    {
      format: "code",
      label: code.length > 0 ? `Code (.${codeExtension(code[0].lang)})` : "Code",
      available: code.length > 0,
      reason: code.length === 0 ? "This answer has no code block." : undefined,
    },
    {
      format: "json",
      label: "JSON (.json)",
      available: hasJson(blocks, text),
      reason: hasJson(blocks, text) ? undefined : "This answer has no JSON to save.",
    },
    { format: "markdown", label: "Markdown (.md)", available: true },
  ];
}

/* --------------------------------------------------------------- docx ---- */

async function generateDocx(blocks: readonly BlockNode[], name: string): Promise<GeneratedFile> {
  const {
    AlignmentType,
    BorderStyle,
    Document,
    HeadingLevel,
    LevelFormat,
    Packer,
    Paragraph,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
  } = await import("docx");

  const HEADING = {
    1: HeadingLevel.HEADING_1,
    2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3,
    4: HeadingLevel.HEADING_4,
  } as const;

  const runs = (nodes: readonly InlineNode[], options: { color?: string } = {}) =>
    flattenInline(nodes).map(
      (span) =>
        new TextRun({
          text: span.text,
          bold: span.bold,
          italics: span.italic,
          // Inline code keeps a monospace face so it stays visually distinct
          // in Word rather than melting into the prose.
          ...(span.code ? { font: "Consolas" } : {}),
          ...(options.color ? { color: options.color } : {}),
        }),
    );

  // `docx` is imported dynamically, so its classes are values here rather
  // than importable types -- `InstanceType` recovers the element type.
  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case "heading":
        children.push(new Paragraph({ heading: HEADING[block.level], children: runs(block.children) }));
        break;
      case "paragraph":
        children.push(new Paragraph({ children: runs(block.children), spacing: { after: 120 } }));
        break;
      case "quote":
        children.push(
          new Paragraph({
            children: flattenInline(block.children).map(
              (span) => new TextRun({ text: span.text, italics: true, bold: span.bold }),
            ),
            indent: { left: 480 },
            spacing: { after: 120 },
          }),
        );
        break;
      case "list":
        for (const item of block.items) {
          children.push(
            new Paragraph({
              children: runs(item),
              // Real Word list formatting, not a "- " typed into the text:
              // the result renumbers and re-indents like any other list.
              ...(block.ordered
                ? { numbering: { reference: "ordered-list", level: 0 } }
                : { bullet: { level: 0 } }),
            }),
          );
        }
        break;
      case "code":
        // One paragraph per line: a single paragraph with newlines in it
        // collapses to one long line in Word.
        for (const line of block.value.split("\n")) {
          children.push(
            new Paragraph({
              children: [new TextRun({ text: line || " ", font: "Consolas", size: 18 })],
              spacing: { after: 0 },
              shading: { fill: "F3F4F6" },
            }),
          );
        }
        children.push(new Paragraph({ text: "", spacing: { after: 120 } }));
        break;
      case "table": {
        const headerRow = new TableRow({
          tableHeader: true,
          children: block.header.map(
            (cell) =>
              new TableCell({
                children: [
                  new Paragraph({
                    children: flattenInline(cell).map(
                      (span) => new TextRun({ text: span.text, bold: true }),
                    ),
                    alignment:
                      block.align[block.header.indexOf(cell)] === "right"
                        ? AlignmentType.RIGHT
                        : block.align[block.header.indexOf(cell)] === "center"
                          ? AlignmentType.CENTER
                          : AlignmentType.LEFT,
                  }),
                ],
                shading: { fill: "EEF1F5" },
              }),
          ),
        });
        const bodyRows = block.rows.map(
          (row) =>
            new TableRow({
              children: row.map(
                (cell, index) =>
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: runs(cell),
                        alignment:
                          block.align[index] === "right"
                            ? AlignmentType.RIGHT
                            : block.align[index] === "center"
                              ? AlignmentType.CENTER
                              : AlignmentType.LEFT,
                      }),
                    ],
                  }),
              ),
            }),
        );
        children.push(
          new Table({ rows: [headerRow, ...bodyRows], width: { size: 100, type: WidthType.PERCENTAGE } }),
        );
        children.push(new Paragraph({ text: "", spacing: { after: 120 } }));
        break;
      }
      case "hr":
        children.push(
          new Paragraph({
            text: "",
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC" } },
            spacing: { after: 120 },
          }),
        );
        break;
    }
  }

  if (children.length === 0) children.push(new Paragraph({ text: "" }));

  const document = new Document({
    numbering: {
      config: [
        {
          reference: "ordered-list",
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.START,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [{ children }],
  });

  const bytes = await Packer.toBuffer(document);
  return {
    filename: `${name}.docx`,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    bytes: new Uint8Array(bytes),
  };
}

/* ---------------------------------------------------------------- pdf ---- */

async function generatePdf(blocks: readonly BlockNode[], name: string): Promise<GeneratedFile> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });

  const MARGIN = 56;
  const WIDTH = doc.internal.pageSize.getWidth() - MARGIN * 2;
  const BOTTOM = doc.internal.pageSize.getHeight() - MARGIN;
  let y = MARGIN;

  const ensureRoom = (needed: number) => {
    if (y + needed > BOTTOM) {
      doc.addPage();
      y = MARGIN;
    }
  };

  /**
   * Every string drawn into the PDF goes through `sanitiseForPdf` first, at
   * these two writers rather than scattered through the block switch, so a
   * future block type cannot forget it.
   */
  const writeLines = (
    rawText: string,
    options: { size: number; style?: "normal" | "bold" | "italic"; font?: string; indent?: number },
  ) => {
    doc.setFont(options.font ?? "helvetica", options.style ?? "normal");
    doc.setFontSize(options.size);
    const indent = options.indent ?? 0;
    const text = sanitiseForPdf(rawText);
    const lines = doc.splitTextToSize(text, WIDTH - indent) as string[];
    const lineHeight = options.size * 1.35;
    for (const line of lines) {
      ensureRoom(lineHeight);
      doc.text(line, MARGIN + indent, y);
      y += lineHeight;
    }
  };

  for (const block of blocks) {
    switch (block.type) {
      case "heading": {
        const size = block.level === 1 ? 19 : block.level === 2 ? 16 : block.level === 3 ? 13.5 : 12;
        y += 6;
        writeLines(inlineToText(block.children), { size, style: "bold" });
        y += 4;
        break;
      }
      case "paragraph":
        writeLines(inlineToText(block.children), { size: 11 });
        y += 6;
        break;
      case "quote":
        writeLines(inlineToText(block.children), { size: 11, style: "italic", indent: 18 });
        y += 6;
        break;
      case "list":
        block.items.forEach((item, index) => {
          const marker = block.ordered ? `${block.start + index}. ` : "• ";
          writeLines(marker + inlineToText(item), { size: 11, indent: 14 });
        });
        y += 6;
        break;
      case "code":
        for (const line of block.value.split("\n")) {
          writeLines(line || " ", { size: 9.5, font: "courier" });
        }
        y += 6;
        break;
      case "table": {
        // Drawn as real ruled rows rather than tab-separated text, so the
        // PDF looks like a table and still carries selectable text.
        const columns = block.header.length || 1;
        const columnWidth = WIDTH / columns;
        const drawRow = (cells: string[], bold: boolean) => {
          doc.setFont("helvetica", bold ? "bold" : "normal");
          doc.setFontSize(10);
          const wrapped = cells.map(
            (cell) => doc.splitTextToSize(sanitiseForPdf(cell), columnWidth - 8) as string[],
          );
          const height = Math.max(...wrapped.map((lines) => lines.length)) * 13 + 6;
          ensureRoom(height);
          wrapped.forEach((lines, index) => {
            lines.forEach((line, lineIndex) => {
              doc.text(line, MARGIN + index * columnWidth + 4, y + 10 + lineIndex * 13);
            });
          });
          doc.setDrawColor(200);
          doc.line(MARGIN, y + height, MARGIN + WIDTH, y + height);
          y += height;
        };
        drawRow(block.header.map(inlineToText), true);
        for (const row of block.rows) drawRow(row.map(inlineToText), false);
        y += 10;
        break;
      }
      case "hr":
        ensureRoom(12);
        doc.setDrawColor(200);
        doc.line(MARGIN, y, MARGIN + WIDTH, y);
        y += 12;
        break;
    }
  }

  const bytes = new Uint8Array(doc.output("arraybuffer") as ArrayBuffer);
  return { filename: `${name}.pdf`, mimeType: "application/pdf", bytes };
}

/* --------------------------------------------------------------- xlsx ---- */

/**
 * Numbers that are numbers.
 *
 * A cell reading "1,250.00" or "$1,250" is text as far as a spreadsheet is
 * concerned, and a column of it cannot be summed -- which is the single most
 * common reason an exported spreadsheet is useless. Anything that is
 * unambiguously a number after stripping currency and separators becomes a
 * numeric cell; everything else stays text rather than being coerced into a
 * wrong number.
 */
export function coerceCell(value: string): string | number {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const stripped = trimmed.replace(/[\s,]/g, "").replace(/^[$£€]/, "");
  if (/^-?\d+(\.\d+)?$/.test(stripped)) {
    const parsed = Number(stripped);
    if (Number.isFinite(parsed)) return parsed;
  }
  return trimmed;
}

async function generateXlsx(blocks: readonly BlockNode[], name: string): Promise<GeneratedFile> {
  const XLSX = await import("xlsx");
  const tables = findTables(blocks);
  const workbook = XLSX.utils.book_new();

  tables.forEach((table, index) => {
    const rows: (string | number)[][] = [table.header.map((cell) => inlineToText(cell).trim())];
    for (const row of table.rows) rows.push(row.map((cell) => coerceCell(inlineToText(cell))));
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet["!cols"] = table.header.map(() => ({ wch: 24 }));
    XLSX.utils.book_append_sheet(workbook, sheet, tables.length === 1 ? "Table" : `Table ${index + 1}`);
  });

  if (tables.length === 0) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["No table in this answer"]]), "Empty");
  }

  const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return {
    filename: `${name}.xlsx`,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    bytes: new Uint8Array(bytes),
  };
}

/* --------------------------------------------------------- text files ---- */

function textFile(content: string, filename: string, mimeType: string): GeneratedFile {
  return { filename, mimeType, bytes: new TextEncoder().encode(content) };
}

/* ------------------------------------------------------------ the API ---- */

export async function generateFile(
  format: FileFormat,
  text: string,
  options: { filename?: string } = {},
): Promise<GeneratedFile> {
  const blocks = parseMarkdown(text);
  const name = options.filename ?? suggestFilename(blocks);

  switch (format) {
    case "docx":
      return generateDocx(blocks, name);
    case "pdf":
      return generatePdf(blocks, name);
    case "xlsx":
      return generateXlsx(blocks, name);
    case "json": {
      /**
       * A JSON file must contain JSON, not an answer that mentions JSON.
       * The content comes from a fenced json block when there is one (which
       * is how a model presents structured data), otherwise from the whole
       * answer, and it is PARSED before being written -- a file that does
       * not parse is not a JSON file, and saying so beats handing over
       * something that fails on open.
       */
      const fenced = findCodeBlocks(blocks).find(
        (block) => (block.lang ?? "").toLowerCase() === "json",
      );
      const candidate = (fenced?.value ?? text).trim();
      try {
        const parsed: unknown = JSON.parse(candidate);
        const pretty = `${JSON.stringify(parsed, null, 2)}\n`;
        return textFile(pretty, `${name}.json`, "application/json");
      } catch {
        throw new Error("This answer does not contain valid JSON to save.");
      }
    }
    case "markdown":
      return textFile(text, `${name}.md`, "text/markdown");
    case "code": {
      const code = findCodeBlocks(blocks);
      if (code.length === 0) {
        // Not reachable through the UI (the control is disabled without a
        // code block), but a caller that asks anyway gets the whole answer
        // as plain text rather than an empty file.
        return textFile(text, `${name}.txt`, "text/plain");
      }
      // Several blocks are concatenated with a blank line between them --
      // a model asked for "the file" often emits it in pieces.
      const content = code.map((block) => block.value).join("\n\n");
      return textFile(content, `${name}.${codeExtension(code[0].lang)}`, "text/plain");
    }
  }
}

/* ------------------------------------------- what the user actually asked */

/**
 * The file format a question is asking for, if it is asking for one.
 *
 * Separate from `wantsFile` (server-side, decides whether the model needs to
 * be told it CAN make files). This one decides what the transcript should
 * offer: when someone asks for "a PDF", the answer is rendered as a file card
 * with a download button rather than as a wall of text they have to scroll
 * past and then find a menu for.
 *
 * Checked most-specific first, because "export the report as a PDF" mentions
 * both a document and a PDF, and the PDF is the part that was asked for.
 */
const FORMAT_PATTERNS: ReadonlyArray<readonly [RegExp, FileFormat]> = [
  [/\bpdfs?\b/i, "pdf"],
  [/\b(xlsx?|excel|spreadsheet|workbook)\b/i, "xlsx"],
  [/\b(docx?|word document|word file|word doc)\b/i, "docx"],
  [/\bjson\b/i, "json"],
  [/\bmarkdown\b|\.md\b/i, "markdown"],
  [/\b(code file|source file|script file)\b/i, "code"],
  // Generic document words come last: they only mean "docx" once nothing
  // more specific has matched.
  [/\b(document|report|memo|letter|proposal)\b/i, "docx"],
];

/** The filename stem an answer would be saved under, without parsing twice. */
export function filenameStemFor(text: string): string {
  return suggestFilename(parseMarkdown(text));
}

export function detectRequestedFormat(question: string): FileFormat | null {
  for (const [pattern, format] of FORMAT_PATTERNS) {
    if (pattern.test(question)) return format;
  }
  return null;
}

/** Human label for a format, for the file card. */
export const FORMAT_LABELS: Record<FileFormat, string> = {
  docx: "Word document",
  pdf: "PDF",
  xlsx: "Excel spreadsheet",
  json: "JSON file",
  markdown: "Markdown",
  code: "Code file",
};

/**
 * The extension a format will produce, so the card can show the real
 * filename before anything is generated.
 */
export function extensionFor(format: FileFormat, text: string): string {
  if (format === "code") {
    const code = findCodeBlocks(parseMarkdown(text));
    return code.length > 0 ? codeExtension(code[0].lang) : "txt";
  }
  return format === "markdown" ? "md" : format;
}

/**
 * Whether an answer is substantial enough to be worth collapsing into a card.
 *
 * A one-line reply ("Sure -- what should it cover?") is not a document, and
 * hiding it behind a download button would be absurd.
 *
 * Length alone is a poor test, though: a tight one-page report with a
 * heading and a table can sit under any threshold worth setting, and a
 * rambling conversational answer can sail over it. So STRUCTURE counts
 * first -- a heading, a table or a list is what a document looks like --
 * and length is only the fallback for prose that has none of them.
 */
export function looksLikeDocument(text: string): boolean {
  const trimmed = text.trim();
  // Below this nothing is a document, however it is shaped: a two-item list
  // saying "Sure / What topic?" is a question, not a report.
  if (trimmed.length < 60) return false;

  const blocks = parseMarkdown(trimmed);
  const structured = blocks.some(
    (block) => block.type === "heading" || block.type === "table" || block.type === "list",
  );
  // Structure is the signal; plain prose has to be long enough to be one.
  return structured || trimmed.length >= 200;
}

/* ------------------------------- the document inside a conversational reply */

/**
 * The fence a model is asked to put around document content.
 *
 * Why a fence at all: the file and the chat reply were the same string, so
 * "Sure, here is your PDF:" ended up INSIDE the PDF. Asking the model nicely
 * not to editorialise is a mitigation, not a boundary -- models add a line of
 * preamble constantly, and the user discovers it only after opening the file.
 *
 * A marker is something the generator can act on rather than hope for.
 */
export const DOCUMENT_OPEN = "<<<FILE>>>";
export const DOCUMENT_CLOSE = "<<<END FILE>>>";

const FENCE_PATTERN = /<<<FILE>>>\s*([\s\S]*?)\s*(?:<<<END FILE>>>|$)/;

/**
 * Conversational openers. Matched only against a SHORT leading paragraph that
 * is plain prose -- never a heading, table, list or code block, which are
 * document content by definition.
 */
const PREAMBLE_PATTERNS: readonly RegExp[] = [
  /^(sure|certainly|of course|absolutely|no problem|got it)\b/i,
  /^here('s| is| are)\b/i,
  /^below is\b/i,
  /^i('ve| have)\s+(created|prepared|generated|written|put together|drafted)\b/i,
  /^(this|the following) is (the|a|your)\b/i,
  /^you can (find|download)\b/i,
];

/** Conversational closers, matched against a short trailing paragraph. */
const CLOSER_PATTERNS: readonly RegExp[] = [
  /^let me know\b/i,
  /^feel free\b/i,
  /^(i )?hope (this|that|it)\b/i,
  /^would you like\b/i,
  /^(if you|should you) (need|want|would)\b/i,
  /^(you can|just) (download|click|use)\b/i,
];

/** Longer than this, a paragraph is content even if it opens politely. */
const CHATTER_MAX_CHARS = 240;

/** A block that is structurally document content, whatever it says. */
function isStructural(block: string): boolean {
  return /^\s*(#{1,6}\s|\||[-*+]\s|\d+[.)]\s|>|```)/.test(block);
}

function isChatter(block: string, patterns: readonly RegExp[]): boolean {
  const trimmed = block.trim();
  if (!trimmed || trimmed.length > CHATTER_MAX_CHARS) return false;
  if (isStructural(trimmed)) return false;
  return patterns.some((pattern) => pattern.test(trimmed));
}

export type DocumentExtraction = {
  /** The content that should become the file. */
  content: string;
  /** True when the model used the fence, so the boundary was explicit. */
  fenced: boolean;
  /** True when conversational text was removed. */
  trimmed: boolean;
};

/**
 * Separates the DOCUMENT from the conversation around it.
 *
 * Two mechanisms, in order of trustworthiness:
 *
 * 1. The fence. When the model marks the document explicitly, everything
 *    outside it is conversation and is dropped. Exact, and the preferred
 *    path -- `FILE_CAPABILITY_NOTE` asks for it on every file request.
 *
 * 2. Preamble trimming, for when the model ignores the fence. Only a SHORT,
 *    plain-prose opening or closing paragraph matching a known conversational
 *    shape is removed; a heading, table, list or code block is never touched,
 *    and neither is a long paragraph, because those are the document.
 *
 * `stripChatter` is off by default so the function is a no-op on an ordinary
 * answer: Save As on a normal chat message must keep exporting that message
 * verbatim, and a reply that happens to open with "Here's how recursion
 * works" must not be silently docked its first line.
 */
export function extractDocumentContent(
  answer: string,
  options: { stripChatter?: boolean } = {},
): DocumentExtraction {
  const fenced = FENCE_PATTERN.exec(answer);
  if (fenced && fenced[1].trim()) {
    return { content: fenced[1].trim(), fenced: true, trimmed: true };
  }

  if (!options.stripChatter) {
    return { content: answer.trim(), fenced: false, trimmed: false };
  }

  const blocks = answer.trim().split(/\n{2,}/);
  let start = 0;
  let end = blocks.length;
  while (start < end && isChatter(blocks[start], PREAMBLE_PATTERNS)) start += 1;
  while (end > start && isChatter(blocks[end - 1], CLOSER_PATTERNS)) end -= 1;

  // Never strip everything: if the whole reply reads as chatter, it IS the
  // reply, and an empty document helps nobody.
  if (start >= end) return { content: answer.trim(), fenced: false, trimmed: false };

  const content = blocks.slice(start, end).join("\n\n").trim();
  return { content, fenced: false, trimmed: content !== answer.trim() };
}

/**
 * The reply with the fence markers removed, for display.
 *
 * The markers are an instruction to this app, not something a reader should
 * ever see in the transcript.
 */
/**
 * Whether the model fenced a document in this answer.
 *
 * Used as a second signal for showing the file card: the fence IS the
 * model saying "this is a document". Without this, an answer that fenced a
 * document after a request whose format could not be guessed would render
 * the raw markers into the transcript, which is the one place they must
 * never appear.
 */
export function hasDocumentFence(answer: string): boolean {
  return answer.includes(DOCUMENT_OPEN);
}

export function stripDocumentMarkers(answer: string): string {
  return answer.split(DOCUMENT_OPEN).join("").split(DOCUMENT_CLOSE).join("").trim();
}
