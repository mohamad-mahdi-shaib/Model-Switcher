"use client";

import { useMemo, useState } from "react";
import { AlertIcon, DownloadIcon, FileIcon, LoaderIcon } from "@/components/icons";
import {
  availableFormats,
  extensionFor,
  extractDocumentContent,
  FORMAT_LABELS,
  generateFile,
  filenameStemFor,
  type FileFormat,
} from "@/lib/file-generation";

/**
 * A generated document, shown as a compact card instead of a wall of text.
 *
 * When someone asks for "a PDF" or "a Word document", the answer IS the
 * document: often a page of headings, tables and lists. Printing all of it
 * into the transcript and leaving the user to scroll past it and then hunt
 * for a menu gets the emphasis exactly backwards -- what they wanted was the
 * file. So the answer collapses to a filename and a download button, with
 * the text one click away for anyone who wants to read or copy it.
 *
 * The content is unchanged: this is a presentation of the same answer, and
 * the same `file-generation.ts` produces the bytes. Nothing is hidden --
 * "Show text" reveals the full reply, and the answer's own action row (Copy,
 * Regenerate, Save as, Read aloud) is untouched beneath it.
 */

export function GeneratedFileCard({
  text,
  format,
  children,
}: {
  text: string;
  format: FileFormat;
  /** The normal rendered answer, revealed by "Show text". */
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * THE DOCUMENT, not the reply.
   *
   * This is the whole point of the card: the file must contain what was
   * asked for, not "Sure, here is your PDF:" followed by it. The model is
   * asked to fence the document explicitly; when it does not, a short
   * conversational opener or closer is trimmed. An ordinary answer is
   * untouched by both mechanisms.
   */
  const document_ = useMemo(() => extractDocumentContent(text, { stripChatter: true }), [text]);
  const content = document_.content;

  const filename = useMemo(
    () => `${filenameStemFor(content)}.${extensionFor(format, content)}`,
    [content, format],
  );

  /**
   * A requested format can still be unavailable -- a PDF of an Arabic answer,
   * a code file from an answer with no code. The card says so and offers what
   * the answer CAN produce rather than a button that fails on click.
   */
  const availability = useMemo(() => availableFormats(content), [content]);
  const requested = availability.find((entry) => entry.format === format);
  const usable = requested?.available !== false;

  const download = async () => {
    setBusy(true);
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
    } catch (caught) {
      console.error("[file-card] generation failed", caught);
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : "That file could not be generated.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="my-1">
      <div className="glass-btn flex max-w-[360px] items-center gap-2.5 rounded-2xl py-2 pr-2 pl-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/18">
          <FileIcon className="h-4 w-4 glass-text-dark" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-medium glass-text-dark">{filename}</span>
          <span className="block truncate text-[10px] glass-text-subtle">
            {usable ? FORMAT_LABELS[format] : (requested?.reason ?? "Unavailable for this answer")}
          </span>
        </span>

        {usable ? (
          <button
            aria-label={`Download ${filename}`}
            className="focus-glass flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/80 bg-gradient-to-tr from-white/35 to-white/70 text-[#1a1c22] shadow-sm transition-all disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy}
            onClick={() => void download()}
            type="button"
          >
            {busy ? (
              <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <DownloadIcon className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          <span className="flex h-11 w-11 shrink-0 items-center justify-center glass-text-subtle">
            <AlertIcon className="h-3.5 w-3.5" />
          </span>
        )}
      </div>

      <button
        aria-expanded={expanded}
        className="focus-glass mt-1 rounded-md px-1 text-[10px] glass-text-subtle underline underline-offset-2 hover:glass-text-dark"
        onClick={() => setExpanded((previous) => !previous)}
        type="button"
      >
        {expanded ? "Hide text" : "Show text"}
      </button>

      {error ? (
        <p className="mt-1 px-1 text-[10px] glass-text-dark" role="alert">
          {error}
        </p>
      ) : null}

      {expanded ? (
        <div className="mt-1">
          {children}
          {document_.trimmed ? (
            <p className="mt-1 text-[9.5px] glass-text-subtle">
              The file contains the document only — conversational text around it is left out.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
