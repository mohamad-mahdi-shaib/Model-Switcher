import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMarkdown } from "@/lib/markdown";

/** Safety and streaming-stability of the Markdown parser. */

test("renders headings, lists, quotes and inline code", () => {
  const blocks = parseMarkdown(
    "# Title\n\nSome `code` here.\n\n- one\n- two\n\n> quoted\n",
  );
  const kinds = blocks.map((b) => b.type);
  assert.deepEqual(kinds, ["heading", "paragraph", "list", "quote"]);
  assert.equal(blocks[2].type === "list" && blocks[2].items.length, 2);
});

test("ordered lists keep their start number", () => {
  const [list] = parseMarkdown("3. third\n4. fourth");
  assert.equal(list.type, "list");
  if (list.type === "list") {
    assert.equal(list.ordered, true);
    assert.equal(list.start, 3);
  }
});

test("javascript: and data: links are stripped but their text survives", () => {
  for (const scheme of [
    "[click](javascript:alert(1))",
    "[click](data:text/html;base64,PHN2Zz4=)",
    "[click](vbscript:msgbox)",
  ]) {
    const [para] = parseMarkdown(scheme);
    assert.equal(para.type, "paragraph");
    if (para.type === "paragraph") {
      const hasLink = para.children.some((c) => c.type === "link");
      assert.equal(hasLink, false, `${scheme} must not become a link`);
      const text = para.children.map((c) => (c.type === "text" ? c.value : "")).join("");
      assert.match(text, /click/);
    }
  }
});

test("http, https and mailto links are allowed", () => {
  for (const href of ["https://example.com", "http://example.com", "mailto:a@b.co"]) {
    const [para] = parseMarkdown(`[x](${href})`);
    assert.equal(para.type, "paragraph");
    if (para.type === "paragraph") {
      assert.equal(para.children[0].type, "link");
    }
  }
});

test("an unterminated fence renders as an OPEN code block, not literal text", () => {
  const [block] = parseMarkdown("```ts\nconst a = 1;\nconst b = 2;");
  assert.equal(block.type, "code");
  if (block.type === "code") {
    assert.equal(block.open, true);
    assert.equal(block.lang, "ts");
    assert.match(block.value, /const a = 1;/);
  }
});

test("a closed fence is not marked open", () => {
  const [block] = parseMarkdown("```js\nx\n```");
  assert.equal(block.type, "code");
  if (block.type === "code") assert.equal(block.open, false);
});

test("streaming a fence character by character never throws and stays a block", () => {
  const full = "Here:\n\n```py\nprint('hi')\n```\n\nDone.";
  for (let i = 1; i <= full.length; i++) {
    const partial = full.slice(0, i);
    assert.doesNotThrow(() => parseMarkdown(partial), `failed at ${i} chars`);
  }
  // Once the fence opens, it must stay a code block through every later prefix.
  const openAt = full.indexOf("```py") + 5;
  for (let i = openAt; i < full.indexOf("```\n\nDone"); i++) {
    const blocks = parseMarkdown(full.slice(0, i));
    assert.ok(
      blocks.some((b) => b.type === "code"),
      `no code block at ${i} chars`,
    );
  }
});

test("plain text with no markup still renders as a paragraph", () => {
  const [block] = parseMarkdown("just a sentence");
  assert.equal(block.type, "paragraph");
});

test("html in model output is never treated as markup", () => {
  const [para] = parseMarkdown("<script>alert(1)</script>");
  assert.equal(para.type, "paragraph");
  if (para.type === "paragraph") {
    // It survives as literal text; the renderer emits it via React, escaped.
    const text = para.children.map((c) => (c.type === "text" ? c.value : "")).join("");
    assert.match(text, /<script>/);
  }
});
