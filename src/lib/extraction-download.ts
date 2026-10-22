"use client";

import {
  EXTRACTION_SCHEMAS,
  formatFieldValue,
  type ExtractionResult,
} from "@/lib/extraction";

/**
 * Project 4: downloads for an extraction result.
 *
 * Real files, not a `<pre>` the user has to copy: a `.json` that parses and
 * an `.xlsx` that opens in Excel, Numbers and Sheets with typed cells --
 * numbers as numbers, so the spreadsheet can actually sum a column.
 *
 * Both carry the WARNINGS as well as the values. A downloaded file outlives
 * the screen it came from, and an arithmetic discrepancy that was visible in
 * the app but absent from the spreadsheet would be the moment a questionable
 * figure turns into a trusted one.
 */

function filenameStem(result: ExtractionResult): string {
  const base = result.filename.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-");
  return `${base || "extraction"}-${result.schemaId}`;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoked on the next tick rather than immediately: some browsers have not
  // finished reading the blob when click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** The JSON payload, shaped so it documents itself when opened in a text editor. */
export function buildExtractionJson(result: ExtractionResult): string {
  return JSON.stringify(
    {
      source: {
        filename: result.filename,
        schema: result.schemaId,
        extractedAt: new Date(result.extractedAt).toISOString(),
        model: result.model,
      },
      data: result.data,
      warnings: result.warnings,
    },
    null,
    2,
  );
}

export function downloadExtractionJson(result: ExtractionResult): void {
  const blob = new Blob([buildExtractionJson(result)], { type: "application/json" });
  triggerDownload(blob, `${filenameStem(result)}.json`);
}

/**
 * Builds the workbook's sheets as arrays of arrays.
 *
 * Separated from the writing so it can be asserted in a test without a
 * browser: the shape of what lands in the spreadsheet is the part worth
 * pinning down.
 */
export function buildExtractionSheets(result: ExtractionResult): {
  fields: (string | number | boolean | null)[][];
  lineItems: (string | number | boolean | null)[][] | null;
  warnings: string[][];
} {
  const spec = EXTRACTION_SCHEMAS[result.schemaId];

  const fields: (string | number | boolean | null)[][] = [["Field", "Value"]];
  for (const field of spec.fields) {
    const value = result.data[field.key];
    // Numbers stay numbers so the sheet can compute with them; everything
    // else is rendered the same way the table on screen renders it.
    const cell =
      typeof value === "number"
        ? value
        : value === null || value === undefined
          ? null
          : formatFieldValue(value, field.kind);
    fields.push([field.label, cell]);
  }

  let lineItems: (string | number | boolean | null)[][] | null = null;
  if (spec.table) {
    const rows = result.data[spec.table.key];
    if (Array.isArray(rows)) {
      lineItems = [spec.table.columns.map((column) => column.label)];
      for (const row of rows as Record<string, unknown>[]) {
        lineItems.push(
          spec.table.columns.map((column) => {
            const value = row[column.key];
            if (typeof value === "number") return value;
            if (value === null || value === undefined) return null;
            return formatFieldValue(value, column.kind);
          }),
        );
      }
    }
  }

  const warnings: string[][] = [["Field", "Warning"]];
  for (const warning of result.warnings) warnings.push([warning.field, warning.message]);

  return { fields, lineItems, warnings };
}

/**
 * Writes a real .xlsx. SheetJS is loaded on demand -- it is a sizeable
 * dependency and most sessions never download a spreadsheet, so it is kept
 * out of the initial bundle.
 */
export async function downloadExtractionXlsx(result: ExtractionResult): Promise<void> {
  const XLSX = await import("xlsx");
  const { fields, lineItems, warnings } = buildExtractionSheets(result);

  const workbook = XLSX.utils.book_new();
  const fieldSheet = XLSX.utils.aoa_to_sheet(fields);
  fieldSheet["!cols"] = [{ wch: 22 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(workbook, fieldSheet, "Extraction");

  if (lineItems && lineItems.length > 1) {
    const itemSheet = XLSX.utils.aoa_to_sheet(lineItems);
    itemSheet["!cols"] = [{ wch: 44 }, { wch: 8 }, { wch: 12 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(workbook, itemSheet, "Line items");
  }

  // The warnings sheet is only added when there is something to warn about,
  // so an empty sheet never implies "checked and clean" by accident.
  if (warnings.length > 1) {
    const warningSheet = XLSX.utils.aoa_to_sheet(warnings);
    warningSheet["!cols"] = [{ wch: 18 }, { wch: 80 }];
    XLSX.utils.book_append_sheet(workbook, warningSheet, "Warnings");
  }

  const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  triggerDownload(
    new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `${filenameStem(result)}.xlsx`,
  );
}
