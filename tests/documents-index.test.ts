import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkSections, similarity } from "@/server/documents/embed";
import { isValidDocumentId, newDocumentId } from "@/server/documents/store";
import type { DocumentSection } from "@/lib/documents";

/**
 * Project 4: chunking, retrieval math and the document-id capability.
 *
 * Nothing here contacts a provider. Embedding and storage calls are covered
 * by the route tests (`documents-route.test.ts`) up to the point where they
 * would leave the process, and by live verification afterwards — these are
 * the parts that are decidable locally.
 */

const section = (ref: string, text: string, extra: Partial<DocumentSection> = {}): DocumentSection => ({
  ref,
  text,
  ...extra,
});

/* ----------------------------------------------------------- chunking --- */

test("a section within the size budget passes through as one chunk", () => {
  const chunks = chunkSections([section("p. 1", "x".repeat(1_000))]);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].ref, "p. 1");
});

test("an oversized section is split, and EVERY piece keeps the citation", () => {
  const paragraphs = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} ` + "y".repeat(500)).join("\n\n");
  const chunks = chunkSections([section("p. 7", paragraphs)]);
  assert.ok(chunks.length > 1, "a 15k-character section must split");
  for (const chunk of chunks) {
    assert.equal(chunk.ref, "p. 7", "a split piece must remain citable to its page");
    assert.ok(chunk.text.length <= 6_000, `chunk too large: ${chunk.text.length}`);
  }
});

test("a single paragraph longer than the cap is hard-split rather than dropped", () => {
  const monster = "z".repeat(20_000);
  const chunks = chunkSections([section("lines 1-1", monster)]);
  assert.ok(chunks.length >= 4);
  const total = chunks.reduce((sum, c) => sum + c.text.length, 0);
  assert.ok(total >= 19_000, "content must not be silently lost when hard-splitting");
});

test("short sections merge ONLY when they share a citation", () => {
  const chunks = chunkSections([
    section("p. 1", "tiny a"),
    section("p. 1", "tiny b"),
    section("p. 2", "tiny c"),
  ]);
  // p.1's two fragments may merge; p.2 must never be folded in with them.
  const pageOne = chunks.filter((c) => c.ref === "p. 1");
  const pageTwo = chunks.filter((c) => c.ref === "p. 2");
  assert.ok(pageTwo.length >= 1, "page 2 must survive as its own chunk");
  for (const chunk of pageOne) {
    assert.doesNotMatch(chunk.text, /tiny c/, "page 2 content must never appear under a page 1 citation");
  }
});

test("chunking preserves all content across a realistic mixed document", () => {
  const sections = [
    section("p. 1", "Alpha ".repeat(200)),
    section("p. 2", "Beta ".repeat(50)),
    section("p. 3", "Gamma ".repeat(1500)),
  ];
  const chunks = chunkSections(sections);
  const joined = chunks.map((c) => c.text).join(" ");
  assert.match(joined, /Alpha/);
  assert.match(joined, /Beta/);
  assert.match(joined, /Gamma/);
  assert.ok(new Set(chunks.map((c) => c.ref)).size >= 3, "each page should still be represented");
});

test("an empty section list yields no chunks", () => {
  assert.deepEqual(chunkSections([]), []);
});

/* ---------------------------------------------------------- similarity -- */

test("similarity of identical unit vectors is 1, orthogonal is 0", () => {
  const a = [1, 0, 0];
  const b = [0, 1, 0];
  assert.ok(Math.abs(similarity(a, a) - 1) < 1e-9);
  assert.ok(Math.abs(similarity(a, b)) < 1e-9);
});

test("similarity ranks a closer vector higher", () => {
  const query = [1, 0];
  const near = [0.92, 0.39];
  const far = [0.2, 0.98];
  assert.ok(similarity(query, near) > similarity(query, far));
});

test("mismatched vector lengths do not throw", () => {
  assert.equal(typeof similarity([1, 0, 0], [1, 0]), "number");
});

/* ------------------------------------------------- the id as capability -- */

test("document ids carry real entropy and are unique", () => {
  const ids = new Set(Array.from({ length: 200 }, () => newDocumentId()));
  assert.equal(ids.size, 200, "ids must not collide");
  for (const id of ids) {
    assert.ok(id.length >= 43, `too short to be 256-bit: ${id.length}`);
    assert.ok(isValidDocumentId(id));
  }
});

test("document ids are NOT derived from a clock or a counter", () => {
  // The regression this guards: `newId()` in @/lib/chat.ts is
  // `prefix-<base36 clock>-<counter>` and is trivially enumerable. A
  // document id must share none of that structure, because it is the only
  // thing standing between a stored document and anyone who asks for it.
  const first = newDocumentId();
  const second = newDocumentId();
  assert.notEqual(first.slice(0, 12), second.slice(0, 12), "a shared prefix would imply a clock");
  // Checked against newId()'s FULL shape (`prefix-<base36 clock>-<counter>`),
  // not merely a leading "letters then hyphen": 256 bits of base64url can
  // legitimately begin that way, and asserting on the prefix alone made this
  // test fail roughly one run in a few hundred on a perfectly good id.
  assert.doesNotMatch(first, /^[a-z]+-[a-z0-9]+-\d+$/, "must not look like newId()'s format");
});

test("path traversal and malformed ids are rejected before touching storage", () => {
  const bad = [
    "../../etc/passwd",
    "documents/../secret",
    "a/b",
    "short",
    "",
    "has space",
    "has.dot",
    `${String.fromCharCode(0)}nul`,
    `${"A".repeat(43)}${String.fromCharCode(0)}`,
    "x".repeat(200),
    null,
    undefined,
    42,
    {},
  ];
  for (const value of bad) {
    assert.equal(isValidDocumentId(value as unknown), false, `should reject: ${String(value)}`);
  }
});

test("a well-formed id is accepted", () => {
  assert.equal(isValidDocumentId("A".repeat(43)), true);
  assert.equal(isValidDocumentId("a-b_c" + "D".repeat(40)), true);
});
