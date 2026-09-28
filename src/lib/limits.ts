/**
 * Input and conversation-length limits (Finding F3), shared between the
 * client and `/api/chat` so the two can never silently disagree.
 *
 * Before this file existed, the server alone enforced these numbers
 * (`route.ts` had its own local `MAX_MESSAGES`/`MAX_CHARS` consts) and the
 * composer had no guard at all: an oversized draft was appended to history,
 * sent, rejected, and left stuck there -- every later send, including a new
 * short question, re-sent the same oversized history and failed identically.
 * Importing these two numbers into both `route.ts` and `use-conversations.ts`
 * is what lets the client refuse a draft BEFORE it ever enters history.
 */

/** Per-message character cap. Matches the server's own validation exactly. */
export const MAX_CHARS = 16_000;

/** Per-conversation wire-message cap (user + assistant turns combined). */
export const MAX_MESSAGES = 50;

export type DraftRejection =
  | { ok: false; reason: "empty" }
  | { ok: false; reason: "tooLong"; limit: number; over: number }
  | { ok: false; reason: "conversationFull"; limit: number }
  | { ok: false; reason: "historyTooLong"; limit: number };

export type DraftValidation = { ok: true } | DraftRejection;

/**
 * Whether any message already in history is itself over the per-message
 * limit (Finding U1, follow-up review). The only way this happens today is a
 * Gemini answer saved before this app applied any cap to it, or one saved by
 * an older build -- never a fresh draft, which `validateDraft()` itself
 * refuses before it can enter history.
 */
export function hasOversizedMessage(history: readonly { content: string }[]): boolean {
  return history.some((m) => m.content.length > MAX_CHARS);
}

/**
 * Whether a new user message may be appended to history and sent, given the
 * conversation's actual history so far (before this new message is added).
 *
 * Pure and exported so it can be driven directly in a regression test without
 * mounting the composer or the hook -- the same pattern `settleRun()` and
 * `persistIfAllowed()` established for F1/F2.
 *
 * Takes the real message array, not just a count (Finding U1, follow-up
 * review): the only way to actually detect an oversized message already
 * sitting in history is to look at the messages themselves, not their count.
 * `toWire()` used to paper over this by silently shortening whatever such a
 * message it was asked to send -- a real fact could quietly disappear from
 * what the provider received, with nothing in the UI to say so. That has
 * been removed entirely; this check is what replaces it, refusing the send
 * up front with a specific, honest reason instead.
 */
export function validateDraft(
  content: string,
  history: readonly { content: string }[],
): DraftValidation {
  const trimmed = content.trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  // Checked first: a conversation carrying an oversized historical message
  // can never be sent further at all, regardless of the new draft's own
  // length or the message count -- there is no partial fix, only "start a
  // new conversation", so it is reported as its own specific reason rather
  // than being folded into "conversationFull".
  if (hasOversizedMessage(history)) {
    return { ok: false, reason: "historyTooLong", limit: MAX_CHARS };
  }
  // A conversation already at capacity has no room for a new turn regardless
  // of how short it is.
  if (history.length >= MAX_MESSAGES) {
    return { ok: false, reason: "conversationFull", limit: MAX_MESSAGES };
  }
  if (trimmed.length > MAX_CHARS) {
    return { ok: false, reason: "tooLong", limit: MAX_CHARS, over: trimmed.length - MAX_CHARS };
  }
  return { ok: true };
}

/** User-facing explanation for a rejected draft, specific to the actual limit. */
export function draftRejectionMessage(rejection: DraftRejection): string {
  switch (rejection.reason) {
    case "empty":
      return "";
    case "tooLong":
      return `That message is ${rejection.over.toLocaleString()} characters over the ${rejection.limit.toLocaleString()}-character limit. Trim it and try again.`;
    case "conversationFull":
      return `This conversation has reached its ${rejection.limit}-message limit. Start a new conversation to keep chatting.`;
    case "historyTooLong":
      return `This conversation contains a message over the ${rejection.limit.toLocaleString()}-character limit and can't be sent further. Start a new conversation to continue.`;
  }
}

/* ------------------------------------------------------------------------ *
 * Attachments (Interaction refinement). Derived from Vercel's own
 * documented, plan-independent request-body ceiling for a Node.js
 * function -- 4.5 MB total (confirmed against current Vercel docs, not
 * assumed) -- not picked arbitrarily.
 *
 *   4.5 MB hard platform ceiling
 * - 0.3 MB safety margin (headers, JSON structure, response overhead)
 * - 1.0 MB reserved for conversation text (MAX_CHARS/MAX_MESSAGES already
 *   bound this independently, but attachments must never be allowed to
 *   crowd out room a real conversation needs)
 * ------------------------------------
 *   3.2 MB left for attachments, as base64 (which inflates raw bytes by
 *   ~4/3) -> ~2.3 MB of *raw* attachment bytes is the real ceiling.
 *
 * MAX_ATTACHMENTS_TOTAL_BYTES below is set comfortably under that 2.3 MB
 * figure, not against it, so the margin is real rather than nominal.
 * -------------------------------------------------------------------------*/

/** Files per message. */
export const MAX_ATTACHMENTS = 3;
/**
 * Per-file cap, raw bytes (pre-base64). Set equal to the combined budget
 * below rather than some stricter fraction of it -- the combined check
 * already enforces the real platform ceiling for the multi-file case, so a
 * single attachment (the common "add a photo" case) has no reason to be
 * capped any tighter than that. A typical modern phone photo (2-8MB) will
 * still often exceed even this; `attachments.ts`'s `downscaleImageIfNeeded`
 * is what actually makes those work by recompressing before this check ever
 * runs, rather than this number being raised further.
 */
export const MAX_ATTACHMENT_BYTES = 2_200_000;
/** Combined cap across every attachment on one message, raw bytes. */
export const MAX_ATTACHMENTS_TOTAL_BYTES = 2_200_000;
/** Extracted text length cap for a single text/code attachment. */
export const MAX_ATTACHMENT_TEXT_CHARS = 6_000;

export type AttachmentKind = "image" | "pdf" | "text";

/** Images both configured providers genuinely support as real image input. */
export const ALLOWED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const PDF_MIME_TYPE = "application/pdf";

/**
 * A small, explicit allowlist of text-based source formats, not "every
 * text-ish file" -- matches the task's own "small explicit allowlist"
 * instruction. Keyed by extension since a `.ts`/`.py`/etc. file's MIME type
 * is unreliable across browsers and OSes; content is still independently
 * verified (real UTF-8 decodability) server-side, never trusted from the
 * extension alone.
 */
export const ALLOWED_TEXT_EXTENSIONS = [
  ".txt", ".md", ".csv", ".json",
  ".js", ".ts", ".tsx", ".jsx",
  ".py", ".java", ".c", ".cpp", ".h",
  ".css", ".html", ".yaml", ".yml", ".xml", ".sh",
] as const;

export type AttachmentRejection =
  | { ok: false; reason: "tooMany"; limit: number }
  | { ok: false; reason: "fileTooLarge"; name: string; limit: number }
  | { ok: false; reason: "totalTooLarge"; limit: number }
  | { ok: false; reason: "unsupportedType"; name: string };

export type AttachmentValidation = { ok: true } | AttachmentRejection;

/**
 * Count/size validation only -- shared by client (pre-upload, raw `File`
 * sizes) and server (`route.ts`, decoded byte lengths, never the client's
 * own claimed `size`). Type/content validation (allowed mime type, magic
 * bytes, UTF-8 decodability) is necessarily asymmetric between the two
 * sides (the client has a `File`, the server has base64 text) and lives
 * separately in each caller.
 */
export function validateAttachmentSizes(
  files: readonly { name: string; size: number }[],
): AttachmentValidation {
  if (files.length > MAX_ATTACHMENTS) {
    return { ok: false, reason: "tooMany", limit: MAX_ATTACHMENTS };
  }
  const oversized = files.find((f) => f.size > MAX_ATTACHMENT_BYTES);
  if (oversized) {
    return { ok: false, reason: "fileTooLarge", name: oversized.name, limit: MAX_ATTACHMENT_BYTES };
  }
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > MAX_ATTACHMENTS_TOTAL_BYTES) {
    return { ok: false, reason: "totalTooLarge", limit: MAX_ATTACHMENTS_TOTAL_BYTES };
  }
  return { ok: true };
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)}MB`;
  return `${Math.round(bytes / 1000)}KB`;
}

export function attachmentRejectionMessage(rejection: AttachmentRejection): string {
  switch (rejection.reason) {
    case "tooMany":
      return `Up to ${rejection.limit} files per message.`;
    case "fileTooLarge":
      return `“${rejection.name}” is over the ${formatBytes(rejection.limit)} per-file limit.`;
    case "totalTooLarge":
      return `These files together are over the ${formatBytes(rejection.limit)} combined limit.`;
    case "unsupportedType":
      return `“${rejection.name}” isn’t a supported file type.`;
  }
}
