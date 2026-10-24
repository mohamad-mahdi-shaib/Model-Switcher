import { test } from "node:test";
import assert from "node:assert/strict";
import {
  availableFormats,
  codeExtension,
  DOCUMENT_CLOSE,
  DOCUMENT_OPEN,
  extractDocumentContent,
  hasDocumentFence,
  stripDocumentMarkers,
  coerceCell,
  flattenInline,
  generateFile,
  hasUnsupportedPdfText,
  sanitiseForPdf,
  suggestFilename,
  unsupportedPdfShare,
} from "@/lib/file-generation";
import { parseMarkdown } from "@/lib/markdown";

/**
 * Project 4, Milestone 5: generated files, REOPENED.
 *
 * Every format here is written and then parsed back with the same library
 * that would read it in the real world -- mammoth for .docx, SheetJS for
 * .xlsx, unpdf for .pdf. That is the only check that actually distinguishes
 * a real document from a plausible-looking blob: a renamed text file passes
 * a download button, a byte-length assertion, and a mime-type assertion, and
 * fails the moment Word tries to open it.
 */

const ANSWER = `# Quarterly Report

This is the **opening** paragraph with some *emphasis* and \`inline code\`.

## Findings

- First finding
- Second finding

1. Do this
2. Then this

| Region | Revenue | Growth |
| --- | ---: | ---: |
| North | 1,250.50 | 12 |
| South | 980 | -3 |

> A quoted remark.

\`\`\`python
def total(rows):
    return sum(r["revenue"] for r in rows)
\`\`\`

---

Closing paragraph.
`;

/* -------------------------------------------------------------- naming -- */

test("the filename comes from the answer's own heading", () => {
  assert.equal(suggestFilename(parseMarkdown(ANSWER)), "quarterly-report");
});

test("with no heading, the first sentence names the file", () => {
  const name = suggestFilename(parseMarkdown("Migration plan for the billing service\n\nDetails follow."));
  assert.match(name, /^migration-plan-for-the/);
});

test("a filename never exceeds a usable length or carries unsafe characters", () => {
  const name = suggestFilename(parseMarkdown(`# ${"word ".repeat(40)}`));
  assert.ok(name.length <= 60, `${name.length} characters`);
  assert.doesNotMatch(name, /[/\\:*?"<>|]/);
});

test("an answer with nothing nameable falls back rather than producing an empty name", () => {
  assert.equal(suggestFilename(parseMarkdown("...")), "answer");
  assert.equal(suggestFilename([]), "answer");
});

test("code extensions map to what a developer expects", () => {
  assert.equal(codeExtension("python"), "py");
  assert.equal(codeExtension("TypeScript"), "ts");
  assert.equal(codeExtension("c++"), "cpp");
  assert.equal(codeExtension("brainfuck"), "txt");
  assert.equal(codeExtension(null), "txt");
});

/* -------------------------------------------------- what can be offered -- */

test("Excel and Code are offered only when the answer actually has one", () => {
  const withBoth = availableFormats(ANSWER);
  assert.equal(withBoth.find((f) => f.format === "xlsx")?.available, true);
  assert.equal(withBoth.find((f) => f.format === "code")?.available, true);
  assert.equal(withBoth.find((f) => f.format === "code")?.label, "Code (.py)");

  const prose = availableFormats("Just a sentence.");
  const xlsx = prose.find((f) => f.format === "xlsx");
  assert.equal(xlsx?.available, false);
  assert.match(xlsx?.reason ?? "", /no table/);
  assert.equal(prose.find((f) => f.format === "code")?.available, false);
});

test("Word and Markdown are always available", () => {
  for (const text of ["", "plain", ANSWER, "مرحبا بالعالم"]) {
    const formats = availableFormats(text);
    assert.equal(formats.find((f) => f.format === "docx")?.available, true, text);
    assert.equal(formats.find((f) => f.format === "markdown")?.available, true, text);
  }
});

test("PDF is withheld for scripts its fonts cannot render, with the reason given", () => {
  assert.equal(hasUnsupportedPdfText("Ordinary Latin text, with punctuation — and £€."), false);
  assert.equal(hasUnsupportedPdfText("multi\nline\ttext\r\nis fine"), false, "whitespace is not exotic");
  assert.equal(hasUnsupportedPdfText("مرحبا"), true);
  assert.equal(hasUnsupportedPdfText("日本語"), true);

  const arabic = availableFormats("مرحبا بالعالم");
  const pdf = arabic.find((f) => f.format === "pdf");
  assert.equal(pdf?.available, false);
  assert.match(pdf?.reason ?? "", /use Word/);
});

/* -------------------------------------------------------------- inline -- */

test("nested emphasis survives flattening", () => {
  const block = parseMarkdown("**bold with *both* inside**")[0];
  assert.equal(block.type, "paragraph");
  if (block.type !== "paragraph") return;

  const spans = flattenInline(block.children);
  const both = spans.find((span) => span.text.includes("both"));
  assert.equal(both?.bold, true, "the outer bold must still apply");
  assert.equal(both?.italic, true, "and the inner emphasis as well");

  const outer = spans.find((span) => span.text.includes("bold with"));
  assert.equal(outer?.bold, true);
  assert.equal(outer?.italic, false);
});

/* ---------------------------------------------------------------- docx -- */

test("the .docx is a real Word document that mammoth reopens with its structure intact", async () => {
  const file = await generateFile("docx", ANSWER);
  assert.equal(file.filename, "quarterly-report.docx");
  assert.equal(
    file.mimeType,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  // A .docx is a ZIP: "PK".
  assert.equal(file.bytes[0], 0x50);
  assert.equal(file.bytes[1], 0x4b);

  const mammoth = await import("mammoth");
  const { value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(file.bytes) });

  // Headings are real Word headings, not bold paragraphs.
  assert.match(html, /<h1>Quarterly Report<\/h1>/);
  assert.match(html, /<h2>Findings<\/h2>/);
  // Lists are real lists.
  assert.match(html, /<ul>[\s\S]*First finding[\s\S]*<\/ul>/);
  assert.match(html, /<ol>[\s\S]*Do this[\s\S]*<\/ol>/);
  // The table is a real table with its cells intact.
  assert.match(html, /<table>/);
  assert.match(html, /<td><p>North<\/p><\/td>/);
  assert.match(html, /1,250\.50/);
  // Emphasis survived.
  assert.match(html, /<strong>opening<\/strong>/);
  assert.match(html, /<em>emphasis<\/em>/);
  // Code and quote text are present.
  assert.match(html, /def total\(rows\)/);
  assert.match(html, /A quoted remark/);
});

test("the .docx keeps ordered and unordered lists distinct", async () => {
  const file = await generateFile("docx", "- bullet one\n- bullet two\n\n1. step one\n2. step two\n");
  const mammoth = await import("mammoth");
  const { value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(file.bytes) });
  assert.match(html, /<ul>/, "bullets must be an unordered list");
  assert.match(html, /<ol>/, "numbers must be an ordered list, renumbering in Word");
});

test("non-Latin text round-trips through .docx unharmed", async () => {
  // The reason PDF is withheld for this text and Word is not.
  const file = await generateFile("docx", "# مرحبا\n\nنص عربي هنا.\n");
  const mammoth = await import("mammoth");
  const { value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(file.bytes) });
  assert.match(html, /مرحبا/);
  assert.match(html, /نص عربي هنا/);
});

test("an empty answer still produces a valid, openable document", async () => {
  const file = await generateFile("docx", "");
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(file.bytes) });
  assert.equal(typeof value, "string");
});

/* ---------------------------------------------------------------- xlsx -- */

test("the .xlsx reopens with the table's numbers as NUMBERS", async () => {
  const file = await generateFile("xlsx", ANSWER);
  assert.equal(file.filename, "quarterly-report.xlsx");
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(Buffer.from(file.bytes), { type: "buffer" });
  assert.deepEqual(workbook.SheetNames, ["Table"]);

  const sheet = workbook.Sheets["Table"];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]["Region"], "North");
  // "1,250.50" in the answer must be 1250.5 in the cell, or the column
  // cannot be summed -- the single most common way an export is useless.
  assert.equal(rows[0]["Revenue"], 1250.5);
  assert.equal(typeof rows[0]["Revenue"], "number");
  assert.equal(rows[1]["Growth"], -3, "a negative number stays negative");

  const cell = sheet[XLSX.utils.encode_cell({ r: 1, c: 1 })] as { t?: string };
  assert.equal(cell.t, "n", "the cell type must be numeric, not string");
});

test("several tables become several sheets", async () => {
  const two = "| A |\n| --- |\n| 1 |\n\ntext between\n\n| B |\n| --- |\n| 2 |\n";
  const file = await generateFile("xlsx", two);
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(Buffer.from(file.bytes), { type: "buffer" });
  assert.deepEqual(workbook.SheetNames, ["Table 1", "Table 2"]);
});

test("text that merely looks numeric is not coerced into a wrong number", () => {
  assert.equal(coerceCell("1,250.50"), 1250.5);
  assert.equal(coerceCell("$980"), 980);
  assert.equal(coerceCell("-3"), -3);
  assert.equal(coerceCell("12%"), "12%", "a percentage is not the number 12");
  assert.equal(coerceCell("2024-03-01"), "2024-03-01", "a date must not become arithmetic");
  assert.equal(coerceCell("N/A"), "N/A");
  assert.equal(coerceCell("1.2.3"), "1.2.3", "a version is not a number");
  assert.equal(coerceCell(""), "");
});

/* ----------------------------------------------------------------- pdf -- */

test("the .pdf has a real text layer that unpdf can read back", async () => {
  const file = await generateFile("pdf", ANSWER);
  assert.equal(file.filename, "quarterly-report.pdf");
  assert.equal(file.mimeType, "application/pdf");
  // "%PDF"
  assert.deepEqual([...file.bytes.slice(0, 4)], [0x25, 0x50, 0x44, 0x46]);

  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(file.bytes));
  const { text } = await extractText(pdf, { mergePages: true });

  // The same test this project applies to UPLOADED PDFs, applied to the ones
  // it produces: if this came back empty, the export would be an image.
  assert.match(text, /Quarterly Report/);
  assert.match(text, /Findings/);
  assert.match(text, /First finding/);
  assert.match(text, /North/);
  assert.match(text, /1,250\.50/);
  assert.match(text, /def total/);
});

test("a long answer paginates instead of writing off the bottom of the page", async () => {
  const long = Array.from({ length: 120 }, (_, i) => `Paragraph number ${i} with enough text to wrap.`).join(
    "\n\n",
  );
  const file = await generateFile("pdf", long);
  const { getDocumentProxy, extractText } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(file.bytes));
  assert.ok(pdf.numPages > 1, `expected multiple pages, got ${pdf.numPages}`);
  const { text } = await extractText(pdf, { mergePages: true });
  assert.match(text, /Paragraph number 0 /);
  assert.match(text, /Paragraph number 119 /, "the end of the answer must not be lost");
});

/* -------------------------------------------------------- text formats -- */

test("the code file carries only the code, with the language's extension", async () => {
  const file = await generateFile("code", ANSWER);
  assert.equal(file.filename, "quarterly-report.py");
  const content = new TextDecoder().decode(file.bytes);
  assert.match(content, /^def total\(rows\):/);
  assert.doesNotMatch(content, /Quarterly Report/, "prose must not leak into a source file");
  assert.doesNotMatch(content, /```/, "the fence itself must not be written to the file");
});

test("several code blocks are concatenated rather than silently losing one", async () => {
  const file = await generateFile("code", "```js\nconst a = 1;\n```\n\ntext\n\n```js\nconst b = 2;\n```\n");
  const content = new TextDecoder().decode(file.bytes);
  assert.match(content, /const a = 1;/);
  assert.match(content, /const b = 2;/);
});

test("asking for code when there is none falls back to text rather than an empty file", async () => {
  const file = await generateFile("code", "No code here at all.");
  assert.match(file.filename, /\.txt$/);
  assert.ok(file.bytes.length > 0);
});

test("the markdown file is the answer's own source, byte for byte", async () => {
  const file = await generateFile("markdown", ANSWER);
  assert.equal(file.filename, "quarterly-report.md");
  assert.equal(new TextDecoder().decode(file.bytes), ANSWER);
});

test("an explicit filename overrides the suggestion", async () => {
  const file = await generateFile("markdown", ANSWER, { filename: "my-report" });
  assert.equal(file.filename, "my-report.md");
});

/* ------------------------- PDF availability: the reported regression ----- */

/**
 * The bug: Word, Excel and Markdown saved fine while PDF stayed permanently
 * greyed out. The guard refused a PDF for ANY character outside Latin-1 plus
 * general punctuation -- so one arrow, one tick, one emoji or one "™" in an
 * otherwise plain English answer disabled the format entirely. Models emit
 * those constantly.
 */

test("an ordinary English answer containing a symbol still offers a PDF", () => {
  const answers = [
    "# Report\n\nCost → savings this quarter.",
    "# Report\n\n- Shipped ✓\n- Blocked ✗",
    "# Report\n\nGreat results 🚀 this month.",
    "# Report\n\nAcme™ saves ≈ 20% versus ≥ 2 rivals.",
    "# Report\n\nBullets • and an ellipsis…",
  ];
  for (const answer of answers) {
    const pdf = availableFormats(answer).find((f) => f.format === "pdf");
    assert.equal(pdf?.available, true, `PDF should be offered for: ${JSON.stringify(answer)}`);
  }
});

test("a genuinely unrenderable answer still refuses, with the reason", () => {
  for (const answer of ["# مرحبا\n\nنص عربي كامل هنا", "# 日本語\n\nこれは日本語の文章です"]) {
    const pdf = availableFormats(answer).find((f) => f.format === "pdf");
    assert.equal(pdf?.available, false, answer);
    assert.match(pdf?.reason ?? "", /use Word/);
  }
});

test("the undrawable share is measured, not merely detected", () => {
  assert.equal(unsupportedPdfShare("# Report\n\nPlain English."), 0);
  // One emoji among many words is a small share...
  assert.ok(unsupportedPdfShare("A fairly long English sentence 🚀 about work.") < 0.1);
  // ...a whole Arabic paragraph is nearly all of it.
  assert.ok(unsupportedPdfShare("نص عربي كامل هنا وهذا") > 0.8);
});

test("substitution keeps meaning that dropping would destroy", () => {
  assert.equal(sanitiseForPdf("cost → savings"), "cost -> savings");
  assert.equal(sanitiseForPdf("done ✓"), "done [x]");
  assert.equal(sanitiseForPdf("about ≈ 20%"), "about ~ 20%");
  assert.equal(sanitiseForPdf("at ≥ 5 and ≤ 9"), "at >= 5 and <= 9");
  assert.equal(sanitiseForPdf("Acme™"), "Acme(TM)");
});

test("whitespace survives sanitisation -- otherwise every line would merge", () => {
  assert.equal(sanitiseForPdf("a\nb\tc"), "a\nb\tc");
});

test("what cannot be drawn is dropped rather than mangled", () => {
  // An emoji has no sensible ASCII equivalent, so it goes; the words stay.
  assert.equal(sanitiseForPdf("great 🚀 news"), "great  news");
});

test("accented Latin text is untouched -- it was always renderable", () => {
  assert.equal(sanitiseForPdf("café naïve £10 €20 –dash— “quote”"), "café naïve £10 €20 –dash— “quote”");
  assert.equal(availableFormats("# Café\n\nnaïve résumé").find((f) => f.format === "pdf")?.available, true);
});

/* ----------------------------- the PDF is actually produced and readable -- */

test("a symbol-laden answer produces a real PDF whose text reopens", async () => {
  const answer =
    "# Quarterly Review\n\nRevenue → up. Shipped ✓ on time. Growth ≈ 20% 🚀\n\n" +
    "| Metric | Change |\n| --- | --- |\n| Revenue | ↑ 12% |\n";

  const file = await generateFile("pdf", answer);
  assert.deepEqual([...file.bytes.slice(0, 4)], [0x25, 0x50, 0x44, 0x46], "%PDF");
  assert.ok(file.bytes.length > 1_000);

  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(file.bytes));
  const { text } = await extractText(pdf, { mergePages: true });

  assert.match(text, /Quarterly Review/);
  // The substitutions made it into the real text layer.
  assert.match(text, /Revenue -> up/);
  assert.match(text, /Shipped \[x\] on time/);
  assert.match(text, /~ 20%/);
  // And the table still rendered.
  assert.match(text, /Metric/);
});

/* --------------------------------------- Code: disabled, with a reason --- */

test("Code is offered when the answer HAS a code block, and names the extension", () => {
  const withCode = availableFormats("# Script\n\n```python\nprint(1)\n```\n").find(
    (f) => f.format === "code",
  );
  assert.equal(withCode?.available, true);
  assert.equal(withCode?.label, "Code (.py)");
});

test("Code is disabled only when there is genuinely no code block, and says so", () => {
  const withoutCode = availableFormats("# Report\n\nJust prose here.").find((f) => f.format === "code");
  assert.equal(withoutCode?.available, false);
  assert.match(withoutCode?.reason ?? "", /no code block/);
});

test("every unavailable format carries its OWN reason, so none is unexplained", () => {
  // Prose only: no table, no code. Both must explain themselves.
  const formats = availableFormats("# Report\n\nJust prose.");
  for (const entry of formats) {
    if (!entry.available) {
      assert.ok(entry.reason, `${entry.format} is disabled with no reason given`);
    }
  }
  assert.deepEqual(
    formats.filter((f) => !f.available).map((f) => f.format).sort(),
    ["code", "json", "xlsx"],
    "prose has no table, no code and no JSON",
  );
});

/* ===================== document generation vs message export ============= */

/**
 * The reported bug: asking for "a PDF containing my name and skills" produced
 * a conversational reply, and exporting it saved the whole chat message --
 * "Sure, here is your PDF:" and all -- instead of a clean document.
 *
 * Root cause: the file and the reply were the same string. These tests pin
 * the two operations apart.
 *
 * All MOCKED in the sense that no model is called: the assistant text is
 * supplied directly. The FILES, however, are real -- written by the real
 * generators and reopened with mammoth / SheetJS / unpdf.
 */

/** What a model actually returns when it fences the document properly. */
const FENCED_REPLY = `Sure! Here is the CV you asked for.

${DOCUMENT_OPEN}
# Jordan Avery

## Education
- BSc Computer Science, Example University, 2024

## Skills
- TypeScript
- Technical writing
${DOCUMENT_CLOSE}

Let me know if you would like a different layout.`;

/** The same, from a model that ignored the fence. */
const UNFENCED_REPLY = `Sure! Here is the CV you asked for.

# Jordan Avery

## Education
- BSc Computer Science, Example University, 2024

## Skills
- TypeScript
- Technical writing

Let me know if you would like a different layout.`;

/** An ordinary answer that merely begins politely. Not a document request. */
const NORMAL_REPLY = `Here's how recursion works: a function calls itself until it reaches a base case. The base case is what stops it from recursing forever and overflowing the stack, so every recursive function needs one.`;

/* --- A. exporting a normal message keeps exporting that message ---------- */

test("A: Save As on a normal message exports the message verbatim", async () => {
  // No fence, and chatter trimming is NOT applied on this path.
  const extracted = extractDocumentContent(NORMAL_REPLY);
  assert.equal(extracted.content, NORMAL_REPLY.trim());
  assert.equal(extracted.trimmed, false);

  const file = await generateFile("markdown", extracted.content);
  const written = new TextDecoder().decode(file.bytes);
  assert.match(written, /^Here's how recursion works/, "the opening line must survive");
  assert.match(written, /overflowing the stack/);
});

test("A: a polite opener in a NORMAL answer is never trimmed away", () => {
  // The danger of preamble trimming: "Here's how..." is content, not chatter.
  // Save As does not trim at all, and even the document path keeps this,
  // because the paragraph is long and the reply has no other content.
  assert.equal(extractDocumentContent(NORMAL_REPLY).content, NORMAL_REPLY.trim());
  assert.equal(
    extractDocumentContent(NORMAL_REPLY, { stripChatter: true }).content,
    NORMAL_REPLY.trim(),
  );
});

/* --- F. conversational text is excluded from a generated document -------- */

test("F: the fenced document excludes the preamble and the sign-off", () => {
  const extracted = extractDocumentContent(FENCED_REPLY, { stripChatter: true });
  assert.equal(extracted.fenced, true);
  assert.match(extracted.content, /^# Jordan Avery/);
  assert.doesNotMatch(extracted.content, /Sure!/);
  assert.doesNotMatch(extracted.content, /Let me know/);
  assert.doesNotMatch(extracted.content, /<<<FILE>>>|<<<END FILE>>>/);
});

test("F: an unfenced reply still loses its conversational wrapper", () => {
  const extracted = extractDocumentContent(UNFENCED_REPLY, { stripChatter: true });
  assert.equal(extracted.fenced, false);
  assert.equal(extracted.trimmed, true);
  assert.match(extracted.content, /^# Jordan Avery/);
  assert.doesNotMatch(extracted.content, /Sure!/);
  assert.doesNotMatch(extracted.content, /Let me know/);
});

test("F: markers never survive into a saved file, even via Save As", () => {
  // Save As does not trim chatter, but it must still never write the
  // app's own control markers into a document.
  const extracted = extractDocumentContent(FENCED_REPLY);
  assert.doesNotMatch(extracted.content, /<<<FILE>>>|<<<END FILE>>>/);
});

test("F: unrelated chat history is not in the document -- only this answer is", () => {
  // Extraction is per-message by construction: it is given one answer and
  // cannot reach the rest of the conversation.
  const extracted = extractDocumentContent(FENCED_REPLY, { stripChatter: true });
  assert.doesNotMatch(extracted.content, /recursion/);
});

/* --- B/C/D/E. real files, from the extracted document -------------------- */

test("B: a requested PDF contains the document and NOT the preamble", async () => {
  const content = extractDocumentContent(FENCED_REPLY, { stripChatter: true }).content;
  const file = await generateFile("pdf", content);

  assert.deepEqual([...file.bytes.slice(0, 4)], [0x25, 0x50, 0x44, 0x46], "%PDF");
  assert.ok(file.bytes.length > 1_000);

  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(file.bytes));
  const { text } = await extractText(pdf, { mergePages: true });

  assert.match(text, /Jordan Avery/);
  assert.match(text, /BSc Computer Science/);
  assert.doesNotMatch(text, /Sure!/, "the conversational opener must not be in the PDF");
  assert.doesNotMatch(text, /Let me know/, "nor the sign-off");
});

test("C: a requested Word document is valid and reopens with its structure", async () => {
  const content = extractDocumentContent(FENCED_REPLY, { stripChatter: true }).content;
  const file = await generateFile("docx", content);
  assert.equal(file.bytes[0], 0x50);
  assert.equal(file.bytes[1], 0x4b);

  const mammoth = await import("mammoth");
  const { value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(file.bytes) });
  assert.match(html, /<h1>Jordan Avery<\/h1>/);
  assert.match(html, /<h2>Education<\/h2>/);
  assert.match(html, /<ul>[\s\S]*TypeScript[\s\S]*<\/ul>/);
  assert.doesNotMatch(html, /Sure!/);
  assert.doesNotMatch(html, /Let me know/);
});

test("D: a requested spreadsheet keeps the DATA structure, not the prose", async () => {
  const reply = `Of course, here is the breakdown.

${DOCUMENT_OPEN}
| Region | Revenue | Growth |
| --- | ---: | ---: |
| North | 1,250.50 | 12 |
| South | 980 | -3 |
${DOCUMENT_CLOSE}

Tell me if you want more regions.`;

  const content = extractDocumentContent(reply, { stripChatter: true }).content;
  const file = await generateFile("xlsx", content);

  const XLSX = await import("xlsx");
  const workbook = XLSX.read(Buffer.from(file.bytes), { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

  assert.equal(rows.length, 2, "two data rows, no prose rows");
  assert.equal(rows[0]["Region"], "North");
  // Still numeric, so the column can be summed.
  assert.equal(rows[0]["Revenue"], 1250.5);
  assert.equal(typeof rows[0]["Revenue"], "number");
  assert.doesNotMatch(JSON.stringify(rows), /Of course|Tell me/);
});

test("E: a requested code file carries the code and the right extension", async () => {
  const reply = `Here you go.

${DOCUMENT_OPEN}
\`\`\`python
def greet(name):
    return f"Hello {name}"
\`\`\`
${DOCUMENT_CLOSE}

Hope that helps.`;

  const content = extractDocumentContent(reply, { stripChatter: true }).content;
  const file = await generateFile("code", content);

  assert.match(file.filename, /\.py$/);
  const written = new TextDecoder().decode(file.bytes);
  assert.match(written, /^def greet\(name\):/);
  assert.doesNotMatch(written, /Here you go|Hope that helps/, "prose must not reach a source file");
  assert.doesNotMatch(written, /```/, "nor the fence itself");
});

test("E: a requested Markdown file is the document, not the whole reply", async () => {
  const content = extractDocumentContent(FENCED_REPLY, { stripChatter: true }).content;
  const file = await generateFile("markdown", content);
  const written = new TextDecoder().decode(file.bytes);
  assert.match(written, /^# Jordan Avery/);
  assert.doesNotMatch(written, /Sure!/);
  assert.match(file.filename, /\.md$/);
});

test("D: a requested JSON file contains parseable JSON, not prose", async () => {
  const reply = `Sure.

${DOCUMENT_OPEN}
\`\`\`json
{ "name": "Jordan Avery", "skills": ["TypeScript", "Technical writing"] }
\`\`\`
${DOCUMENT_CLOSE}`;

  const content = extractDocumentContent(reply, { stripChatter: true }).content;
  const file = await generateFile("json", content);

  assert.match(file.filename, /\.json$/);
  const written = new TextDecoder().decode(file.bytes);
  const parsed = JSON.parse(written) as { name: string; skills: string[] };
  assert.equal(parsed.name, "Jordan Avery");
  assert.equal(parsed.skills.length, 2);
  assert.doesNotMatch(written, /Sure/);
});

/* --- G. failures are honest, never a fake download ----------------------- */

test("G: asking for JSON when the answer has none fails loudly", async () => {
  await assert.rejects(
    () => generateFile("json", "# Report\n\nThere is no JSON here at all."),
    /does not contain valid JSON/i,
    "better an actionable error than a file that will not open",
  );
});

test("G: JSON is not offered when the answer has none, and says why", () => {
  const entry = availableFormats("# Report\n\nJust prose.").find((f) => f.format === "json");
  assert.equal(entry?.available, false);
  assert.match(entry?.reason ?? "", /no JSON/i);
});

test("G: malformed JSON is refused rather than written out broken", async () => {
  const broken = "```json\n{ \"name\": \"Jordan\", }\n```";
  await assert.rejects(() => generateFile("json", broken), /valid JSON/i);
  assert.equal(availableFormats(broken).find((f) => f.format === "json")?.available, false);
});

test("G: an empty document never silently becomes an empty file", () => {
  // A reply that is ALL chatter keeps its text rather than extracting to
  // nothing -- an empty document helps nobody, and the card would otherwise
  // offer a download of zero content.
  const allChatter = "Sure, here you go.";
  const extracted = extractDocumentContent(allChatter, { stripChatter: true });
  assert.equal(extracted.content, "Sure, here you go.");
});

/* --- the fence drives the UI, so markers never leak --------------------- */

test("the fence is detectable, so a card is shown and markers never render raw", () => {
  assert.equal(hasDocumentFence(FENCED_REPLY), true);
  assert.equal(hasDocumentFence(UNFENCED_REPLY), false);
  assert.equal(hasDocumentFence(NORMAL_REPLY), false);
});

test("stripping markers leaves the reply readable if it is ever displayed raw", () => {
  const stripped = stripDocumentMarkers(FENCED_REPLY);
  assert.doesNotMatch(stripped, /<<<FILE>>>|<<<END FILE>>>/);
  assert.match(stripped, /Jordan Avery/);
  assert.match(stripped, /Sure!/, "display keeps the conversation; only the FILE drops it");
});
