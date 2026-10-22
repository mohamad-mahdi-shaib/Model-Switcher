// Project 4: LIVE verification of the document workspace.
//
// THIS SCRIPT SPENDS REAL QUOTA. Unlike everything under `tests/` and
// `tests/browser/`, nothing here is mocked: it uploads a real file to a
// running server, which really parses it, really embeds it through Gemini,
// and really stores it in Vercel Blob; then it really extracts structured
// data through the model and really asks a grounded question.
//
// Cost at the defaults: one `gemini-embedding-001` call (free tier), two
// `gemini-3.6-flash` calls (free tier, 20/day per project), and one small
// blob write that the script deletes again at the end.
//
// It is deliberately NOT part of `npm test` and not part of the browser
// suites. Run it on purpose:
//
//   npm run dev                                   # in another terminal
//   node tests/live/verify-documents-live.mjs
//
// It prints document ids TRUNCATED. A document id is a capability -- anyone
// holding one can read that document -- so a full id is never written to a
// log or a report.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const CONVERSATION_ID = `live-${Date.now().toString(36)}`;

let pass = 0;
let fail = 0;
const log = (ok, name, detail) => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== undefined ? "  " + detail : ""}`);
};
const short = (id) => (typeof id === "string" ? `${id.slice(0, 8)}…(${id.length} chars)` : String(id));

/** A real PDF invoice, built with the same library the app uses for export. */
async function buildInvoicePdf() {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  doc.setFontSize(20);
  doc.text("INVOICE", 56, 70);
  doc.setFontSize(11);
  const lines = [
    "Northwind Trading Ltd",
    "14 Harbour Road, Bristol BS1 4XE",
    "",
    "Bill to: Acme Corporation",
    "Invoice number: INV-2026-0417",
    "Issue date: 2026-03-01",
    "Due date: 2026-03-31",
    "Currency: GBP",
    "",
    "Description                 Qty    Unit price      Amount",
    "Consulting services          10         100.00     1000.00",
    "Annual licence                2         250.00      500.00",
    "",
    "Subtotal: 1500.00",
    "Tax (20% VAT): 300.00",
    "Total due: 1800.00",
    "",
    "Payment terms: Net 30. Late payment incurs 2% monthly interest.",
  ];
  let y = 110;
  for (const line of lines) {
    doc.text(line, 56, y);
    y += 18;
  }
  doc.addPage();
  doc.setFontSize(11);
  doc.text("Page 2 - Notes", 56, 70);
  doc.text("Delivery was completed on 2026-02-24 and signed for by J. Patel.", 56, 100);
  return new Uint8Array(doc.output("arraybuffer"));
}

async function main() {
  console.log(`Live run against ${BASE_URL}, conversation ${CONVERSATION_ID}\n`);

  /* ------------------------------------------------------ 0. the probe -- */

  const probe = await fetch(`${BASE_URL}/api/documents`).then((r) => r.json());
  log(probe.configured === true, "the server reports the document workspace configured", JSON.stringify(probe));
  if (!probe.configured) {
    console.log("\nStopping: the server cannot index documents, so nothing below can be verified.");
    return;
  }

  /* ----------------------------------------------- 1. upload and index -- */

  const bytes = await buildInvoicePdf();
  console.log(`Built a real 2-page PDF invoice (${bytes.length} bytes).\n`);

  const form = new FormData();
  form.append("conversationId", CONVERSATION_ID);
  form.append("file", new File([bytes], "northwind-invoice.pdf", { type: "application/pdf" }));

  const startedUpload = Date.now();
  const uploadResponse = await fetch(`${BASE_URL}/api/documents`, { method: "POST", body: form });
  const uploadBody = await uploadResponse.json().catch(() => null);
  const uploadMs = Date.now() - startedUpload;

  log(uploadResponse.ok, `upload + parse + embed + store returned ${uploadResponse.status}`, `${uploadMs} ms`);
  if (!uploadResponse.ok || !uploadBody?.document) {
    console.log("Response:", JSON.stringify(uploadBody));
    console.log("\nStopping: nothing was indexed, so retrieval and extraction cannot be verified.");
    return;
  }

  const document = uploadBody.document;
  log(document.kind === "pdf", "the file was sniffed as a PDF", document.kind);
  log(document.sections > 0, "real text was extracted into citable sections", `${document.sections} sections`);
  log(document.meta.pages === 2, "both pages were read", `pages=${document.meta.pages}`);
  log(
    /^[A-Za-z0-9_-]{43,86}$/.test(document.id),
    "the server issued a 256-bit capability id",
    short(document.id),
  );
  log(
    !JSON.stringify(uploadBody).includes("blob.vercel-storage.com"),
    "no blob URL was returned to the client",
  );
  console.log(`  warnings: ${JSON.stringify(document.warnings)}\n`);

  /* -------------------------------------------- 2. isolation, for real -- */

  const foreign = await fetch(
    `${BASE_URL}/api/extract`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        documentId: document.id,
        conversationId: `${CONVERSATION_ID}-other`,
        schema: "invoice",
      }),
    },
  );
  log(
    foreign.status === 404,
    "another conversation holding the real id is refused by the live server",
    `status=${foreign.status}`,
  );

  /* ------------------------------------------------ 3. real extraction -- */

  const startedExtract = Date.now();
  const extractResponse = await fetch(`${BASE_URL}/api/extract`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      documentId: document.id,
      conversationId: CONVERSATION_ID,
      schema: "invoice",
    }),
  });
  const extractBody = await extractResponse.json().catch(() => null);
  const extractMs = Date.now() - startedExtract;

  log(extractResponse.ok, `extraction returned ${extractResponse.status}`, `${extractMs} ms`);
  if (extractResponse.ok && extractBody?.result) {
    const data = extractBody.result.data;
    console.log(`  model: ${extractBody.result.model}`);
    console.log(`  extracted: ${JSON.stringify(data, null, 2).split("\n").join("\n  ")}\n`);
    log(data.total === 1800, "the total was read correctly from the PDF", String(data.total));
    log(data.invoiceNumber === "INV-2026-0417", "the invoice number was read correctly", String(data.invoiceNumber));
    log(data.currency === "GBP", "the currency was read correctly", String(data.currency));
    log(Array.isArray(data.lineItems) && data.lineItems.length === 2, "both line items were found", String(data.lineItems?.length));
    log(
      Array.isArray(data.sourceRefs) && data.sourceRefs.length > 0,
      "the extraction cited where it looked",
      JSON.stringify(data.sourceRefs),
    );
    log(
      extractBody.result.warnings.length === 0,
      "the arithmetic audit found no discrepancy in a consistent invoice",
      JSON.stringify(extractBody.result.warnings),
    );
  } else {
    console.log("  response:", JSON.stringify(extractBody));
  }

  /* --------------------------------------------- 4. a grounded answer --- */

  const chatResponse = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider: "gemini",
      conversationId: CONVERSATION_ID,
      documentIds: [document.id],
      messages: [{ role: "user", content: "Who signed for the delivery, and on what date? Cite the page." }],
    }),
  });

  log(chatResponse.ok, `the grounded question returned ${chatResponse.status}`);
  let answer = "";
  if (chatResponse.ok && chatResponse.body) {
    const reader = chatResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
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
          if (event.type === "error") console.log("  stream error:", event.code);
        } catch {
          /* partial line */
        }
      }
    }
    console.log(`\n  answer: ${answer.trim()}\n`);
    log(/Patel/i.test(answer), "the answer found a fact that exists ONLY on page 2 of the PDF");
    log(/p\.\s*2|page\s*2/i.test(answer), "and cited the page it came from");
  }

  /* --------------------------------------------------------- 5. clean up */

  const deleteResponse = await fetch(
    `${BASE_URL}/api/documents?id=${encodeURIComponent(document.id)}&conversationId=${encodeURIComponent(CONVERSATION_ID)}`,
    { method: "DELETE" },
  );
  log(deleteResponse.ok, "the test document was deleted from storage again", `status=${deleteResponse.status}`);
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
