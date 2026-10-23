// Project 4: LIVE diagnosis / verification of STRUCTURED EXTRACTION.
//
// THIS SCRIPT SPENDS REAL QUOTA. Nothing is mocked.
//
// Reproduces the reported failure ("The extraction model is busy right now")
// against a real DOCX contract matching the documented sample, and against a
// real invoice, so BOTH registered schemas are exercised end to end.
//
// It prints the server's own error code and detail verbatim, so a failure is
// diagnosable from the output rather than guessed at. Document ids are
// truncated: an id is a capability.
//
//   npm run dev                                     # in another terminal
//   node tests/live/verify-extraction-live.mjs
//   BASE_URL=https://model-switcher.vercel.app node tests/live/verify-extraction-live.mjs

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const CONVERSATION_ID = `extract-${Date.now().toString(36)}`;

let pass = 0;
let fail = 0;
const log = (ok, name, detail) => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== undefined ? "  " + detail : ""}`);
};

/**
 * The documented Project 4 sample contract, as a real .docx.
 *
 * Values match the brief exactly so the extraction can be checked against
 * known answers rather than judged by eye.
 */
async function buildContractDocx() {
  const { Document, HeadingLevel, Packer, Paragraph } = await import("docx");
  const document = new Document({
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, text: "Services Agreement" }),
          new Paragraph(
            "This Services Agreement is entered into between Cedar Bridge Solutions Ltd. (the Client) and Northstar Digital Works LLC (the Provider).",
          ),
          new Paragraph({ heading: HeadingLevel.HEADING_2, text: "Term" }),
          new Paragraph(
            "The agreement starts on 1 November 2026 and ends on 31 October 2027, a duration of 12 months.",
          ),
          new Paragraph({ heading: HeadingLevel.HEADING_2, text: "Fees" }),
          new Paragraph("The total fee is USD 4,800. Payment terms are Net 45."),
          new Paragraph({ heading: HeadingLevel.HEADING_2, text: "Termination" }),
          new Paragraph("Either party may terminate this agreement on 60 days' written notice."),
          new Paragraph({ heading: HeadingLevel.HEADING_2, text: "Governing law" }),
          new Paragraph("This agreement is governed by the laws of Example State."),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(document));
}

/** A real invoice, as a .docx, so the Invoice schema is tested on its own fixture. */
async function buildInvoiceDocx() {
  const { Document, HeadingLevel, Packer, Paragraph } = await import("docx");
  const document = new Document({
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, text: "Invoice" }),
          new Paragraph("From: Northstar Digital Works LLC"),
          new Paragraph("Bill to: Cedar Bridge Solutions Ltd."),
          new Paragraph("Invoice number: INV-2026-0912"),
          new Paragraph("Issue date: 2026-11-05"),
          new Paragraph("Due date: 2026-12-20"),
          new Paragraph("Currency: USD"),
          new Paragraph({ heading: HeadingLevel.HEADING_2, text: "Line items" }),
          new Paragraph("Discovery workshop: quantity 2, unit price 600.00, amount 1200.00"),
          new Paragraph("Implementation sprint: quantity 3, unit price 1000.00, amount 3000.00"),
          new Paragraph({ heading: HeadingLevel.HEADING_2, text: "Totals" }),
          new Paragraph("Subtotal: 4200.00"),
          new Paragraph("Tax: 600.00"),
          new Paragraph("Total: 4800.00"),
          new Paragraph("Notes: Payment terms are Net 45."),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(document));
}

const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function upload(bytes, filename) {
  const form = new FormData();
  form.append("conversationId", CONVERSATION_ID);
  form.append("file", new File([bytes], filename, { type: DOCX_TYPE }));
  const response = await fetch(`${BASE_URL}/api/documents`, { method: "POST", body: form });
  const body = await response.json().catch(() => null);
  return { response, body };
}

async function extract(documentId, schema) {
  const started = Date.now();
  const response = await fetch(`${BASE_URL}/api/extract`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ documentId, conversationId: CONVERSATION_ID, schema }),
  });
  const body = await response.json().catch(() => null);
  return { response, body, ms: Date.now() - started };
}

async function remove(documentId) {
  await fetch(
    `${BASE_URL}/api/documents?id=${encodeURIComponent(documentId)}&conversationId=${encodeURIComponent(CONVERSATION_ID)}`,
    { method: "DELETE" },
  ).catch(() => {});
}

/** Case-insensitive "does the extracted value say this?" */
const says = (value, expected) =>
  typeof value === "string" && value.toLowerCase().includes(expected.toLowerCase());

async function main() {
  console.log(`Live extraction run against ${BASE_URL}, conversation ${CONVERSATION_ID}\n`);

  const ids = [];
  try {
    /* ----------------------------------------------------- the contract -- */

    const contractBytes = await buildContractDocx();
    const contract = await upload(contractBytes, "Project4_Sample_Contract.docx");
    log(contract.response.ok, `contract .docx uploaded and indexed (${contract.response.status})`);
    if (!contract.response.ok) {
      console.log("  response:", JSON.stringify(contract.body));
      return;
    }
    ids.push(contract.body.document.id);
    console.log(`  kind=${contract.body.document.kind} sections=${contract.body.document.sections}\n`);

    const contractResult = await extract(contract.body.document.id, "contract");
    log(
      contractResult.response.ok,
      `CONTRACT extraction (${contractResult.response.status})`,
      `${contractResult.ms} ms`,
    );
    if (!contractResult.response.ok) {
      // The point of this script: show the server's own words, not a guess.
      console.log(`  code:   ${contractResult.body?.code}`);
      console.log(`  detail: ${contractResult.body?.detail}\n`);
    } else {
      const d = contractResult.body.result.data;
      console.log(`  model: ${contractResult.body.result.model}`);
      console.log(`  data:  ${JSON.stringify(d, null, 2).split("\n").join("\n  ")}\n`);

      // Every value the brief lists as an expected contract output.
      log(says(d.client, "Cedar Bridge"), "Client = Cedar Bridge Solutions Ltd.", String(d.client));
      log(says(d.provider, "Northstar"), "Provider = Northstar Digital Works LLC", String(d.provider));
      log(
        says(d.effectiveDate, "2026-11-01") || says(d.effectiveDate, "1 November 2026"),
        "Start date = 1 November 2026",
        String(d.effectiveDate),
      );
      log(
        says(d.endDate, "2027-10-31") || says(d.endDate, "31 October 2027"),
        "End date = 31 October 2027",
        String(d.endDate),
      );
      log(says(d.termLength, "12"), "Duration = 12 months", String(d.termLength));
      log(d.totalFee === 4800, "Total fee = 4800", String(d.totalFee));
      log(d.currency === "USD", "Currency = USD", String(d.currency));
      log(says(d.paymentTerms, "45"), "Payment terms = Net 45", String(d.paymentTerms));
      log(says(d.terminationNotice, "60"), "Termination notice = 60 days", String(d.terminationNotice));
      log(says(d.governingLaw, "Example State"), "Governing law = Example State", String(d.governingLaw));
    }

    /* ------------------------------------------------------ the invoice -- */

    const invoiceBytes = await buildInvoiceDocx();
    const invoice = await upload(invoiceBytes, "Project4_Sample_Invoice.docx");
    log(invoice.response.ok, `invoice .docx uploaded and indexed (${invoice.response.status})`);
    if (!invoice.response.ok) {
      console.log("  response:", JSON.stringify(invoice.body));
      return;
    }
    ids.push(invoice.body.document.id);

    const invoiceResult = await extract(invoice.body.document.id, "invoice");
    log(
      invoiceResult.response.ok,
      `INVOICE extraction (${invoiceResult.response.status})`,
      `${invoiceResult.ms} ms`,
    );
    if (!invoiceResult.response.ok) {
      console.log(`  code:   ${invoiceResult.body?.code}`);
      console.log(`  detail: ${invoiceResult.body?.detail}\n`);
    } else {
      const d = invoiceResult.body.result.data;
      console.log(`  data:  ${JSON.stringify(d, null, 2).split("\n").join("\n  ")}\n`);
      log(says(d.invoiceNumber, "INV-2026-0912"), "invoice number found", String(d.invoiceNumber));
      log(d.total === 4800, "total found", String(d.total));
      log(d.subtotal === 4200, "subtotal found", String(d.subtotal));
      log(d.tax === 600, "tax found", String(d.tax));
      log(d.currency === "USD", "currency found", String(d.currency));
      log(
        Array.isArray(d.lineItems) && d.lineItems.length === 2,
        "both line items found",
        String(d.lineItems?.length),
      );
      log(
        (invoiceResult.body.result.warnings ?? []).length === 0,
        "arithmetic audit clean",
        JSON.stringify(invoiceResult.body.result.warnings),
      );
    }
  } finally {
    for (const id of ids) await remove(id);
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
