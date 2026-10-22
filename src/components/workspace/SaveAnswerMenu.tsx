"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DownloadIcon, LoaderIcon } from "@/components/icons";
import { availableFormats, generateFile, type FileFormat } from "@/lib/file-generation";

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

  const formats = useMemo(() => availableFormats(text), [text]);

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
      const file = await generateFile(format, text);
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
      setError("That file could not be generated.");
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
          {formats.map((entry) => (
            <button
              className="focus-glass flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-2 text-left text-[11px] glass-text-dark transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
              disabled={!entry.available || busy !== null}
              key={entry.format}
              onClick={() => void save(entry.format)}
              role="menuitem"
              title={entry.reason}
              type="button"
            >
              <span>{entry.label}</span>
              {busy === entry.format ? <LoaderIcon className="h-3 w-3 animate-spin" /> : null}
            </button>
          ))}
          {formats.some((entry) => !entry.available) ? (
            <p className="px-2 pt-1 pb-0.5 text-[9.5px] leading-snug glass-text-subtle">
              {formats.find((entry) => !entry.available)?.reason}
            </p>
          ) : null}
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
