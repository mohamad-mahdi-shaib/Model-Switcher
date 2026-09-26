import type { Conversation } from "@/lib/storage";

/**
 * Pure JSON-shaping for the Settings > Conversations "Export" action. Split
 * out from `use-conversations.ts` so the payload shape is testable without
 * touching the DOM (the actual download trigger -- Blob + object URL + a
 * clicked `<a>` -- stays in `use-conversations.ts`'s `exportConversations()`,
 * which is inherently a browser-only action).
 */

export const EXPORT_VERSION = 1;

export type ConversationExport = {
  exportVersion: number;
  exportedAt: string;
  /**
   * Self-documenting, inside the file itself -- this is read by whoever the
   * file is shared with, not only by whoever exported it. Never claims
   * attachments are backed up; only their metadata (name/type/size) is
   * included, never the binary bytes, which live in this browser's
   * IndexedDB and are not exported. No credentials of any kind appear
   * anywhere in this payload.
   */
  disclosure: string;
  conversations: Conversation[];
};

const DISCLOSURE =
  "This export includes conversation text, timestamps, provider identity per answer, and regenerated answer versions. " +
  "Attachment METADATA (filename, type, size) is included where present, but attachment file CONTENTS are not -- " +
  "this is not a full backup of attached files, and there is no import for this file. No credentials are included.";

/** Only saved (non-empty-draft) conversations are meaningful to export. */
export function buildExportPayload(conversations: readonly Conversation[]): ConversationExport {
  return {
    exportVersion: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    disclosure: DISCLOSURE,
    conversations: conversations as Conversation[],
  };
}

/** `model-switcher-export-v1-2026-09-26T14-30-00.json`, safe as a filename on every OS. */
export function exportFileName(now: Date = new Date()): string {
  const iso = now.toISOString().replace(/:/g, "-").replace(/\..+$/, "");
  return `model-switcher-export-v${EXPORT_VERSION}-${iso}.json`;
}
