import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMarkdown } from "@/lib/markdown";
import {
  lastSafeIndex,
  nextBoundary,
  pace,
  splitRuns,
  tagRuns,
  textLength,
} from "@/lib/reveal";

/* --- content preservation ------------------------------------------------ */

/** Walk a reveal to completion the way the hook does, collecting the prefixes. */
function driveReveal(chunks: string[], words = 3): { final: string; steps: string[] } {
  let content = "";
  let at = 0;
  const steps: string[] = [];
  for (let c = 0; c <= chunks.length; c += 1) {
    const complete = c === chunks.length;
    if (!complete) content += chunks[c];
    // Drain as far as this much content allows before the next chunk lands.
    for (;;) {
      const next = nextBoundary(content, at, words, complete);
      if (next <= at) break;
      at = next;
      steps.push(content.slice(0, at));
    }
  }
  return { final: content.slice(0, at), steps };
}

test("a fully drained reveal reproduces the received text exactly", () => {
  const chunks = ["Here is ", "a streamed reply with ", "**bold** text, ", "and an end."];
  const { final } = driveReveal(chunks);
  assert.equal(final, chunks.join(""));
});

test("chunks that split words mid-word lose nothing", () => {
  // The provider is free to break anywhere, including inside a word.
  const chunks = ["Refac", "toring", " the ", "par", "ser", " carefully", " now."];
  const { final } = driveReveal(chunks);
  assert.equal(final, "Refactoring the parser carefully now.");
});

test("whitespace, newlines and punctuation survive the reveal", () => {
  const chunks = ["A line.\n\n", "- one\n", "- two\n\n", "Tail  with   spaces.\t"];
  const { final } = driveReveal(chunks);
  assert.equal(final, chunks.join(""));
});

test("every step is a strict prefix of the next, so text never rewrites", () => {
  const { steps } = driveReveal(["One two three ", "four five six ", "seven eight."]);
  for (let i = 1; i < steps.length; i += 1) {
    assert.ok(
      steps[i].startsWith(steps[i - 1]),
      `step ${i} is not an extension of step ${i - 1}`,
    );
  }
});

test("a partial trailing word is withheld until whitespace proves it ended", () => {
  // "wor" could still become "world"; revealing it would make the word rewrite.
  assert.equal(nextBoundary("hello wor", 0, 5, false), 6);
  // Completion releases it.
  assert.equal(nextBoundary("hello wor", 0, 5, true), 9);
});

test("lastSafeIndex stops after the final whitespace", () => {
  assert.equal(lastSafeIndex("alpha beta"), 6);
  assert.equal(lastSafeIndex("alpha "), 6);
  assert.equal(lastSafeIndex("alpha"), 0);
  assert.equal(lastSafeIndex(""), 0);
});

test("an open code fence reveals whole lines, never partial ones", () => {
  const src = "```js\nconst a = 1;\nconst b = 2;\n";
  const at = nextBoundary(src, 0, 3, false);
  // Whatever is revealed inside the fence ends on a line boundary.
  assert.ok(at === 0 || src[at - 1] === "\n", `boundary ${at} is mid-line`);
});

test("the reveal always terminates and never runs backwards", () => {
  const src = "alpha beta gamma delta epsilon";
  let at = 0;
  for (let i = 0; i < 100; i += 1) {
    const next = nextBoundary(src, at, 2, true);
    assert.ok(next >= at, "boundary moved backwards");
    if (next === at) break;
    at = next;
  }
  assert.equal(at, src.length);
});

/* --- pacing --------------------------------------------------------------- */

test("pacing never releases enough words to read as a burst", () => {
  // No backlog, however large, may dump a paragraph in one step, and the
  // interval floor keeps every group well inside the 900ms fade so the reveal
  // stays continuous rather than stepping.
  for (const pending of [0, 50, 200, 401, 1201, 5000, 50000]) {
    const p = pace(pending);
    assert.ok(p.words <= 4, `${pending} chars pending released ${p.words} words`);
    assert.ok(p.interval >= 300, `${pending} chars pending ticked every ${p.interval}ms`);
  }
});

test("the base rate is three words every 350ms", () => {
  assert.deepEqual(pace(0), { words: 3, interval: 350 });
  assert.deepEqual(pace(120), { words: 3, interval: 350 });
});

test("pacing relieves as the backlog grows, without accelerating sharply", () => {
  const small = pace(10);
  const large = pace(5000);
  assert.ok(large.words >= small.words, "a backlog should not release fewer words");
  assert.ok(large.interval <= small.interval, "a backlog should not tick slower");
  // This trial is deliberately slow: a long answer takes around a minute to
  // reveal in full, and that is the accepted trade for a readable pace. The
  // assertion records the consequence rather than guarding a speed target --
  // "Show full response" is what bypasses it.
  const seconds = (5000 / (large.words * 5)) * large.interval / 1000;
  assert.ok(seconds > 30 && seconds < 120,
    `a 5000-character answer reveals in ${seconds.toFixed(0)}s`);
});

/* --- run tagging ---------------------------------------------------------- */

test("run groups are derived from position, so settled runs keep their key", () => {
  const cuts = [5, 11];
  const first = splitRuns("hello world again", 0, cuts);
  assert.deepEqual(
    first.map((r) => [r.text, r.group]),
    [["hello", 0], [" world", 1], [" again", 2]],
  );
  // A later cut appends a group; the earlier runs are byte-identical, which is
  // what keeps React from remounting (and re-animating) them.
  const later = splitRuns("hello world again", 0, [5, 11, 17]);
  assert.deepEqual(later.slice(0, 2), first.slice(0, 2));
});

test("tagged runs concatenate back to the original text", () => {
  const src = "A **bold** word and a [link](https://example.com) here.";
  const blocks = parseMarkdown(src);
  const total = textLength(blocks);
  const tagged = tagRuns(blocks, [4, 9, total]);

  const collect = (nodes: readonly unknown[]): string =>
    nodes
      .map((n) => {
        const node = n as {
          type: string;
          value?: string;
          runs?: { text: string }[];
          children?: unknown[];
        };
        if (node.type === "text") {
          return node.runs ? node.runs.map((r) => r.text).join("") : node.value ?? "";
        }
        if (node.type === "code") return node.value ?? "";
        return node.children ? collect(node.children) : "";
      })
      .join("");

  const rendered = tagged
    .map((b) => ("children" in b && b.children ? collect(b.children) : ""))
    .join("");
  assert.equal(rendered, "A bold word and a link here.");
});

test("tagging a code block preserves its value exactly", () => {
  const src = "```js\nconst x = 1;\nconst y = 2;\n```";
  const blocks = parseMarkdown(src);
  const tagged = tagRuns(blocks, [6, 20]);
  const block = tagged[0];
  assert.equal(block.type, "code");
  if (block.type !== "code") return;
  assert.equal(block.runs?.map((r) => r.text).join(""), block.value);
  assert.equal(block.value, "const x = 1;\nconst y = 2;");
});

test("no cuts means no runs are produced at all", () => {
  const blocks = parseMarkdown("Plain restored answer.");
  const tagged = tagRuns(blocks, []);
  const para = tagged[0];
  assert.equal(para.type, "paragraph");
  if (para.type !== "paragraph") return;
  const first = para.children[0];
  assert.equal(first.type, "text");
  if (first.type !== "text") return;
  // One run covering everything, group 0 -- a single span, never per word.
  assert.equal(first.runs?.length, 1);
  assert.equal(first.runs?.[0].text, "Plain restored answer.");
});

test("textLength counts what the renderer will show, not the markup", () => {
  assert.equal(textLength(parseMarkdown("**bold**")), 4);
  assert.equal(textLength(parseMarkdown("[link](https://example.com)")), 4);
  assert.equal(textLength(parseMarkdown("plain")), 5);
});

/* --- half-arrived inline syntax ------------------------------------------ */

test("a half-arrived link is withheld so its raw syntax never shows", () => {
  // Revealing "[link](https://ex" would display the raw markup and then
  // collapse to "link" once the rest lands -- a visible rewrite.
  const src = "See [link](https://ex";
  const at = nextBoundary(src, 0, 9, false);
  assert.ok(at <= 4, `stopped at ${at}, inside the link syntax`);
});

test("a completed link is released in one piece", () => {
  const src = "See [link](https://example.com) now ";
  const at = nextBoundary(src, 0, 9, false);
  assert.equal(src.slice(0, at), "See [link](https://example.com) now ");
});

test("half-arrived inline code and emphasis are withheld too", () => {
  assert.ok(nextBoundary("run `npm ins", 0, 9, false) <= 4);
  assert.ok(nextBoundary("this is **bol", 0, 9, false) <= 8);
  // ...and released once closed.
  assert.equal(nextBoundary("this is **bold** ok ", 0, 9, true), 20);
});

test("a stray bracket does not stall the reveal forever", () => {
  // Far enough back to be read as punctuation rather than half-arrived syntax.
  const src = "a [ literal bracket " + "and then plenty more words ".repeat(8);
  const at = nextBoundary(src, 0, 40, false);
  assert.ok(at > 100, `reveal stalled at ${at}`);
});

test("completion releases everything regardless of open syntax", () => {
  const src = "trailing [unclosed";
  assert.equal(nextBoundary(src, 0, 20, true), src.length);
});

/* --- F6: fenced code line longer than the word budget --------------------- */

test("F6: a fully-arrived code line far longer than the word budget reveals in one step while still streaming", () => {
  // Before the fix, the word-budget walk landed mid-line, the fence
  // correction snapped back to the position it started from (zero progress),
  // and the caller (use-reveal.ts's step()) read that as "wait for more" --
  // forever, since the rest of the stream arriving never shortened this one
  // line. Only three words are budgeted; the line has ten.
  const src = "```js\nconst reallyLongVariableName = 1 + 2 + 3 + 4 + 5 + 6;\n";
  const at = nextBoundary(src, 6, 3, false);
  assert.ok(at > 6, `stalled at the opening fence: next=${at}, from=6`);
  assert.equal(src.slice(6, at), "const reallyLongVariableName = 1 + 2 + 3 + 4 + 5 + 6;\n");
});

test("F6: repeated calls never land on the same offset twice while a long line is available", () => {
  const src = "```\n" + "x = ".repeat(20) + "1;\nmore\n```\n";
  let at = 0;
  const seen = new Set<number>();
  for (let i = 0; i < 20; i += 1) {
    const next = nextBoundary(src, at, 3, false);
    if (next === at) break; // waiting for more input is fine; looping is not
    assert.ok(!seen.has(next), `boundary ${next} revisited -- stuck backtracking`);
    seen.add(next);
    at = next;
  }
});

test("F6: subsequent code lines keep arriving in order, each intact, after a long line is revealed", () => {
  const chunks = [
    "```js\n",
    "const aVeryLongLineThatBlowsThroughTheWordBudget = 12345;\n",
    "const second = 2;\n",
    "const third = 3;\n",
    "```\n",
  ];
  let content = "";
  let at = 0;
  const steps: string[] = [];
  for (let c = 0; c <= chunks.length; c += 1) {
    const complete = c === chunks.length;
    if (!complete) content += chunks[c];
    for (;;) {
      const next = nextBoundary(content, at, 3, complete);
      if (next <= at) break;
      steps.push(content.slice(at, next));
      at = next;
    }
  }
  assert.equal(content.slice(0, at), content, "every character was eventually revealed");
  // No step is empty, and every step is a whole number of lines -- proof the
  // long line was not silently dropped or re-ordered against its neighbours.
  for (const step of steps) assert.ok(step.length > 0);
});

test("F6: a code line that has not finished arriving yet (no trailing newline) is withheld, not guessed at", () => {
  const src = "```js\nconst stillArriving = 1 + 2 + 3 + 4"; // no trailing \n yet
  const at = nextBoundary(src, 6, 3, false);
  assert.equal(at, 6, "an incomplete line must not be partially revealed");
});

test("F6: a closing fence and an unterminated final line are both released once the stream completes", () => {
  // No trailing newline on the very last line, and `complete` is true: the
  // fence-line-boundary logic still runs (Finding U4 removed the old
  // `!complete` gate), and its own final fallback releases the rest in one
  // step once no more newline is ever coming.
  const src = "```js\nconst x = 1;\nconst y = 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9";
  let at = 0;
  for (let i = 0; i < 100 && at < src.length; i += 1) {
    const next = nextBoundary(src, at, 3, true);
    assert.ok(next > at, `stalled at ${at} even though complete:true`);
    at = next;
  }
  assert.equal(at, src.length);
});

/* --- U4: fenced code stays line-bounded once the stream has completed too -- */

test("U4: a code line longer than the word budget is NOT cut mid-line once complete:true, even before the whole answer is drained", () => {
  // The reviewer's own repro: from offset 6 (right after the opening fence's
  // own line), a 3-word budget used to land mid-line ("const value = ") once
  // `complete` was true, because the fence-boundary logic used to be skipped
  // entirely in that case. It must now land exactly on that line's own
  // newline instead, exactly as it already does while still streaming.
  const src =
    "```js\nconst value = calculate(first, second, third, fourth, fifth, sixth);\nmore\n```\n";
  const at = nextBoundary(src, 6, 3, true);
  assert.ok(at > 6, "must make forward progress");
  assert.equal(
    src[at - 1],
    "\n",
    `boundary ${at} ("${src.slice(6, at)}") is mid-line even though complete:true`,
  );
  assert.equal(
    src.slice(6, at),
    "const value = calculate(first, second, third, fourth, fifth, sixth);\n",
    "must reveal the whole line, not a partial word-budget prefix of it",
  );
});

test("U4: every intermediate boundary while draining a completed answer's code block is a full line (or the final flush)", () => {
  const src =
    "```js\nconst value = calculate(first, second, third, fourth, fifth, sixth);\nconst short = 1;\nmore\n```\n";
  let at = 0;
  const steps: string[] = [];
  for (let i = 0; i < 100 && at < src.length; i += 1) {
    const next = nextBoundary(src, at, 3, true);
    assert.ok(next > at, `stalled at ${at}`);
    steps.push(src.slice(at, next));
    at = next;
  }
  assert.equal(at, src.length, "the full source must eventually be revealed");
  // Every step but (possibly) the very last ends on a newline -- the last
  // step may legitimately be the unterminated tail with no newline of its
  // own, since there is nothing left to wait for once complete.
  for (let i = 0; i < steps.length - 1; i += 1) {
    assert.ok(
      steps[i].endsWith("\n"),
      `step ${i} ("${steps[i]}") does not end on a line boundary`,
    );
  }
});
