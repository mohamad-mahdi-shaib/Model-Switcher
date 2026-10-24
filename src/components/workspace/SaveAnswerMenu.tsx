"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DownloadIcon, LoaderIcon } from "@/components/icons";
import {
  availableFormats,
  extractDocumentContent,
  generateFile,
  type FileFormat,
} from "@/lib/file-generation";

/**
 * Project 4, Milestone 5: saving an answer as a real file.
 *
 * Sits in the existing answer action row beside Copy, Regenerate and Read
 * aloud, because that is what it is -- another thing to do with an answer,
 * not a separate feature with its own surface.
 *
 * Two decisions worth stating.
 *
 * A format the answer cannot support is shown DISABLED with its reason
 * ("this answer has no table"), not hidden. A menu whose contents change
 * shape between answers is harder to learn than one where the same options
 * are always in the same place, and the greyed entry teaches what would make
 * it work.
 *
 * Generation happens entirely in the browser. Nothing is uploaded, no server
 * round trip, no storage, and no cost -- the answer is already here, and the
 * libraries that turn it into a .docx or .xlsx run perfectly well client
 * side. They are dynamically imported so they are fetched only when someone
 * actually saves something.
 */

export function SaveAnswerMenu({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<FileFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  /**
   * Save As exports THIS MESSAGE, and keeps doing so.
   *
   * Only the document fence is honoured here -- markers are an instruction to
   * this app and should never land in a saved file -- and nothing else is
   * removed. Conversational trimming belongs to the generate-a-document path
   * (`GeneratedFileCard`), not to exporting a chat message, or a reply that
   * happens to open with "Here's how that works" would quietly lose its
   * first line.
   */
  const content = useMemo(() => extractDocumentContent(text).content, [text]);
  const formats = useMemo(() => availableFormats(content), [content]);

  // Close on an outside click or Escape, like every other transient menu here.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const save = async (format: FileFormat) => {
    setBusy(format);
    setError(null);
    try {
      const file = await generateFile(format, content);
      const blob = new Blob([file.bytes as unknown as BlobPart], { type: file.mimeType });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setOpen(false);
    } catch (caught) {
      // Surfaced rather than swallowed: a silent no-op on a Save button is
      // indistinguishable from a broken download.
      console.error("[save-answer] generation failed", caught);
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : "That file could not be generated.",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="relative mt-1 inline-flex" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Save this answer as a file"
        className="focus-glass inline-flex min-h-11 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] glass-text-subtle transition-colors hover:bg-white/12 hover:glass-text-dark"
        onClick={() => setOpen((previous) => !previous)}
        type="button"
      >
        {busy ? (
          <LoaderIcon className="h-2.5 w-2.5 animate-spin" />
        ) : (
          <DownloadIcon className="h-2.5 w-2.5" />
        )}
        Save as
      </button>

      {open ? (
        <div
          aria-label="File formats"
          className="glass-modal absolute bottom-full left-0 z-30 mb-1 w-[232px] rounded-xl p-1"
          role="menu"
        >
          {/* Each unavailable format explains ITSELF, inline. Previously the
              reason lived in a `title` tooltip plus one shared line showing
              only the FIRST unavailable entry, so a greyed-out option read as
              broken rather than as not-applicable-to-this-answer. */}
          {formats.map((entry) => (
            <div key={entry.format}>
              <button
                className="focus-glass flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-2 text-left text-[11px] glass-text-dark transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
                disabled={!entry.available || busy !== null}
                onClick={() => void save(entry.format)}
                role="menuitem"
                title={entry.reason}
                type="button"
              >
                <span>{entry.label}</span>
                {busy === entry.format ? <LoaderIcon className="h-3 w-3 animate-spin" /> : null}
              </button>
              {!entry.available && entry.reason ? (
                <p className="px-2 pb-1 text-[9.5px] leading-snug glass-text-subtle">{entry.reason}</p>
              ) : null}
            </div>
          ))}
          {error ? (
            <p className="px-2 pt-1 text-[9.5px] glass-text-dark" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
