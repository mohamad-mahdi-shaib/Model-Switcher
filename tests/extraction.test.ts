import { test } from "node:test";
import assert from "node:assert/strict";
import {
  auditExtraction,
  countFound,
  EXTRACTION_SCHEMAS,
  EXTRACTION_SCHEMA_IDS,
  formatFieldValue,
  isExtractionSchemaId,
  type ExtractionData,
  type ExtractionResult,
} from "@/lib/extraction";
import { buildExtractionJson, buildExtractionSheets } from "@/lib/extraction-download";
import {
  buildDocumentText,
  classifyProviderFailure,
  fallbackModels,
  toGeminiJsonSchema,
} from "@/server/extract/run";
import type { StoredDocument } from "@/server/documents/store";
import { z } from "zod";

/**
 * Project 4, Milestone 4: the extraction schema, its self-audit, the JSON
 * Schema sent to the model, and the files produced from a result.
 *
 * No network: everything here is the deterministic half of extraction --
 * what is asked for, what is accepted, what is flagged, and what is written
 * out. The model call itself is covered by the route tests (validation up to
 * the point it would leave the process) and by live verification.
 */

const invoice = (overrides: Partial<ExtractionData> = {}): ExtractionData => ({
  vendorName: "Northwind Ltd",
  billedTo: "Acme Corp",
  invoiceNumber: "INV-2024-0042",
  issueDate: "2024-03-01",
  dueDate: "2024-03-31",
  currency: "USD",
  lineItems: [
    { description: "Consulting", quantity: 10, unitPrice: 100, amount: 1000 },
    { description: "Licence", quantity: 2, unitPrice: 250, amount: 500 },
  ],
  subtotal: 1500,
  tax: 300,
  total: 1800,
  notes: "Net 30",
  sourceRefs: ["p. 1"],
  ...overrides,
});

/* ------------------------------------------------------ schema contract -- */

test("a well-formed invoice passes validation", () => {
  const result = EXTRACTION_SCHEMAS.invoice.schema.safeParse(invoice());
  assert.equal(result.success, true);
});

test("nulls are first-class: an invoice with nothing found still validates", () => {
  const empty = {
    vendorName: null,
    billedTo: null,
    invoiceNumber: null,
    issueDate: null,
    dueDate: null,
    currency: null,
    lineItems: [],
    subtotal: null,
    tax: null,
    total: null,
    notes: null,
    sourceRefs: [],
  };
  const result = EXTRACTION_SCHEMAS.invoice.schema.safeParse(empty);
  assert.equal(result.success, true, JSON.stringify(result.error?.issues));
});

test("a missing field fails validation rather than defaulting", () => {
  const { total: _total, ...withoutTotal } = invoice();
  void _total;
  assert.equal(EXTRACTION_SCHEMAS.invoice.schema.safeParse(withoutTotal).success, false);
});

test("a total that arrives as a STRING is rejected, not coerced", () => {
  // The whole point of validating: "1,800.00" reaching a spreadsheet as text
  // silently breaks every sum built on it.
  assert.equal(EXTRACTION_SCHEMAS.invoice.schema.safeParse(invoice({ total: "1800" })).success, false);
});

test("an unexpected extra field is STRIPPED, so nothing unvetted reaches the table or the download", () => {
  // Zod objects strip unknown keys rather than failing, and that is the
  // behaviour wanted here: a model that volunteers an extra field should not
  // destroy an otherwise-correct extraction, but the field must not survive
  // into the UI or the exported file either. The schema still tells the
  // model not to send them -- see the additionalProperties assertion below.
  const parsed = EXTRACTION_SCHEMAS.invoice.schema.safeParse({
    ...invoice(),
    approvedBy: "someone",
  });
  assert.equal(parsed.success, true);
  assert.equal(
    Object.hasOwn(parsed.data as object, "approvedBy"),
    false,
    "the extra key must not survive validation",
  );
});

test("the schema sent to the model forbids extra properties in the first place", () => {
  const json = toGeminiJsonSchema(z.toJSONSchema(EXTRACTION_SCHEMAS.invoice.schema)) as {
    additionalProperties?: boolean;
    properties: { lineItems: { items: { additionalProperties?: boolean } } };
  };
  assert.equal(json.additionalProperties, false);
  assert.equal(json.properties.lineItems.items.additionalProperties, false);
});

test("every registered schema is self-consistent: its fields exist in its own shape", () => {
  for (const id of EXTRACTION_SCHEMA_IDS) {
    const spec = EXTRACTION_SCHEMAS[id];
    const json = z.toJSONSchema(spec.schema) as { properties?: Record<string, unknown> };
    const properties = Object.keys(json.properties ?? {});
    for (const field of spec.fields) {
      assert.ok(properties.includes(field.key), `${id}.${field.key} is not in the schema`);
    }
    if (spec.table) {
      assert.ok(properties.includes(spec.table.key), `${id}.${spec.table.key} is not in the schema`);
    }
  }
});

test("schema ids are validated against own properties only", () => {
  assert.equal(isExtractionSchemaId("invoice"), true);
  assert.equal(isExtractionSchemaId("contract"), true);
  assert.equal(isExtractionSchemaId("receipt"), false);
  // The prototype-pollution trap this project has hit before.
  assert.equal(isExtractionSchemaId("constructor"), false);
  assert.equal(isExtractionSchemaId("__proto__"), false);
  assert.equal(isExtractionSchemaId("toString"), false);
});

/* ----------------------------------------------- the schema sent to Gemini */

test("the JSON Schema drops $schema and rewrites union types as anyOf", () => {
  const json = toGeminiJsonSchema(z.toJSONSchema(EXTRACTION_SCHEMAS.invoice.schema)) as {
    $schema?: unknown;
    properties: Record<string, { anyOf?: { type: string }[]; type?: unknown }>;
  };
  assert.equal(json.$schema, undefined, "$schema is not in Gemini's accepted keyword list");
  assert.deepEqual(json.properties.vendorName.anyOf, [{ type: "string" }, { type: "null" }]);
  assert.equal(
    Array.isArray(json.properties.vendorName.type),
    false,
    "an array-valued `type` must not survive",
  );
});

test("the rewrite reaches nested array item schemas", () => {
  const json = toGeminiJsonSchema(z.toJSONSchema(EXTRACTION_SCHEMAS.invoice.schema)) as {
    properties: { lineItems: { items: { properties: Record<string, { anyOf?: unknown[] }> } } };
  };
  const item = json.properties.lineItems.items.properties;
  assert.deepEqual(item.quantity.anyOf, [{ type: "number" }, { type: "null" }]);
  assert.deepEqual(item.description.anyOf, [{ type: "string" }, { type: "null" }]);
});

test("field descriptions survive the rewrite -- they are what tells the model what to look for", () => {
  const json = toGeminiJsonSchema(z.toJSONSchema(EXTRACTION_SCHEMAS.invoice.schema)) as {
    properties: Record<string, { description?: string }>;
  };
  assert.match(json.properties.currency.description ?? "", /ISO 4217/);
  assert.match(json.properties.invoiceNumber.description ?? "", /reference number/);
});

test("no array-valued `type` remains anywhere in any schema", () => {
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      assert.ok(!(key === "type" && Array.isArray(value)), "found an array-valued type");
      walk(value);
    }
  };
  for (const id of EXTRACTION_SCHEMA_IDS) {
    walk(toGeminiJsonSchema(z.toJSONSchema(EXTRACTION_SCHEMAS[id].schema)));
  }
});

/* ------------------------------------------------------------- the audit - */

test("an invoice whose arithmetic holds produces no warnings", () => {
  assert.deepEqual(auditExtraction("invoice", invoice()), []);
});

test("line items that do not add up to the subtotal are flagged", () => {
  const warnings = auditExtraction("invoice", invoice({ subtotal: 1400, total: 1700 }));
  const subtotalWarning = warnings.find((w) => w.field === "subtotal");
  assert.ok(subtotalWarning, JSON.stringify(warnings));
  assert.match(subtotalWarning.message, /1500\.00/);
  assert.match(subtotalWarning.message, /1400\.00/);
});

test("a subtotal plus tax that does not equal the total is flagged", () => {
  const warnings = auditExtraction("invoice", invoice({ total: 1750 }));
  const totalWarning = warnings.find((w) => w.field === "total");
  assert.ok(totalWarning, JSON.stringify(warnings));
  assert.match(totalWarning.message, /1800\.00/);
});

test("a line whose quantity times unit price is not its amount is flagged, by index", () => {
  const warnings = auditExtraction(
    "invoice",
    invoice({
      lineItems: [
        { description: "Consulting", quantity: 10, unitPrice: 100, amount: 1000 },
        { description: "Licence", quantity: 2, unitPrice: 250, amount: 900 },
      ],
      subtotal: 1900,
      total: 2200,
    }),
  );
  assert.ok(warnings.some((w) => w.field === "lineItems[1]"), JSON.stringify(warnings));
  assert.equal(warnings.some((w) => w.field === "lineItems[0]"), false, "the correct line is not flagged");
});

test("float noise does not produce a false alarm", () => {
  const warnings = auditExtraction(
    "invoice",
    invoice({
      lineItems: [{ description: "Service", quantity: 3, unitPrice: 0.1, amount: 0.30000000000000004 }],
      subtotal: 0.3,
      tax: 0,
      total: 0.3,
    }),
  );
  assert.deepEqual(warnings, []);
});

test("a real one-cent discrepancy IS reported", () => {
  const warnings = auditExtraction("invoice", invoice({ total: 1800.01 }));
  assert.ok(warnings.some((w) => w.field === "total"), JSON.stringify(warnings));
});

test("partial line data does not trigger a sum check it cannot make", () => {
  // One line has no amount, so the lines cannot be summed -- staying silent
  // is correct; a warning here would be noise on a perfectly good extraction.
  const warnings = auditExtraction(
    "invoice",
    invoice({
      lineItems: [
        { description: "Consulting", quantity: null, unitPrice: null, amount: 1000 },
        { description: "Licence", quantity: null, unitPrice: null, amount: null },
      ],
      subtotal: 1500,
      tax: 300,
      total: 1800,
    }),
  );
  assert.equal(warnings.some((w) => w.field === "subtotal"), false, JSON.stringify(warnings));
});

test("a non-ISO date is reported as a formatting note, not a failure", () => {
  const warnings = auditExtraction("invoice", invoice({ issueDate: "5 January 2024" }));
  const dateWarning = warnings.find((w) => w.field === "issueDate");
  assert.ok(dateWarning);
  assert.match(dateWarning.message, /exactly as the document gave it/);
});

test("a missing tax is treated as zero rather than blocking the total check", () => {
  const warnings = auditExtraction("invoice", invoice({ tax: null, total: 1500 }));
  assert.deepEqual(warnings, []);
});

test("the contract schema audits dates without inventing invoice rules", () => {
  const warnings = auditExtraction("contract", {
    title: "Services Agreement",
    parties: ["A", "B"],
    effectiveDate: "January 2024",
    termLength: "12 months",
    autoRenews: true,
    terminationNotice: "30 days",
    governingLaw: "England and Wales",
    paymentTerms: "Net 30",
    keyObligations: ["Deliver", "Pay"],
    sourceRefs: ["p. 1"],
  });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].field, "effectiveDate");
});

/* ------------------------------------------------------------- display --- */

test("the found/total tally counts only fields the document actually yielded", () => {
  const tally = countFound("invoice", invoice({ notes: null, currency: "  ", vendorName: null }));
  assert.equal(tally.total, 10);
  assert.equal(tally.found, 7, "null, blank and whitespace-only all count as not found");
});

test("an empty array counts as not found", () => {
  const tally = countFound("contract", {
    title: "T",
    parties: [],
    effectiveDate: null,
    termLength: null,
    autoRenews: null,
    terminationNotice: null,
    governingLaw: null,
    paymentTerms: null,
    keyObligations: ["one"],
  });
  assert.equal(tally.found, 2);
});

test("values render without inventing placeholders", () => {
  assert.equal(formatFieldValue(null, "text"), "");
  assert.equal(formatFieldValue(undefined, "number"), "");
  assert.equal(formatFieldValue(1800, "number"), "1800");
  assert.equal(formatFieldValue(1800.5, "number"), "1800.50");
  assert.equal(formatFieldValue(true, "boolean"), "Yes");
  assert.equal(formatFieldValue(false, "boolean"), "No");
  assert.equal(formatFieldValue(["A", "B"], "list"), "A; B");
});

/* -------------------------------------------------------- the downloads -- */

const result = (overrides: Partial<ExtractionResult> = {}): ExtractionResult => ({
  schemaId: "invoice",
  documentId: "A".repeat(43),
  filename: "march.pdf",
  data: invoice(),
  warnings: [],
  model: "gemini-test",
  extractedAt: 1_700_000_000_000,
  ...overrides,
});

test("the JSON download parses and records where the data came from", () => {
  const parsed = JSON.parse(buildExtractionJson(result())) as {
    source: { filename: string; schema: string; model: string; extractedAt: string };
    data: Record<string, unknown>;
    warnings: unknown[];
  };
  assert.equal(parsed.source.filename, "march.pdf");
  assert.equal(parsed.source.schema, "invoice");
  assert.equal(parsed.data.total, 1800);
  assert.match(parsed.source.extractedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("the JSON download carries the warnings, not just the values", () => {
  const warned = result({ warnings: [{ field: "total", message: "does not add up" }] });
  const parsed = JSON.parse(buildExtractionJson(warned)) as { warnings: { field: string }[] };
  assert.equal(parsed.warnings.length, 1);
  assert.equal(parsed.warnings[0].field, "total");
});

test("the spreadsheet keeps numbers as NUMBERS so a column can be summed", () => {
  const { fields, lineItems } = buildExtractionSheets(result());
  const totalRow = fields.find((row) => row[0] === "Total");
  assert.equal(typeof totalRow?.[1], "number", "a total written as text breaks every formula built on it");
  assert.equal(totalRow?.[1], 1800);
  assert.ok(lineItems);
  assert.equal(typeof lineItems[1][3], "number");
});

test("the spreadsheet writes a missing value as an empty cell, never as the word null", () => {
  const { fields } = buildExtractionSheets(result({ data: invoice({ notes: null }) }));
  const notesRow = fields.find((row) => row[0] === "Notes");
  assert.equal(notesRow?.[1], null);
  assert.equal(JSON.stringify(fields).includes('"null"'), false);
});

test("the spreadsheet's headers match the schema's own labels and order", () => {
  const { fields, lineItems } = buildExtractionSheets(result());
  assert.deepEqual(fields[0], ["Field", "Value"]);
  assert.deepEqual(
    fields.slice(1).map((row) => row[0]),
    EXTRACTION_SCHEMAS.invoice.fields.map((field) => field.label),
  );
  assert.deepEqual(lineItems?.[0], ["Description", "Qty", "Unit price", "Amount"]);
});

test("a schema with no table produces no line-item sheet", () => {
  const contract = result({
    schemaId: "contract",
    data: {
      title: "Services Agreement",
      parties: ["A", "B"],
      effectiveDate: "2024-01-01",
      termLength: "12 months",
      autoRenews: false,
      terminationNotice: "30 days",
      governingLaw: "England",
      paymentTerms: "Net 30",
      keyObligations: ["Deliver"],
      sourceRefs: [],
    },
  });
  const { fields, lineItems } = buildExtractionSheets(contract);
  assert.equal(lineItems, null);
  const parties = fields.find((row) => row[0] === "Parties");
  assert.equal(parties?.[1], "A; B");
});

test("the warnings sheet exists only when there is something to warn about", () => {
  assert.equal(buildExtractionSheets(result()).warnings.length, 1, "header row only");
  const warned = buildExtractionSheets(result({ warnings: [{ field: "total", message: "mismatch" }] }));
  assert.equal(warned.warnings.length, 2);
  assert.deepEqual(warned.warnings[1], ["total", "mismatch"]);
});

/* --------------------------------------------------- the document prompt -- */

function storedDocument(chunks: { i: number; ref: string; text: string }[]): StoredDocument {
  return {
    id: "A".repeat(43),
    conversationId: "conv-1",
    filename: "march.pdf",
    kind: "pdf",
    bytes: 1000,
    meta: { chars: 100, truncated: false },
    warnings: [],
    uploadedAt: 1,
    embeddingModel: "gemini-embedding-001",
    chunks: chunks.map((chunk) => ({ ...chunk, embedding: [1, 0] })),
  };
}

test("the document is assembled in order, with each section's citation attached", () => {
  // Deliberately out of order: extraction reads a document front to back, and
  // storage order is not guaranteed to be document order.
  const { text, truncated } = buildDocumentText(
    storedDocument([
      { i: 2, ref: "p. 3", text: "third" },
      { i: 0, ref: "p. 1", text: "first" },
      { i: 1, ref: "p. 2", text: "second" },
    ]),
  );
  assert.equal(truncated, false);
  assert.ok(text.indexOf("first") < text.indexOf("second"));
  assert.ok(text.indexOf("second") < text.indexOf("third"));
  assert.match(text, /\[p\. 1\]/);
  assert.match(text, /\[p\. 3\]/);
});

test("a document too long to read in one pass is reported as truncated, not silently cut", () => {
  const chunks = Array.from({ length: 40 }, (_, i) => ({
    i,
    ref: `p. ${i + 1}`,
    text: "x".repeat(5_000),
  }));
  const { text, truncated } = buildDocumentText(storedDocument(chunks));
  assert.equal(truncated, true);
  assert.ok(text.length <= 120_000);
  assert.match(text, /\[p\. 1\]/, "it still starts at the beginning of the document");
});

test("a document with no chunks yields empty text", () => {
  assert.equal(buildDocumentText(storedDocument([])).text, "");
});

/* ------------------------------------------- the spreadsheet, round-tripped */

/**
 * Builds the workbook exactly as `downloadExtractionXlsx` does and reads it
 * back with SheetJS.
 *
 * `downloadExtractionXlsx` itself needs a DOM (Blob, an anchor, object URLs)
 * so it cannot run here -- but the part that could silently be wrong is the
 * FILE, not the click that saves it. This writes real .xlsx bytes and parses
 * them, which is the only way to know the result opens at all and that a
 * total lands in the sheet as a number rather than as text that merely looks
 * like one.
 */
test("the generated workbook is a real .xlsx that parses back with typed cells", async () => {
  const XLSX = await import("xlsx");
  const { fields, lineItems, warnings } = buildExtractionSheets(
    result({ warnings: [{ field: "total", message: "mismatch" }] }),
  );

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(fields), "Extraction");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(lineItems!), "Line items");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(warnings), "Warnings");
  const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer;

  // A real ZIP container -- "PK" -- which is what makes it an .xlsx at all.
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  assert.ok(bytes.length > 1_000, `suspiciously small: ${bytes.length} bytes`);

  const reopened = XLSX.read(bytes, { type: "buffer" });
  assert.deepEqual(reopened.SheetNames, ["Extraction", "Line items", "Warnings"]);

  const sheet = reopened.Sheets["Extraction"];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { header: 1 }) as unknown as unknown[][];
  const totalRow = rows.find((row) => row[0] === "Total");
  assert.equal(totalRow?.[1], 1800);
  assert.equal(typeof totalRow?.[1], "number", "the cell must be numeric after a round trip, not text");

  // The cell's own type code: "n" is numeric, "s" would be a string.
  const totalIndex = rows.findIndex((row) => row[0] === "Total");
  const cell = sheet[XLSX.utils.encode_cell({ r: totalIndex, c: 1 })] as { t?: string } | undefined;
  assert.equal(cell?.t, "n");

  const items = XLSX.utils.sheet_to_json<Record<string, unknown>>(reopened.Sheets["Line items"]);
  assert.equal(items.length, 2);
  assert.equal(items[0]["Amount"], 1000);

  const warningRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(reopened.Sheets["Warnings"]);
  assert.equal(warningRows[0]["Warning"], "mismatch");
});

test("a missing value leaves a genuinely empty cell in the reopened file", async () => {
  const XLSX = await import("xlsx");
  const { fields } = buildExtractionSheets(result({ data: invoice({ notes: null }) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(fields), "Extraction");
  const reopened = XLSX.read(XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }), {
    type: "buffer",
  });
  const rows = XLSX.utils.sheet_to_json(reopened.Sheets["Extraction"], { header: 1 }) as unknown[][];
  const notesRow = rows.find((row) => row[0] === "Notes");
  assert.equal(notesRow?.[1] ?? "", "", 'an unfound value must not reach the sheet as "null"');
});

/* ------------------------------- provider failure classification (the fix) */

/**
 * The bug these guard against, exactly as reported: every provider failure
 * collapsed into one sentence, "The extraction model is busy right now", and
 * extraction made a single attempt with no retry. Chat recovered from the
 * same 503 because `/api/chat` retries; extraction did not, so the feature
 * looked permanently broken while chat read the same file fine.
 */

test("the REAL 503 that broke extraction is classified as retryable capacity", () => {
  // Captured verbatim from the live failure during diagnosis.
  const real =
    '{"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}';
  const failure = classifyProviderFailure(real);
  assert.equal(failure.code, "BUSY");
  assert.equal(failure.retryable, true, "a capacity failure must be retried, which is what was missing");
  assert.equal(failure.tryFallback, true);
});

test("an auth failure is never retried and never falls back", () => {
  for (const message of [
    '{"error":{"code":403,"message":"Permission denied","status":"PERMISSION_DENIED"}}',
    "API key not valid. Please pass a valid API key.",
    '{"error":{"code":401,"message":"Unauthenticated"}}',
  ]) {
    const failure = classifyProviderFailure(message);
    assert.equal(failure.code, "AUTH", message);
    assert.equal(failure.retryable, false, "retrying a rejected key only wastes calls");
    assert.equal(failure.tryFallback, false, "every model shares the one key");
  }
});

test("a quota failure is not retried on the same model, but may try the fallback", () => {
  for (const message of [
    '{"error":{"code":429,"message":"Resource has been exhausted","status":"RESOURCE_EXHAUSTED"}}',
    "You exceeded your current quota.",
  ]) {
    const failure = classifyProviderFailure(message);
    assert.equal(failure.code, "RATE_LIMITED", message);
    assert.equal(failure.retryable, false, "a rate limit is telling you to stop, not to repeat");
    assert.equal(failure.tryFallback, true, "Gemini quotas are per model, so another model has its own");
  }
});

test("a rejected request is classified as unsupported, not as capacity", () => {
  for (const message of [
    '{"error":{"code":400,"message":"Invalid JSON payload","status":"INVALID_ARGUMENT"}}',
    '{"error":{"code":404,"message":"models/does-not-exist is not found for API version v1beta"}}',
    "responseJsonSchema is not supported for this model",
  ]) {
    const failure = classifyProviderFailure(message);
    assert.equal(failure.code, "UNSUPPORTED", message);
    assert.equal(failure.retryable, false);
    // A model that cannot do structured output has siblings that can.
    assert.equal(failure.tryFallback, true);
  }
});

test("an unclassified transport fault is retryable", () => {
  // Observed live: a dropped TLS connection carries no status code at all,
  // and the very next attempt succeeds.
  const failure = classifyProviderFailure("fetch failed");
  assert.equal(failure.code, "UPSTREAM");
  assert.equal(failure.retryable, true);
});

test("a permanent failure is matched even when its body mentions unavailability", () => {
  // Ordering matters: "unavailable" appears in plenty of permanent errors,
  // and treating one as capacity would retry something that cannot recover.
  const failure = classifyProviderFailure(
    '{"error":{"code":403,"message":"Permission denied: the model is unavailable to this project"}}',
  );
  assert.equal(failure.code, "AUTH");
  assert.equal(failure.retryable, false);
});

test("no permanent failure is reported with the old catch-all busy sentence", () => {
  for (const message of [
    '{"error":{"code":403,"message":"Permission denied"}}',
    '{"error":{"code":429,"message":"Quota exceeded"}}',
    '{"error":{"code":400,"message":"Invalid argument"}}',
  ]) {
    const failure = classifyProviderFailure(message);
    assert.doesNotMatch(
      failure.detail,
      /busy right now/i,
      "a permanent failure must not be reported as a temporary one",
    );
  }
});

/* ------------------------------------------------- the fallback policy --- */

test("a fallback model is offered by default, and is not the primary", () => {
  const models = fallbackModels("gemini-3.6-flash");
  assert.equal(models.length, 1);
  assert.notEqual(models[0], "gemini-3.6-flash");
});

test("the fallback is configurable, and can be disabled", () => {
  const previous = process.env.GEMINI_EXTRACTION_FALLBACK_MODEL;
  try {
    process.env.GEMINI_EXTRACTION_FALLBACK_MODEL = "gemini-3.1-flash-lite";
    assert.deepEqual(fallbackModels("gemini-3.6-flash"), ["gemini-3.1-flash-lite"]);

    // Empty disables it entirely.
    process.env.GEMINI_EXTRACTION_FALLBACK_MODEL = "";
    assert.deepEqual(fallbackModels("gemini-3.6-flash"), []);

    // Naming the primary disables it too, rather than calling it twice.
    process.env.GEMINI_EXTRACTION_FALLBACK_MODEL = "gemini-3.6-flash";
    assert.deepEqual(fallbackModels("gemini-3.6-flash"), []);
  } finally {
    if (previous === undefined) delete process.env.GEMINI_EXTRACTION_FALLBACK_MODEL;
    else process.env.GEMINI_EXTRACTION_FALLBACK_MODEL = previous;
  }
});

/* --------------------------------- the contract schema's required fields -- */

test("the contract schema carries every field the brief asks to extract", () => {
  const properties = Object.keys(
    (z.toJSONSchema(EXTRACTION_SCHEMAS.contract.schema) as { properties: Record<string, unknown> })
      .properties,
  );
  for (const key of [
    "client",
    "provider",
    "effectiveDate",
    "endDate",
    "termLength",
    "totalFee",
    "currency",
    "paymentTerms",
    "terminationNotice",
    "governingLaw",
  ]) {
    assert.ok(properties.includes(key), `contract schema is missing ${key}`);
  }
});

test("a fully populated contract validates, and a sparse one does too", () => {
  const full = {
    title: "Services Agreement",
    client: "Cedar Bridge Solutions Ltd.",
    provider: "Northstar Digital Works LLC",
    parties: ["Cedar Bridge Solutions Ltd.", "Northstar Digital Works LLC"],
    effectiveDate: "2026-11-01",
    endDate: "2027-10-31",
    termLength: "12 months",
    totalFee: 4800,
    currency: "USD",
    autoRenews: null,
    terminationNotice: "60 days",
    governingLaw: "Example State",
    paymentTerms: "Net 45",
    keyObligations: [],
    sourceRefs: ["Term"],
  };
  assert.equal(EXTRACTION_SCHEMAS.contract.schema.safeParse(full).success, true);

  // Nullable throughout: a document stating none of it still validates.
  const sparse: Record<string, unknown> = { ...full };
  for (const key of ["client", "provider", "endDate", "totalFee", "currency", "governingLaw"]) {
    sparse[key] = null;
  }
  assert.equal(EXTRACTION_SCHEMAS.contract.schema.safeParse(sparse).success, true);
});

test("a contract fee arriving as a STRING is rejected, like any other number", () => {
  const result = EXTRACTION_SCHEMAS.contract.schema.safeParse({
    title: null,
    client: null,
    provider: null,
    parties: [],
    effectiveDate: null,
    endDate: null,
    termLength: null,
    totalFee: "4,800",
    currency: null,
    autoRenews: null,
    terminationNotice: null,
    governingLaw: null,
    paymentTerms: null,
    keyObligations: [],
    sourceRefs: [],
  });
  assert.equal(result.success, false);
});
