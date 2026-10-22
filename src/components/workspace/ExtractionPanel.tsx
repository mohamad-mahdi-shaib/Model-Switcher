"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertIcon, DownloadIcon, FileIcon, LoaderIcon, XIcon } from "@/components/icons";
import {
  countFound,
  EXTRACTION_SCHEMAS,
  EXTRACTION_SCHEMA_IDS,
  formatFieldValue,
  type ExtractionResult,
  type ExtractionSchemaId,
} from "@/lib/extraction";
import { downloadExtractionJson, downloadExtractionXlsx } from "@/lib/extraction-download";
import type { DocumentRef } from "@/lib/documents";

/**
 * Project 4, Milestone 4: the structured-extraction panel.
 *
 * A dialog rather than a transcript card, deliberately. An extraction is a
 * tabular artefact the user reads across and then exports -- a wide table
 * squeezed into the conversation column would be worse at both, and it is
 * not a turn in the conversation: nothing was asked, and no model reply
 * follows it.
 *
 * The same overlay mechanics as `SettingsOverlay` (portal, blurred backdrop,
 * Escape to close, focus trapped and restored), reused rather than
 * reinvented so keyboard behaviour is identical across every dialog here.
 *
 * What the design insists on showing:
 *   - a field the document did not contain reads "not found", in its own
 *     row, instead of being quietly dropped -- the absence IS the finding;
 *   - every arithmetic discrepancy, at the top, before the tidy table that
 *     would otherwise make the numbers look settled;
 *   - which pages the values came from.
 */

const FOCUSABLE_SELECTOR = "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

type ExtractionPanelProps = {
  open: boolean;
  onClose: () => void;
  portalContainer: HTMLElement | null;
  conversationId: string | null;
  documents: readonly DocumentRef[];
};

type Status = "idle" | "running" | "done" | "error";

export function ExtractionPanel({
  open,
  onClose,
  portalContainer,
  conversationId,
  documents,
}: ExtractionPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /**
   * The user's explicit choice, or null for "whatever is first".
   *
   * Resolved at render time (`documentId` below) rather than synced into
   * state by an effect: this project's `react-hooks/set-state-in-effect`
   * rule forbids the latter, and deriving it also means a file removed from
   * the tray while the dialog is open silently falls back to a valid one
   * instead of leaving a selection pointing at nothing.
   */
  const [chosenDocumentId, setChosenDocumentId] = useState<string | null>(null);
  const [schemaId, setSchemaId] = useState<ExtractionSchemaId>("invoice");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractionResult | null>(null);

  const documentId =
    chosenDocumentId && documents.some((d) => d.id === chosenDocumentId)
      ? chosenDocumentId
      : (documents[0]?.id ?? null);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      restoreFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  // A run in flight when the dialog closes is abandoned, not left to resolve
  // into a panel nobody is looking at.
  useEffect(() => {
    if (open) return;
    abortRef.current?.abort();
    abortRef.current = null;
  }, [open]);

  const extract = async () => {
    if (!documentId || !conversationId) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("running");
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId, conversationId, schema: schemaId }),
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => null)) as
        | { result?: ExtractionResult; detail?: string }
        | null;
      if (!response.ok || !payload?.result) {
        setError(payload?.detail ?? "The extraction could not be completed.");
        setStatus("error");
        return;
      }
      setResult(payload.result);
      setStatus("done");
    } catch (caught) {
      if (controller.signal.aborted) return;
      void caught;
      setError("Could not reach the server.");
      setStatus("error");
    }
  };

  if (!open || !portalContainer) return null;

  const spec = EXTRACTION_SCHEMAS[schemaId];
  const selected = documents.find((d) => d.id === documentId) ?? null;
  const tally = result ? countFound(result.schemaId, result.data) : null;
  const refs = result && Array.isArray(result.data.sourceRefs) ? (result.data.sourceRefs as string[]) : [];

  return createPortal(
    <>
      <div aria-hidden="true" className="fixed inset-0 z-40 bg-black/40 backdrop-blur-md" onClick={onClose} />
      <div
        aria-label="Extract structured data"
        aria-modal="true"
        className="glass-modal fixed inset-x-3 bottom-3 z-50 flex max-h-[84vh] flex-col gap-3 overflow-hidden rounded-[26px] p-4 pt-[max(1rem,env(safe-area-inset-bottom))] sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-h-[min(84vh,640px)] sm:w-[min(680px,calc(100vw-48px))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:p-5"
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-white/30 pb-2">
          <div className="flex items-center gap-1.5">
            <FileIcon className="h-3.5 w-3.5 glass-text-dark" />
            <h2 className="text-[12.5px] font-semibold tracking-tight glass-text-dark">
              Extract structured data
            </h2>
          </div>
          <button
            aria-label="Close extraction"
            className="focus-glass flex h-11 w-11 items-center justify-center rounded-full glass-text-dark transition-colors hover:bg-white/20"
            onClick={onClose}
            type="button"
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="glass-scroll min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {documents.length === 0 ? (
            <p className="text-[11.5px] glass-text-subtle">
              Upload a file first — extraction reads a document you have already added to this
              conversation.
            </p>
          ) : (
            <>
              <label className="block space-y-1">
                <span className="text-[10.5px] font-medium tracking-wide uppercase glass-text-subtle">
                  File
                </span>
                <select
                  className="focus-glass glass-btn min-h-11 w-full rounded-xl px-2.5 text-[11.5px] glass-text-dark"
                  onChange={(event) => {
                    setChosenDocumentId(event.target.value);
                    setResult(null);
                    setStatus("idle");
                  }}
                  value={documentId ?? ""}
                >
                  {documents.map((document) => (
                    <option key={document.id} value={document.id}>
                      {document.filename}
                    </option>
                  ))}
                </select>
              </label>

              <div className="space-y-1">
                <span className="text-[10.5px] font-medium tracking-wide uppercase glass-text-subtle">
                  What to extract
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {EXTRACTION_SCHEMA_IDS.map((id) => (
                    <button
                      aria-pressed={schemaId === id}
                      className={`focus-glass min-h-11 rounded-xl px-3 text-[11px] font-medium ${
                        schemaId === id ? "bg-white/25 glass-text-dark" : "glass-btn glass-text-subtle"
                      }`}
                      key={id}
                      onClick={() => {
                        setSchemaId(id);
                        setResult(null);
                        setStatus("idle");
                      }}
                      type="button"
                    >
                      {EXTRACTION_SCHEMAS[id].label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] leading-snug glass-text-subtle">{spec.description}</p>
              </div>

              <button
                className="focus-glass min-h-11 w-full rounded-xl border border-white/80 bg-gradient-to-tr from-white/35 to-white/70 px-3 text-[11.5px] font-medium text-[#1a1c22] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={status === "running" || !documentId || !conversationId}
                onClick={() => void extract()}
                type="button"
              >
                {status === "running" ? (
                  <span className="flex items-center justify-center gap-1.5">
                    <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
                    Reading {selected?.filename ?? "the file"}…
                  </span>
                ) : (
                  `Extract ${spec.label.toLowerCase()} fields`
                )}
              </button>

              {status === "error" && error ? (
                <p
                  className="flex items-start gap-1.5 text-[11px] leading-snug glass-text-dark"
                  role="alert"
                >
                  <AlertIcon className="mt-px h-3 w-3 shrink-0" />
                  <span>{error}</span>
                </p>
              ) : null}

              {result ? (
                <ExtractionReport
                  refs={refs}
                  result={result}
                  tally={tally ?? { found: 0, total: 0 }}
                />
              ) : null}
            </>
          )}
        </div>
      </div>
    </>,
    portalContainer,
  );
}

function ExtractionReport({
  result,
  tally,
  refs,
}: {
  result: ExtractionResult;
  tally: { found: number; total: number };
  refs: string[];
}) {
  const spec = EXTRACTION_SCHEMAS[result.schemaId];
  const rows = Array.isArray(result.data[spec.table?.key ?? ""])
    ? (result.data[spec.table!.key] as Record<string, unknown>[])
    : [];

  return (
    <div className="space-y-2.5 border-t border-white/25 pt-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10.5px] glass-text-subtle">
          {/* Stated before the table, not after it: "4 of 10 fields" is the
              single most important thing to know about an extraction. */}
          {tally.found} of {tally.total} fields found in {result.filename}
          {refs.length > 0 ? ` · from ${refs.join(", ")}` : ""}
        </p>
        <div className="flex gap-1.5">
          <button
            className="focus-glass glass-btn flex min-h-11 items-center gap-1.5 rounded-xl px-2.5 text-[11px] glass-text-dark"
            onClick={() => downloadExtractionJson(result)}
            type="button"
          >
            <DownloadIcon className="h-3 w-3" />
            JSON
          </button>
          <button
            className="focus-glass glass-btn flex min-h-11 items-center gap-1.5 rounded-xl px-2.5 text-[11px] glass-text-dark"
            onClick={() => void downloadExtractionXlsx(result)}
            type="button"
          >
            <DownloadIcon className="h-3 w-3" />
            Excel
          </button>
        </div>
      </div>

      {result.warnings.length > 0 ? (
        <ul aria-label="Extraction warnings" className="space-y-1">
          {result.warnings.map((warning) => (
            <li
              className="flex items-start gap-1.5 rounded-lg bg-white/12 px-2 py-1.5 text-[10.5px] leading-snug glass-text-dark"
              key={`${warning.field}-${warning.message}`}
            >
              <AlertIcon className="mt-px h-3 w-3 shrink-0" />
              <span>
                <span className="font-medium">{warning.field}</span> — {warning.message}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[11px]">
          <tbody>
            {spec.fields.map((field) => {
              const value = result.data[field.key];
              const missing =
                value === null ||
                value === undefined ||
                (Array.isArray(value) && value.length === 0) ||
                (typeof value === "string" && value.trim() === "");
              return (
                <tr className="border-b border-white/15" key={field.key}>
                  <th className="w-[38%] py-1.5 pr-2 text-left align-top font-medium glass-text-subtle">
                    {field.label}
                  </th>
                  <td className={`py-1.5 align-top ${missing ? "glass-text-subtle italic" : "glass-text-dark"}`}>
                    {missing ? "not found" : formatFieldValue(value, field.kind)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {spec.table ? (
        <div className="space-y-1">
          <p className="text-[10.5px] font-medium tracking-wide uppercase glass-text-subtle">
            {spec.table.label}
          </p>
          {rows.length === 0 ? (
            <p className="text-[11px] italic glass-text-subtle">None found in this document.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="border-b border-white/30">
                    {spec.table.columns.map((column) => (
                      <th
                        className="py-1.5 pr-2 text-left font-medium glass-text-subtle"
                        key={column.key}
                      >
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr className="border-b border-white/15" key={index}>
                      {spec.table!.columns.map((column) => (
                        <td className="py-1.5 pr-2 align-top glass-text-dark" key={column.key}>
                          {formatFieldValue(row[column.key], column.kind)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      <p className="text-[9.5px] leading-snug glass-text-subtle">
        Extracted by {result.model} from the document text. Values are read, never calculated — check
        anything you rely on against the source.
      </p>
    </div>
  );
}
