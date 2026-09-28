"use client";

import { AlertIcon, FileIcon, LoaderIcon, XIcon } from "@/components/icons";
import type { DraftAttachment } from "@/lib/attachments";

/**
 * The staged-attachment chip row, shown above the textarea when the draft
 * has at least one file. Every chip -- staging, ready, or rejected -- gets
 * the same treatment: name, size/status, and a touch-sized remove control.
 * A rejected file is never silently dropped; it stays visible with its own
 * reason until removed. A staging file shows a spinner over its own
 * thumbnail rather than a separate indicator, so it's obvious which file
 * isn't ready yet even with several attached at once.
 */

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

function Chip({ attachment, onRemove }: { attachment: DraftAttachment; onRemove: () => void }) {
  const isError = attachment.status === "error";
  const isStaging = attachment.status === "staging";
  return (
    <li
      className={`glass-btn flex max-w-[200px] items-center gap-2 rounded-xl py-1 pr-1 pl-2 text-[10.5px] ${
        isError ? "border border-white/40" : ""
      }`}
      title={isError ? attachment.error : isStaging ? "Preparing…" : attachment.name}
    >
      <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/15">
        {attachment.previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a local blob: preview, not a remote/optimizable image.
          <img
            alt=""
            className="h-7 w-7 rounded-md object-cover"
            src={attachment.previewUrl}
          />
        ) : isError ? (
          <AlertIcon className="h-3.5 w-3.5 glass-text-subtle" />
        ) : (
          <FileIcon className="h-3.5 w-3.5 glass-text-subtle" />
        )}
        {isStaging ? (
          // The icon itself stays decorative (aria-hidden, like its sibling
          // icons above) -- this wrapper is what's actually announced, since
          // an aria-label on an aria-hidden element is invisible to
          // assistive tech either way.
          <span
            aria-label="Preparing"
            className="absolute inset-0 flex items-center justify-center rounded-md bg-black/45"
            role="status"
          >
            <LoaderIcon className="h-3.5 w-3.5 animate-spin text-white" />
          </span>
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium glass-text-dark">{attachment.name}</span>
        <span className="block truncate glass-text-subtle">
          {isError ? attachment.error : isStaging ? "Preparing…" : formatSize(attachment.size)}
        </span>
      </span>
      <button
        aria-label={`Remove ${attachment.name}`}
        className="focus-glass flex h-11 w-11 shrink-0 items-center justify-center rounded-full glass-text-subtle hover:bg-white/15"
        onClick={onRemove}
        type="button"
      >
        <XIcon className="h-3 w-3" />
      </button>
    </li>
  );
}

export function AttachmentTray({
  attachments,
  onRemove,
}: {
  attachments: readonly DraftAttachment[];
  onRemove: (id: string) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <ul aria-label="Attached files" className="flex flex-wrap gap-1.5 px-0.5 pb-1">
      {attachments.map((attachment) => (
        <Chip attachment={attachment} key={attachment.id} onRemove={() => onRemove(attachment.id)} />
      ))}
    </ul>
  );
}
