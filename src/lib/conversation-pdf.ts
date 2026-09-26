"use client";

import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import { EXPORT_VERSION, type ConversationExport } from "@/lib/conversation-export";

/**
 * Renders a `ConversationExport` payload (`conversation-export.ts`'s own
 * pure data shape -- unchanged, still the single source of truth for WHICH
 * conversations/messages are included) as a real, readable PDF.
 *
 * Rendered through the BROWSER's own text layout (an off-screen DOM node,
 * rasterised with `html2canvas`, then sliced into A4 pages and embedded as
 * images in the PDF via `jspdf`) rather than jsPDF's own built-in
 * text-drawing API. This is a deliberate fix, not the simpler default
 * path: jsPDF's built-in fonts (Helvetica etc.) are the 14 standard PDF
 * fonts, which only cover Latin script (WinAnsiEncoding) -- an Arabic
 * conversation, drawn with `doc.text()`, does not fail loudly; it silently
 * maps Arabic code points onto whatever unrelated glyphs that encoding
 * happens to have at those positions, which is exactly the "different
 * language / symbols I don't recognise" a real user reported. Correctly
 * shaping and bidi-ordering Arabic text from scratch (contextual letter
 * forms, right-to-left reordering, embedding a real Arabic font) is a
 * large, error-prone undertaking; the browser's own layout engine already
 * does this correctly (the app's live chat UI already renders Arabic
 * correctly on screen) -- so this reuses that, at the cost of the PDF's
 * text no longer being selectable/searchable, which is judged the better
 * trade for actually being readable in every language the app supports,
 * not just English.
 */

const PAGE_WIDTH_PT = 595.28; // A4 at 72pt/in
const PAGE_HEIGHT_PT = 841.89;
const RENDER_WIDTH_PX = 900; // off-screen container width; maps to the full page width
const RENDER_PADDING_PX = 48;
const SCALE = 2; // renders at 2x for crisp text once embedded as an image

function buildOffScreenContainer(payload: ConversationExport): HTMLDivElement {
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-99999px";
  container.style.top = "0";
  container.style.width = `${RENDER_WIDTH_PX}px`;
  container.style.padding = `${RENDER_PADDING_PX}px`;
  container.style.background = "#ffffff";
  container.style.color = "#15161a";
  container.style.fontFamily =
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  container.style.fontSize = "15px";
  container.style.lineHeight = "1.65";
  container.style.boxSizing = "border-box";

  let firstConversation = true;
  for (const conversation of payload.conversations) {
    if (!firstConversation) {
      const spacer = document.createElement("div");
      spacer.style.height = "30px";
      container.appendChild(spacer);
    }
    firstConversation = false;

    for (const message of conversation.messages) {
      const p = document.createElement("p");
      // `dir="auto"` lets the browser's own bidi algorithm lay Arabic (or
      // any right-to-left, or mixed-direction) text out correctly, exactly
      // like the app's own `HighlightedSnippet`/search results already do
      // -- no special-casing needed here beyond reusing that same
      // attribute on each paragraph.
      p.setAttribute("dir", "auto");
      p.style.margin = message.role === "user" ? "0 0 5px 0" : "0 0 22px 0";
      p.style.fontWeight = message.role === "user" ? "700" : "400";
      p.style.whiteSpace = "pre-wrap";
      p.style.overflowWrap = "break-word";
      p.textContent = message.content || "(empty)";
      container.appendChild(p);
    }
  }

  if (payload.conversations.length === 0) {
    const p = document.createElement("p");
    p.style.fontStyle = "italic";
    p.style.color = "#555";
    p.textContent = "No saved conversations.";
    container.appendChild(p);
  }

  return container;
}

export async function buildConversationsPdf(payload: ConversationExport): Promise<jsPDF> {
  const container = buildOffScreenContainer(payload);
  document.body.appendChild(container);

  let canvas: HTMLCanvasElement;
  let breakPointsPx: number[];
  try {
    // Safe page-break points: the top of every top-level child (each
    // message paragraph, and each inter-conversation spacer) -- used below
    // so a page break never falls in the middle of a line of text.
    breakPointsPx = Array.from(container.children).map((el) => (el as HTMLElement).offsetTop);
    canvas = await html2canvas(container, { scale: SCALE, backgroundColor: "#ffffff", useCORS: false });
  } finally {
    container.remove();
  }

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageHeightCanvasPx = (PAGE_HEIGHT_PT / PAGE_WIDTH_PT) * canvas.width;
  const breakPointsCanvasPx = breakPointsPx.map((y) => y * SCALE);

  let cursor = 0;
  let firstPage = true;
  while (cursor < canvas.height) {
    const idealEnd = Math.min(cursor + pageHeightCanvasPx, canvas.height);
    // The largest safe break point that still fits this page; falls back
    // to a hard cut only if a single message is itself taller than one
    // whole page (rare, and still strictly better than failing to export).
    let sliceEnd = idealEnd;
    for (const bp of breakPointsCanvasPx) {
      if (bp > cursor && bp <= idealEnd) sliceEnd = bp;
    }
    if (sliceEnd <= cursor) sliceEnd = idealEnd;

    const sliceHeight = sliceEnd - cursor;
    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = canvas.width;
    pageCanvas.height = sliceHeight;
    const ctx = pageCanvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      ctx.drawImage(canvas, 0, cursor, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
    }

    if (!firstPage) doc.addPage();
    firstPage = false;
    const imgHeightPt = (sliceHeight / canvas.width) * PAGE_WIDTH_PT;
    doc.addImage(pageCanvas.toDataURL("image/png"), "PNG", 0, 0, PAGE_WIDTH_PT, imgHeightPt);

    cursor = sliceEnd;
  }

  return doc;
}

/** `model-switcher-export-v1-2026-09-26T14-30-00.pdf`, safe as a filename on every OS. */
export function exportPdfFileName(now: Date = new Date()): string {
  const iso = now.toISOString().replace(/:/g, "-").replace(/\..+$/, "");
  return `model-switcher-export-v${EXPORT_VERSION}-${iso}.pdf`;
}
