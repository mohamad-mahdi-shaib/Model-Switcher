// Project 4: LIVE verification of MULTI-FILE comparison.
//
// THIS SCRIPT SPENDS REAL QUOTA. Nothing is mocked.
//
// It covers the one claim the unit tests can assert but never prove: that
// two different documents, in two different formats, uploaded to one
// conversation, are BOTH represented in the retrieved context — and that a
// comparison question comes back with the right contrasts, attributed to the
// right file.
//
// The per-document quota in `retrieve.ts` exists precisely for this. Without
// it, top-k by similarity alone can return every passage from whichever file
// scores highest, and the model then "compares" one document with itself.
// That failure is invisible in the output unless the facts are checked, so
// this script checks specific values that differ between the two files.
//
// Cost at the defaults: two embedding calls at upload (one per file, free
// tier), one query embedding per question, and two `gemini-3.6-flash` calls
// (free tier, 20/day per project). Both documents are deleted at the end.
//
//   npm run dev                                    # in another terminal
//   node tests/live/verify-comparison-live.mjs

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const CONVERSATION_ID = `cmp-${Date.now().toString(36)}`;

let pass = 0;
let fail = 0;
const log = (ok, name, detail) => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== undefined ? "  " + detail : ""}`);
};

/**
 * Agreement A, as a real PDF.
 *
 * Every fact below is deliberately DIFFERENT from agreement B, so a wrong
 * answer cannot be mistaken for a right one.
 */
async function buildAcmePdf() {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  doc.setFontSize(16);
  doc.text("SERVICES AGREEMENT - ACME", 56, 70);
  doc.setFontSize(11);
  const lines = [
    "Between: Acme Corporation and Northwind Trading Ltd",
    "",
    "1. Term. This agreement runs for 12 months from the effective date",
    "   of 2026-01-15 and renews automatically unless notice is given.",
    "",
    "2. Termination. Either party may terminate on 30 days written notice.",
    "",
    "3. Fees. The annual fee is 48,000 GBP, invoiced quarterly.",
    "   Payment terms are Net 30.",
    "",
    "4. Governing law. This agreement is governed by the laws of",
    "   England and Wales.",
    "",
    "5. Liability. Aggregate liability is capped at the fees paid in the",
    "   preceding 12 months.",
  ];
  let y = 110;
  for (const line of lines) {
    doc.text(line, 56, y);
    y += 18;
  }
  return new Uint8Array(doc.output("arraybuffer"));
}

/**
 * Agreement B, as a real DOCX — a different format AND a different parser
 * (mammoth, heading-anchored), so this also proves two parsers can coexist
 * in one conversation's retrieval.
 */
async function buildGlobexDocx() {
  const { Document, HeadingLevel, Packer, Paragraph } = await import("docx");
  const document = new Document({
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, text: "Services Agreement - Globex" }),
          new Paragraph("Between: Globex Industries and Initech LLC"),
          new Paragraph({ heading: HeadingLevel.HEADING_2, text: "Term" }),
          new Paragraph(
            "This agreement runs for 24 months from the effective date of 2026-03-01. It does not renew automatically and must be renewed in writing.",
          ),
          new Paragraph({ heading: HeadingLevel.HEADING_2, text: "Termination" }),
          new Paragraph("Either party may terminate on 90 days written notice."),
          new Paragraph({ heading: HeadingLevel.HEADING_2, text: "Fees" }),
          new Paragraph("The annual fee is 75,000 USD, invoiced monthly. Payment terms are Net 60."),
          new Paragraph({ heading: HeadingLevel.HEADING_2, text: "Governing law" }),
          new Paragraph("This agreement is governed by the laws of the State of Delaware."),
          new Paragraph({ heading: HeadingLevel.HEADING_2, text: "Liability" }),
          new Paragraph("Aggregate liability is capped at 500,000 USD."),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(document));
}

async function upload(bytes, filename, type) {
  const form = new FormData();
  form.append("conversationId", CONVERSATION_ID);
  form.append("file", new File([bytes], filename, { type }));
  const started = Date.now();
  const response = await fetch(`${BASE_URL}/api/documents`, { method: "POST", body: form });
  const body = await response.json().catch(() => null);
  return { response, body, ms: Date.now() - started };
}

/** Sends one question with both documents attached and returns the answer. */
async function ask(question, documentIds) {
  const response = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider: "gemini",
      conversationId: CONVERSATION_ID,
      documentIds,
      messages: [{ role: "user", content: question }],
    }),
  });
  if (!response.ok || !response.body) {
    return { ok: false, status: response.status, answer: "" };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";
  let error = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event.type === "delta") answer += event.text;
        if (event.type === "error") error = event.code;
      } catch {
        /* partial */
      }
    }
  }
  return { ok: !error, status: response.status, answer, error };
}

async function main() {
  console.log(`Live comparison run against ${BASE_URL}, conversation ${CONVERSATION_ID}\n`);

  /* ------------------------------------------------- upload both files -- */

  const acmeBytes = await buildAcmePdf();
  const globexBytes = await buildGlobexDocx();
  console.log(`Built acme-agreement.pdf (${acmeBytes.length} bytes) and globex-agreement.docx (${globexBytes.length} bytes)\n`);

  const acme = await upload(acmeBytes, "acme-agreement.pdf", "application/pdf");
  log(acme.response.ok, `PDF uploaded and indexed (${acme.response.status})`, `${acme.ms} ms`);
  if (!acme.response.ok) {
    console.log("  response:", JSON.stringify(acme.body));
    return;
  }

  const globex = await upload(
    globexBytes,
    "globex-agreement.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  log(globex.response.ok, `DOCX uploaded and indexed (${globex.response.status})`, `${globex.ms} ms`);
  if (!globex.response.ok) {
    console.log("  response:", JSON.stringify(globex.body));
    return;
  }

  log(
    acme.body.document.kind === "pdf" && globex.body.document.kind === "docx",
    "the two files were parsed by DIFFERENT parsers in one conversation",
    `${acme.body.document.kind} + ${globex.body.document.kind}`,
  );
  console.log(
    `  sections: acme=${acme.body.document.sections}, globex=${globex.body.document.sections}\n`,
  );

  const ids = [acme.body.document.id, globex.body.document.id];

  /* ----------------------------------------------- the comparison query -- */

  const comparison = await ask(
    "Compare the two agreements: termination notice period, governing law, and payment terms. State which agreement each value comes from.",
    ids,
  );
  log(comparison.ok, `comparison question answered (${comparison.status})`, comparison.error ?? "");
  console.log(`\n  answer:\n  ${comparison.answer.trim().split("\n").join("\n  ")}\n`);

  const text = comparison.answer;

  // Both files must be represented. This is the per-document quota doing its
  // job: if only one file's passages were retrieved, half these fail.
  log(/acme/i.test(text), "the answer references the PDF agreement");
  log(/globex/i.test(text), "the answer references the DOCX agreement");

  // Facts that exist in only ONE of the two files.
  log(/30\s*days/i.test(text), "Acme's 30-day notice period was found (PDF only)");
  log(/90\s*days/i.test(text), "Globex's 90-day notice period was found (DOCX only)");
  log(/England/i.test(text), "Acme's governing law was found (PDF only)");
  log(/Delaware/i.test(text), "Globex's governing law was found (DOCX only)");
  log(/Net\s*30/i.test(text), "Acme's payment terms were found (PDF only)");
  log(/Net\s*60/i.test(text), "Globex's payment terms were found (DOCX only)");

  /**
   * The values must not be SWAPPED between the files.
   *
   * An earlier version of this check compared first-occurrence distances,
   * which measured nothing: both file names appear in the answer's opening
   * sentence, so the "nearest" name was an accident of phrasing rather than
   * of attribution. This checks the line the value actually appears on --
   * at least one line stating the value must name the right file, and no
   * line may pair the value with only the wrong one. Verified against
   * deliberately swapped inputs before being relied on.
   */
  const has = (line, needle) => line.toLowerCase().includes(needle.toLowerCase());
  const attributedTo = (value, expected, wrong) => {
    const lines = text.split(/\r?\n/).filter((line) => has(line, value));
    if (lines.length === 0) return false;
    return (
      lines.some((line) => has(line, expected)) &&
      !lines.some((line) => has(line, wrong) && !has(line, expected))
    );
  };

  log(attributedTo("Delaware", "globex", "acme"), "Delaware is attributed to Globex, not to Acme");
  log(attributedTo("England", "acme", "globex"), "England and Wales is attributed to Acme, not to Globex");
  log(attributedTo("Net 60", "globex", "acme"), "Net 60 is attributed to Globex, not to Acme");
  log(attributedTo("Net 30", "acme", "globex"), "Net 30 is attributed to Acme, not to Globex");

  /* ------------------------------------------- a summary across both ---- */

  const summary = await ask("Summarise both files.", ids);
  log(summary.ok, `summary question answered (${summary.status})`, summary.error ?? "");
  console.log(`\n  answer:\n  ${summary.answer.trim().split("\n").join("\n  ")}\n`);
  log(
    /acme/i.test(summary.answer) && /globex/i.test(summary.answer),
    "the summary covers BOTH files, not just one",
  );

  /* --------------------------------------------------------- clean up --- */

  for (const [id, name] of [
    [ids[0], "acme-agreement.pdf"],
    [ids[1], "globex-agreement.docx"],
  ]) {
    const response = await fetch(
      `${BASE_URL}/api/documents?id=${encodeURIComponent(id)}&conversationId=${encodeURIComponent(CONVERSATION_ID)}`,
      { method: "DELETE" },
    );
    log(response.ok, `${name} deleted from storage`, `status=${response.status}`);
  }
}

main()
  .catch((error) => {
    fail++;
    console.log(`FAIL  the run threw: ${error?.message ?? String(error)}`);
  })
  .finally(() => {
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
  });
