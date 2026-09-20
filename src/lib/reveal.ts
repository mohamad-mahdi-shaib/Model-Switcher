/**
 * Presentation pacing for a streaming answer.
 *
 * The canonical message content is never touched by anything in here. These
 * functions only decide *how much of it is on screen yet*, and tag the parsed
 * AST so the renderer can fade in each newly revealed run. Persistence,
 * conversation context and Copy all read the canonical content, so a paced
 * reveal can never truncate what is saved or what is sent to the provider.
 *
 * Positions come in two units, deliberately kept apart:
 *   - a SOURCE index into the raw Markdown, used to slice what gets parsed;
 *   - a TEXT index into the concatenated text of the parsed AST, used to cut
 *     runs. Markdown syntax characters are consumed by the parser, so the two
 *     do not line up and must not be mixed.
 */

import type { BlockNode, InlineNode } from "@/lib/markdown";

export type TextRun = { text: string; group: number };

/** Words released per tick, and the gap between ticks, for a given backlog. */
export function pace(pending: number): { words: number; interval: number } {
  // A long answer must not sit behind an artificial queue. The step widens
  // with the backlog so a burst drains quickly while a slow trickle still
  // reads word by word.
  if (pending > 600) return { words: 28, interval: 28 };
  if (pending > 260) return { words: 12, interval: 42 };
  if (pending > 110) return { words: 6, interval: 58 };
  return { words: 3, interval: 75 };
}

/** True when an odd number of ``` fences opened before `index`. */
function insideFence(content: string, index: number): boolean {
  const opened = content.slice(0, index).match(/^[ \t]*```/gm);
  return (opened?.length ?? 0) % 2 === 1;
}

/**
 * Highest source index that is safe to reveal while more may still arrive.
 *
 * A provider chunk can split a word ("refac" + "toring"), so the trailing run
 * of non-whitespace is withheld until whitespace proves it finished. Nothing
 * is dropped -- it is only deferred to a later tick, or to the final flush.
 */
export function lastSafeIndex(content: string): number {
  for (let i = content.length - 1; i >= 0; i -= 1) {
    if (/\s/.test(content[i])) return i + 1;
  }
  return 0;
}

/**
 * How far back an unterminated inline construct may be before it is treated as
 * literal punctuation rather than half-arrived Markdown. Without this a stray
 * "[" in prose would stall the reveal until the stream ended.
 */
const INLINE_LOOKBACK = 120;

/**
 * Start of an unterminated inline construct at `end`, or null.
 *
 * Revealing half of `[label](href)` shows the raw syntax, which then collapses
 * to just the label when the rest arrives -- the displayed text rewrites, and
 * words that were already on screen visibly change. Stopping before such a
 * construct means it appears complete, in one group, or not at all.
 */
function openInlineAt(content: string, end: number): number | null {
  const lineStart = content.lastIndexOf("\n", end - 1) + 1;
  const line = content.slice(lineStart, end);
  let candidate: number | null = null;
  const mark = (idx: number) => {
    if (idx >= 0 && (candidate === null || idx < candidate)) candidate = idx;
  };

  // Inline code: an odd number of backticks leaves one open.
  const ticks: number[] = [];
  for (let i = 0; i < line.length; i += 1) if (line[i] === "`") ticks.push(i);
  if (ticks.length % 2 === 1) mark(ticks[ticks.length - 1]);

  // Link: a "[" whose full [label](href) has not arrived yet.
  const bracket = line.lastIndexOf("[");
  if (bracket !== -1 && !/^\[[^\]\n]*\]\([^)\s]*\)/.test(line.slice(bracket))) {
    mark(bracket);
  }

  // Emphasis: asterisk runs pair up; a leftover run is still open.
  let open: number | null = null;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] !== "*") continue;
    const start = i;
    while (i + 1 < line.length && line[i + 1] === "*") i += 1;
    open = open === null ? start : null;
  }
  if (open !== null) mark(open);

  if (candidate === null) return null;
  const abs = lineStart + candidate;
  return end - abs > INLINE_LOOKBACK ? null : abs;
}

/**
 * Next source offset to reveal: `words` more complete words after `from`.
 *
 * Inside a fenced code block the result snaps back to a line start, so code
 * arrives a line at a time rather than a few characters at a time. Half-formed
 * inline syntax is held back for the same reason.
 */
export function nextBoundary(
  content: string,
  from: number,
  words: number,
  complete: boolean,
): number {
  if (from >= content.length) return content.length;
  const limit = complete ? content.length : lastSafeIndex(content);
  if (from >= limit) return from;

  let i = from;
  let taken = 0;
  while (i < limit && taken < words) {
    while (i < limit && /\s/.test(content[i])) i += 1;
    if (i >= limit) break;
    while (i < limit && !/\s/.test(content[i])) i += 1;
    taken += 1;
  }
  // Carry the trailing whitespace into this group so the next group starts on
  // a word; the slice stays contiguous either way, so spacing is preserved.
  while (i < limit && /\s/.test(content[i]) && content[i] !== "\n") i += 1;
  if (i < limit && content[i] === "\n") i += 1;

  if (!complete && insideFence(content, i)) {
    const lastNewline = content.lastIndexOf("\n", i - 1);
    i = lastNewline >= from ? lastNewline + 1 : from;
  }

  // Hold back a construct that has only half arrived. On completion there is
  // nothing more coming, so the text is released as it stands.
  if (!complete) {
    const open = openInlineAt(content, i);
    if (open !== null && open > from) i = open;
  }
  return Math.max(i, from);
}

/* ------------------------------------------------------------------ tagging */

function inlineLength(nodes: InlineNode[]): number {
  let n = 0;
  for (const node of nodes) {
    if (node.type === "text" || node.type === "code") n += node.value.length;
    else n += inlineLength(node.children);
  }
  return n;
}

/** Total text characters the AST will render, in document order. */
export function textLength(blocks: BlockNode[]): number {
  let n = 0;
  for (const block of blocks) {
    switch (block.type) {
      case "paragraph":
      case "heading":
      case "quote":
        n += inlineLength(block.children);
        break;
      case "code":
        n += block.value.length;
        break;
      case "list":
        for (const item of block.items) n += inlineLength(item);
        break;
      case "hr":
        break;
    }
  }
  return n;
}

/** Number of cuts at or before `at` -- i.e. which group that character is in. */
function groupAt(at: number, cuts: readonly number[]): number {
  let lo = 0;
  let hi = cuts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cuts[mid] <= at) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Split one value into runs at the cut positions crossing it.
 *
 * A run's group index is derived from its absolute start, so a run keeps the
 * same group -- and therefore the same React key -- on every later render.
 * That is what stops already-revealed words from re-animating when the next
 * chunk lands.
 */
export function splitRuns(
  value: string,
  start: number,
  cuts: readonly number[],
): TextRun[] {
  const runs: TextRun[] = [];
  let local = 0;
  while (local < value.length) {
    const at = start + local;
    const group = groupAt(at, cuts);
    const nextCut = group < cuts.length ? cuts[group] : Infinity;
    const take = Math.min(value.length - local, nextCut - at);
    runs.push({ text: value.slice(local, local + take), group });
    local += take;
  }
  return runs;
}

/**
 * Walk the AST in document order, attaching `runs` to every text-bearing node.
 * Returns new nodes; the input is not mutated.
 */
export function tagRuns(blocks: BlockNode[], cuts: readonly number[]): BlockNode[] {
  let pos = 0;

  const inline = (nodes: InlineNode[]): InlineNode[] =>
    nodes.map((node) => {
      if (node.type === "text") {
        const runs = splitRuns(node.value, pos, cuts);
        pos += node.value.length;
        return { ...node, runs };
      }
      if (node.type === "code") {
        const group = groupAt(pos, cuts);
        pos += node.value.length;
        return { ...node, group };
      }
      return { ...node, children: inline(node.children) };
    });

  return blocks.map((block) => {
    switch (block.type) {
      case "paragraph":
      case "heading":
      case "quote":
        return { ...block, children: inline(block.children) };
      case "code": {
        const runs = splitRuns(block.value, pos, cuts);
        pos += block.value.length;
        return { ...block, runs };
      }
      case "list":
        return { ...block, items: block.items.map((item) => inline(item)) };
      case "hr":
        return block;
    }
  });
}
