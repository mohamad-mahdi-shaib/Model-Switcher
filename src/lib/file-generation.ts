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

export type FileFormat = "docx" | "pdf" | "xlsx" | "markdown" | "code";

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
 * Characters jsPDF's built-in fonts cannot represent.
 *
 * The standard PDF fonts are WinAnsi-encoded: Arabic, Hebrew, CJK, Greek and
 * Cyrillic come out as blanks or mojibake. This app is used with Arabic (the
 * conversation export chose a rasterising path precisely for that reason --
 * see `conversation-pdf.ts`), so rather than producing a quietly mangled PDF,
 * the caller is told to use DOCX, which is Unicode throughout.
 *
 * Detecting it is better than either silently failing or dropping PDF
 * support: for the Latin text that is most of what gets exported, a real
 * searchable text layer is worth far more than a screenshot.
 */
export function hasUnsupportedPdfText(text: string): boolean {
  // Latin-1 plus Latin Extended-A/B, general punctuation and the euro sign.
  // The range starts at U+0000, not at a space, so ordinary whitespace
  // (newline, tab) is INSIDE the supported set -- starting it at " " would
  // classify every multi-line answer as unrenderable.
  return /[^\u0000-\u024F\u2010-\u203A\u20AC]/.test(text);
}

export type FormatAvailability = {
  format: FileFormat;
  label: string;
  available: boolean;
  /** Why it is unavailable, shown rather than leaving a dead control. */
  reason?: string;
};

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

  const writeLines = (
    text: string,
    options: { size: number; style?: "normal" | "bold" | "italic"; font?: string; indent?: number },
  ) => {
    doc.setFont(options.font ?? "helvetica", options.style ?? "normal");
    doc.setFontSize(options.size);
    const indent = options.indent ?? 0;
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
          const wrapped = cells.map((cell) => doc.splitTextToSize(cell, columnWidth - 8) as string[]);
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
