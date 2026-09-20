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
  // The property that matters after the 28-words/28ms tier was removed: no
  // backlog, however large, may dump a paragraph in one step. Six words is the
  // widest step, so every tick still reads as words appearing.
  for (const pending of [0, 50, 200, 401, 1201, 5000, 50000]) {
    const p = pace(pending);
    assert.ok(p.words <= 6, `${pending} chars pending released ${p.words} words`);
    assert.ok(p.interval >= 120, `${pending} chars pending ticked every ${p.interval}ms`);
  }
});

test("pacing relieves as the backlog grows, without accelerating sharply", () => {
  const small = pace(10);
  const large = pace(5000);
  assert.ok(large.words >= small.words, "a backlog should not release fewer words");
  assert.ok(large.interval <= small.interval, "a backlog should not tick slower");
  // Deliberately slower than the previous build: this trial trades drain speed
  // for a readable reveal, and "Show full response" is the escape hatch for
  // anyone who does not want to wait. The bound here only guards against a
  // regression into minutes.
  const seconds = (5000 / (large.words * 5)) * large.interval / 1000;
  assert.ok(seconds < 30, `a 5000-character answer would take ${seconds.toFixed(1)}s`);
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
