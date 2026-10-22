import { z } from "zod";

/**
 * Project 4, Milestone 4: structured extraction.
 *
 * The Zod schema is the single source of truth, used three times over:
 * it is converted to a JSON Schema that CONSTRAINS the model's output, it
 * VALIDATES what actually comes back, and it describes the table the result
 * is rendered into. One definition, so the three can never drift apart.
 *
 * Two deliberate choices run through every schema here.
 *
 * Every extracted field is NULLABLE. A model asked for an invoice number
 * will invent one rather than return nothing, and a plausible invented value
 * is far more damaging than an obvious blank -- so "not present in this
 * document" is a first-class answer the schema can express, the prompt
 * demands it, and the table shows it as "not found" rather than hiding the
 * row.
 *
 * And nothing here is strict about FORMAT. A date that arrives as
 * "5 January 2024" instead of "2024-01-05" is a formatting imperfection, not
 * a reason to throw away a whole correct extraction; Zod checks structure,
 * and `auditExtraction` reports the rest as warnings the user can see.
 */

/* ------------------------------------------------------------- schemas --- */

const sourceRefs = z
  .array(z.string())
  .describe(
    'Where in the document the values came from, using the exact section labels given in the source text (for example "p. 2" or "Sheet1!A12:F31").',
  );

const lineItem = z.object({
  description: z.string().nullable().describe("What the line is for, as written."),
  quantity: z.number().nullable().describe("Quantity, if stated. null if not stated."),
  unitPrice: z.number().nullable().describe("Price per unit, as a number without a currency symbol."),
  amount: z.number().nullable().describe("Line total, as a number without a currency symbol."),
});

const invoiceSchema = z.object({
  vendorName: z.string().nullable().describe("The company or person issuing the invoice."),
  billedTo: z.string().nullable().describe("The company or person being billed."),
  invoiceNumber: z.string().nullable().describe("The invoice's own reference number."),
  issueDate: z.string().nullable().describe("Date of issue, ISO 8601 (YYYY-MM-DD) if it can be determined."),
  dueDate: z.string().nullable().describe("Payment due date, ISO 8601 (YYYY-MM-DD) if it can be determined."),
  currency: z.string().nullable().describe('ISO 4217 code such as "USD", "EUR", "GBP".'),
  lineItems: z.array(lineItem).describe("Every billed line. An empty array if the document has none."),
  subtotal: z.number().nullable().describe("Total before tax, as a number."),
  tax: z.number().nullable().describe("Tax or VAT amount, as a number."),
  total: z.number().nullable().describe("Amount payable, as a number."),
  notes: z.string().nullable().describe("Payment terms or other notes, if present."),
  sourceRefs,
});

const contractSchema = z.object({
  title: z.string().nullable().describe("The agreement's title."),
  parties: z.array(z.string()).describe("Every named party to the agreement."),
  effectiveDate: z.string().nullable().describe("When the agreement starts, ISO 8601 if determinable."),
  termLength: z.string().nullable().describe('Duration as written, e.g. "12 months".'),
  autoRenews: z.boolean().nullable().describe("Whether it renews automatically. null if the document does not say."),
  terminationNotice: z.string().nullable().describe('Notice required to terminate, e.g. "30 days".'),
  governingLaw: z.string().nullable().describe("The jurisdiction whose law governs."),
  paymentTerms: z.string().nullable().describe("Payment terms as written."),
  keyObligations: z.array(z.string()).describe("The principal obligations, one per entry."),
  sourceRefs,
});

/* ------------------------------------------------------------ registry --- */

export type ExtractionSchemaId = "invoice" | "contract";

export type FieldKind = "text" | "number" | "date" | "boolean" | "list";

export type FieldSpec = {
  key: string;
  label: string;
  kind: FieldKind;
};

export type TableSpec = {
  key: string;
  label: string;
  columns: { key: string; label: string; kind: FieldKind }[];
};

export type ExtractionSchema = {
  id: ExtractionSchemaId;
  label: string;
  /** Shown in the picker, so the choice is informed rather than a guess. */
  description: string;
  schema: z.ZodType;
  /** Scalar fields, in display order. */
  fields: FieldSpec[];
  /** The repeating section, when the schema has one. */
  table?: TableSpec;
};

export const EXTRACTION_SCHEMAS: Record<ExtractionSchemaId, ExtractionSchema> = {
  invoice: {
    id: "invoice",
    label: "Invoice",
    description: "Vendor, dates, line items and totals, with the arithmetic checked.",
    schema: invoiceSchema,
    fields: [
      { key: "vendorName", label: "Vendor", kind: "text" },
      { key: "billedTo", label: "Billed to", kind: "text" },
      { key: "invoiceNumber", label: "Invoice number", kind: "text" },
      { key: "issueDate", label: "Issue date", kind: "date" },
      { key: "dueDate", label: "Due date", kind: "date" },
      { key: "currency", label: "Currency", kind: "text" },
      { key: "subtotal", label: "Subtotal", kind: "number" },
      { key: "tax", label: "Tax", kind: "number" },
      { key: "total", label: "Total", kind: "number" },
      { key: "notes", label: "Notes", kind: "text" },
    ],
    table: {
      key: "lineItems",
      label: "Line items",
      columns: [
        { key: "description", label: "Description", kind: "text" },
        { key: "quantity", label: "Qty", kind: "number" },
        { key: "unitPrice", label: "Unit price", kind: "number" },
        { key: "amount", label: "Amount", kind: "number" },
      ],
    },
  },
  contract: {
    id: "contract",
    label: "Contract",
    description: "Parties, dates, term, termination and governing law.",
    schema: contractSchema,
    fields: [
      { key: "title", label: "Title", kind: "text" },
      { key: "parties", label: "Parties", kind: "list" },
      { key: "effectiveDate", label: "Effective date", kind: "date" },
      { key: "termLength", label: "Term", kind: "text" },
      { key: "autoRenews", label: "Auto-renews", kind: "boolean" },
      { key: "terminationNotice", label: "Termination notice", kind: "text" },
      { key: "governingLaw", label: "Governing law", kind: "text" },
      { key: "paymentTerms", label: "Payment terms", kind: "text" },
      { key: "keyObligations", label: "Key obligations", kind: "list" },
    ],
  },
};

export const EXTRACTION_SCHEMA_IDS = Object.keys(EXTRACTION_SCHEMAS) as ExtractionSchemaId[];

export function isExtractionSchemaId(value: unknown): value is ExtractionSchemaId {
  return typeof value === "string" && Object.hasOwn(EXTRACTION_SCHEMAS, value);
}

export type InvoiceExtraction = z.infer<typeof invoiceSchema>;
export type ContractExtraction = z.infer<typeof contractSchema>;
export type ExtractionData = Record<string, unknown>;

/* -------------------------------------------------------------- audit ---- */

/**
 * Checks an extraction against ITSELF, after Zod has confirmed its shape.
 *
 * This is the part that matters most, and the part a schema alone cannot do.
 * Zod proves `total` is a number; it cannot prove it is the RIGHT number.
 * An extraction whose line items do not add up to its subtotal, or whose
 * subtotal plus tax is not its total, has misread something -- and silently
 * presenting those figures in a tidy table is exactly how a wrong number
 * gets trusted.
 *
 * These are reported as warnings rather than failures: the document itself
 * may legitimately not add up (rounding, a discount line, a partial credit),
 * and refusing to show a real extraction because of that would be wrong too.
 * The user sees the numbers AND the discrepancy.
 */
export type ExtractionWarning = { field: string; message: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Half a cent: tolerates float noise, catches real mismatches. */
const MONEY_EPSILON = 0.005;

export function auditExtraction(
  schemaId: ExtractionSchemaId,
  data: ExtractionData,
): ExtractionWarning[] {
  const warnings: ExtractionWarning[] = [];

  for (const field of EXTRACTION_SCHEMAS[schemaId].fields) {
    const value = data[field.key];
    if (field.kind === "date" && typeof value === "string" && value && !ISO_DATE.test(value)) {
      warnings.push({
        field: field.key,
        message: `"${value}" is not an ISO date (YYYY-MM-DD); it is shown exactly as the document gave it.`,
      });
    }
  }

  if (schemaId !== "invoice") return warnings;

  const number = (key: string): number | null => (typeof data[key] === "number" ? (data[key] as number) : null);
  const items = Array.isArray(data.lineItems) ? (data.lineItems as Record<string, unknown>[]) : [];

  const amounts = items
    .map((item) => (typeof item.amount === "number" ? item.amount : null))
    .filter((a): a is number => a !== null);
  const subtotal = number("subtotal");
  const tax = number("tax");
  const total = number("total");

  if (amounts.length > 0 && amounts.length === items.length && subtotal !== null) {
    const summed = amounts.reduce((a, b) => a + b, 0);
    if (Math.abs(summed - subtotal) > MONEY_EPSILON) {
      warnings.push({
        field: "subtotal",
        message: `The line items add up to ${summed.toFixed(2)}, but the subtotal reads ${subtotal.toFixed(2)}.`,
      });
    }
  }

  if (subtotal !== null && total !== null) {
    const expected = subtotal + (tax ?? 0);
    if (Math.abs(expected - total) > MONEY_EPSILON) {
      warnings.push({
        field: "total",
        message: `Subtotal${tax !== null ? " plus tax" : ""} comes to ${expected.toFixed(2)}, but the total reads ${total.toFixed(2)}.`,
      });
    }
  }

  for (const [index, item] of items.entries()) {
    const quantity = typeof item.quantity === "number" ? item.quantity : null;
    const unitPrice = typeof item.unitPrice === "number" ? item.unitPrice : null;
    const amount = typeof item.amount === "number" ? item.amount : null;
    if (quantity !== null && unitPrice !== null && amount !== null) {
      if (Math.abs(quantity * unitPrice - amount) > MONEY_EPSILON) {
        warnings.push({
          field: `lineItems[${index}]`,
          message: `${quantity} x ${unitPrice.toFixed(2)} is ${(quantity * unitPrice).toFixed(2)}, but the line reads ${amount.toFixed(2)}.`,
        });
      }
    }
  }

  return warnings;
}

/* ------------------------------------------------------------ display ---- */

/** How many of a schema's scalar fields the document actually yielded. */
export function countFound(schemaId: ExtractionSchemaId, data: ExtractionData): {
  found: number;
  total: number;
} {
  const fields = EXTRACTION_SCHEMAS[schemaId].fields;
  const found = fields.filter((field) => {
    const value = data[field.key];
    if (value === null || value === undefined) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "string") return value.trim().length > 0;
    return true;
  }).length;
  return { found, total: fields.length };
}

/** Renders one value for a table cell. Never invents a placeholder value. */
export function formatFieldValue(value: unknown, kind: FieldKind): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((v) => String(v)).join("; ");
  if (kind === "boolean") return value === true ? "Yes" : value === false ? "No" : "";
  if (kind === "number" && typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  return String(value);
}

export type ExtractionResult = {
  schemaId: ExtractionSchemaId;
  documentId: string;
  filename: string;
  data: ExtractionData;
  warnings: ExtractionWarning[];
  /** The model that produced it, for the record. Never a key. */
  model: string;
  extractedAt: number;
};
