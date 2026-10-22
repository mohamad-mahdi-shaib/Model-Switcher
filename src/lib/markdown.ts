/**
 * Minimal, streaming-safe Markdown parser.
 *
 * Produces a typed AST that the renderer turns into React elements. It never
 * produces an HTML string, so `dangerouslySetInnerHTML` is not needed anywhere
 * and model output cannot inject markup by construction.
 *
 * Why hand-rolled rather than react-markdown: the subset required here is
 * small and fixed, the parser must tolerate half-arrived syntax on every
 * keystroke of a stream, and the install would have pulled ~30 transitive
 * packages over a heavily throttled connection. See docs/design-decisions.md.
 *
 * Streaming rule: an unterminated fence is rendered as an OPEN code block
 * rather than as literal backticks, so a block does not flicker between
 * paragraph and code as tokens land.
 */

import type { TextRun } from "@/lib/reveal";

/**
 * `runs` / `group` are attached after parsing by `tagRuns` in reveal.ts, to
 * mark which reveal step each stretch of text belongs to. The parser never
 * sets them and nothing here depends on them, so parsing stays independent of
 * presentation pacing.
 */
export type InlineNode =
  | { type: "text"; value: string; runs?: TextRun[] }
  | { type: "code"; value: string; group?: number }
  | { type: "strong"; children: InlineNode[] }
  | { type: "em"; children: InlineNode[] }
  | { type: "link"; href: string; children: InlineNode[] };

export type BlockNode =
  | { type: "paragraph"; children: InlineNode[] }
  | { type: "heading"; level: 1 | 2 | 3 | 4; children: InlineNode[] }
  | {
      type: "code";
      lang: string | null;
      value: string;
      open: boolean;
      runs?: TextRun[];
    }
  | { type: "list"; ordered: boolean; start: number; items: InlineNode[][] }
  /**
   * Project 4: a GitHub-style pipe table.
   *
   * Added because a table is the one answer shape this app could render
   * only as mangled prose -- and the shape most worth exporting: "compare
   * these two contracts" or "summarise this spreadsheet" produces a table,
   * and a table is what a user then wants in Excel or Word. Parsing it into
   * real cells is what lets `file-generation.ts` write real cells rather
   * than a wall of pipes.
   *
   * `align` follows the separator row (:---, :---:, ---:) and is null where
   * the row did not specify one.
   */
  | {
      type: "table";
      header: InlineNode[][];
      rows: InlineNode[][][];
      align: ("left" | "center" | "right" | null)[];
    }
  | { type: "quote"; children: InlineNode[] }
  | { type: "hr" };

/** Only these schemes may become a clickable link. */
function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (!href) return null;
  if (/^(https?:|mailto:)/i.test(href)) return href;
  if (href.startsWith("/") || href.startsWith("#")) return href;
  return null; // javascript:, data:, vbscript:, etc.
}

function parseInline(input: string): InlineNode[] {
  const out: InlineNode[] = [];
  let buf = "";
  let i = 0;

  const flush = () => {
    if (buf) {
      out.push({ type: "text", value: buf });
      buf = "";
    }
  };

  while (i < input.length) {
    const rest = input.slice(i);

    // `inline code` — highest precedence, contents never re-parsed.
    const code = /^`([^`\n]+)`/.exec(rest);
    if (code) {
      flush();
      out.push({ type: "code", value: code[1] });
      i += code[0].length;
      continue;
    }

    // [label](href)
    const link = /^\[([^\]\n]*)\]\(([^)\s]*)\)/.exec(rest);
    if (link) {
      const href = safeHref(link[2]);
      flush();
      if (href) {
        out.push({ type: "link", href, children: parseInline(link[1]) });
      } else {
        // Unsafe scheme: keep the text, drop the link.
        out.push(...parseInline(link[1]));
      }
      i += link[0].length;
      continue;
    }

    const strong = /^\*\*([^\n]+?)\*\*/.exec(rest);
    if (strong) {
      flush();
      out.push({ type: "strong", children: parseInline(strong[1]) });
      i += strong[0].length;
      continue;
    }

    const em = /^(?<!\*)\*([^*\n]+?)\*(?!\*)/.exec(rest);
    if (em) {
      flush();
      out.push({ type: "em", children: parseInline(em[1]) });
      i += em[0].length;
      continue;
    }

    buf += input[i];
    i += 1;
  }

  flush();
  return out;
}

/** Splits one pipe row into raw cell strings, tolerating optional outer pipes. */
function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  // A pipe inside inline code or escaped with a backslash is content, not a
  // delimiter -- splitting naively would cut a cell in half.
  const cells: string[] = [];
  let buffer = "";
  let inCode = false;
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === "\\" && trimmed[index + 1] === "|") {
      buffer += "|";
      index += 1;
      continue;
    }
    if (char === "`") inCode = !inCode;
    if (char === "|" && !inCode) {
      cells.push(buffer.trim());
      buffer = "";
      continue;
    }
    buffer += char;
  }
  cells.push(buffer.trim());
  return cells;
}

/** `| --- | :---: |` and friends. */
function isSeparatorRow(line: string): boolean {
  if (!line.includes("-") || !line.includes("|")) return false;
  return splitRow(line).every((cell) => /^:?-{1,}:?$/.test(cell.trim()));
}

function parseAlignment(line: string, columns: number): ("left" | "center" | "right" | null)[] {
  const cells = splitRow(line);
  const align: ("left" | "center" | "right" | null)[] = [];
  for (let index = 0; index < columns; index += 1) {
    const cell = (cells[index] ?? "").trim();
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    align.push(left && right ? "center" : right ? "right" : left ? "left" : null);
  }
  return align;
}

export function parseMarkdown(src: string): BlockNode[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: BlockNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Fenced code, possibly still arriving.
    const fence = /^\s*```([\w+-]*)\s*$/.exec(line);
    if (fence) {
      const lang = fence[1] || null;
      const body: string[] = [];
      i += 1;
      let closed = false;
      while (i < lines.length) {
        if (/^\s*```\s*$/.test(lines[i])) {
          closed = true;
          i += 1;
          break;
        }
        body.push(lines[i]);
        i += 1;
      }
      blocks.push({
        type: "code",
        lang,
        value: body.join("\n"),
        open: !closed,
      });
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3 | 4,
        children: parseInline(heading[2]),
      });
      i += 1;
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      blocks.push({ type: "hr" });
      i += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const parts: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        parts.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      blocks.push({ type: "quote", children: parseInline(parts.join(" ")) });
      continue;
    }

    /**
     * A table needs a header row AND a separator row to be a table at all.
     * Requiring both is what keeps an ordinary sentence containing a pipe
     * ("a | b") from being swallowed as a one-column table -- and, during
     * streaming, a half-arrived table stays a paragraph until its separator
     * line lands, rather than flickering through a bogus shape.
     */
    if (line.includes("|") && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      const header = splitRow(line);
      const align = parseAlignment(lines[i + 1], header.length);
      i += 2;
      const rows: InlineNode[][][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
        const cells = splitRow(lines[i]).map(parseInline);
        // Ragged rows are padded rather than dropped: a model that emits a
        // short row has still said something, and losing it silently would
        // be worse than an empty cell.
        while (cells.length < header.length) cells.push([]);
        rows.push(cells.slice(0, header.length));
        i += 1;
      }
      blocks.push({ type: "table", header: header.map(parseInline), align, rows });
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ordered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    if (bullet || ordered) {
      const isOrdered = Boolean(ordered);
      const start = ordered ? Number(ordered[1]) : 1;
      const items: InlineNode[][] = [];
      while (i < lines.length) {
        const b = /^\s*[-*+]\s+(.*)$/.exec(lines[i]);
        const o = /^\s*(\d+)[.)]\s+(.*)$/.exec(lines[i]);
        if (isOrdered && o) items.push(parseInline(o[2]));
        else if (!isOrdered && b) items.push(parseInline(b[1]));
        else if (lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && items.length) {
          // Continuation line of the previous item.
          items[items.length - 1].push({ type: "text", value: ` ${lines[i].trim()}` });
        } else break;
        i += 1;
      }
      blocks.push({ type: "list", ordered: isOrdered, start, items });
      continue;
    }

    // Paragraph: consume until a blank line or the start of another block.
    const para: string[] = [];
    while (i < lines.length && lines[i].trim()) {
      if (
        /^\s*```/.test(lines[i]) ||
        /^#{1,4}\s/.test(lines[i]) ||
        /^\s*>/.test(lines[i]) ||
        /^\s*[-*+]\s+/.test(lines[i]) ||
        /^\s*\d+[.)]\s+/.test(lines[i])
      ) {
        if (para.length) break;
      }
      para.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: "paragraph", children: parseInline(para.join(" ")) });
  }

  return blocks;
}
