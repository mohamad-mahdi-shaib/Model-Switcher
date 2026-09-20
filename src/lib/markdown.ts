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
