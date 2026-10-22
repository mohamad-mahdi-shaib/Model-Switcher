"use client";

import { AlertIcon, FileIcon, LoaderIcon, SearchIcon, TableIcon, XIcon } from "@/components/icons";
import { describeDocument, type DocumentRef } from "@/lib/documents";
import type { DraftDocument } from "@/lib/document-upload";

/**
 * Project 4: the conversation's indexed files, shown above the textarea.
 *
 * Why this is a SEPARATE row from `AttachmentTray` rather than more chips in
 * it: the two have different lifetimes, and conflating them would lie about
 * both. An attachment belongs to one message -- it is sent, it appears in
 * that turn, and the next question does not carry it. A document belongs to
 * the whole conversation: it stays searchable for every later question until
 * it is removed, which is exactly what makes a follow-up like "and what does
 * clause 9 say?" work. Showing them in one row would make it impossible to
 * tell which files the next question will actually search.
 *
 * So this row reads as a standing set ("Searchable files"), with each chip
 * carrying what retrieval can actually cite -- pages, sheets, rows, sections
 * -- and any parser warning the server returned, because a truncated or
 * partially-read document must never look like a complete one.
 */

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

function ReadyChip({ document, onRemove }: { document: DocumentRef; onRemove: () => void }) {
  const warning = document.warnings[0];
  return (
    <li
      className="glass-btn flex max-w-[230px] items-center gap-2 rounded-xl py-1 pr-1 pl-2 text-[10.5px]"
      title={`${document.filename} — ${describeDocument(document)}${warning ? ` · ${warning}` : ""}`}
    >
      <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/15">
        <FileIcon className="h-3.5 w-3.5 glass-text-subtle" />
        {/* The magnifier is the whole point of the chip: this file is not
            just attached, it is indexed and will be searched. */}
        <span className="absolute -right-0.5 -bottom-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-white/80 text-[#1a1c22]">
          <SearchIcon className="h-2 w-2" />
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium glass-text-dark">{document.filename}</span>
        <span className="block truncate glass-text-subtle">
          {warning ? warning : `${formatSize(document.bytes)} · ${describeDocument(document)}`}
        </span>
      </span>
      <button
        aria-label={`Remove ${document.filename} from this conversation`}
        className="focus-glass flex h-11 w-11 shrink-0 items-center justify-center rounded-full glass-text-subtle hover:bg-white/15"
        onClick={onRemove}
        type="button"
      >
        <XIcon className="h-3 w-3" />
      </button>
    </li>
  );
}

function DraftChip({ draft, onRemove }: { draft: DraftDocument; onRemove: () => void }) {
  const isError = draft.status === "error";
  return (
    <li
      className={`glass-btn flex max-w-[230px] items-center gap-2 rounded-xl py-1 pr-1 pl-2 text-[10.5px] ${
        isError ? "border border-white/40" : ""
      }`}
      title={isError ? draft.error : `Indexing ${draft.name}…`}
    >
      <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/15">
        {isError ? (
          <AlertIcon className="h-3.5 w-3.5 glass-text-subtle" />
        ) : (
          <FileIcon className="h-3.5 w-3.5 glass-text-subtle" />
        )}
        {isError ? null : (
          <span
            aria-label="Indexing"
            className="absolute inset-0 flex items-center justify-center rounded-md bg-black/45"
            role="status"
          >
            <LoaderIcon className="h-3.5 w-3.5 animate-spin text-white" />
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium glass-text-dark">{draft.name}</span>
        <span className="block truncate glass-text-subtle">
          {/* "Reading and indexing" rather than "Uploading": parsing a
              200-page PDF and embedding it is most of the wait, and a bar
              that said "uploading" would look stuck once the bytes landed. */}
          {isError ? draft.error : `Reading and indexing · ${formatSize(draft.size)}`}
        </span>
      </span>
      <button
        aria-label={isError ? `Dismiss ${draft.name}` : `Cancel ${draft.name}`}
        className="focus-glass flex h-11 w-11 shrink-0 items-center justify-center rounded-full glass-text-subtle hover:bg-white/15"
        onClick={onRemove}
        type="button"
      >
        <XIcon className="h-3 w-3" />
      </button>
    </li>
  );
}

export function DocumentTray({
  documents,
  drafts,
  onRemoveDocument,
  onDismissDraft,
  onExtract,
}: {
  documents: readonly DocumentRef[];
  drafts: readonly DraftDocument[];
  onRemoveDocument: (id: string) => void;
  onDismissDraft: (key: string) => void;
  /** Opens structured extraction. Absent until there is a file to extract from. */
  onExtract: () => void;
}) {
  if (documents.length === 0 && drafts.length === 0) return null;
  return (
    <div className="pb-1">
      <ul
        aria-label="Searchable files in this conversation"
        className="flex flex-wrap items-center gap-1.5 px-0.5"
      >
        {documents.map((document) => (
          <ReadyChip
            document={document}
            key={document.id}
            onRemove={() => onRemoveDocument(document.id)}
          />
        ))}
        {drafts.map((draft) => (
          <DraftChip draft={draft} key={draft.key} onRemove={() => onDismissDraft(draft.key)} />
        ))}
        {documents.length > 0 ? (
          <li>
            {/* Sits with the files rather than in the toolbar: extraction acts
                ON these chips, and an affordance for a feature with nothing to
                act on would be dead weight in the composer's main row. */}
            <button
              className="focus-glass glass-btn flex min-h-11 items-center gap-1.5 rounded-xl px-2.5 text-[10.5px] font-medium glass-text-dark"
              onClick={onExtract}
              type="button"
            >
              <TableIcon className="h-3 w-3" />
              Extract data
            </button>
          </li>
        ) : null}
      </ul>
      {documents.length > 0 ? (
        <p className="px-1 pt-1 text-[9.5px] leading-snug glass-text-subtle">
          {documents.length === 1 ? "This file is" : `These ${documents.length} files are`} searched on
          every question, and answers cite the page or row they came from.
        </p>
      ) : null}
    </div>
  );
}
