"use client";

import { newId, type AttachmentMeta, type WireAttachment } from "@/lib/chat";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_TEXT_EXTENSIONS,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_TEXT_CHARS,
  PDF_MIME_TYPE,
  type AttachmentKind,
} from "@/lib/limits";
import { getAttachmentBytes, saveAttachmentBytes } from "@/lib/attachment-storage";

/**
 * A staged attachment in the composer. Validated (and, for `"ready"` ones,
 * saved to IndexedDB + wire-encoded) as soon as it is added -- see
 * `stageAttachment()` -- so Send itself does no async work at all; it just
 * reads `prepared` off whichever chips are still `"ready"`.
 *
 * `"staging"` is the chip's state from the instant a file is picked until
 * `stageAttachment()` resolves for it -- reading the file, sniffing its
 * content, and (for an oversized photo) recompressing it are all real async
 * work, and a large photo can visibly take a moment. The composer shows this
 * as a loading spinner over the chip's own thumbnail and keeps Send disabled
 * meanwhile, so there is never a window where the file looks attached but
 * isn't actually ready to go out yet.
 *
 * `previewUrl` is draft-only (never persisted). A rejected file still gets
 * a chip, explaining why, with only a remove control -- never a silent
 * drop. One disclosed tradeoff: `"ready"` chips already have bytes saved
 * to IndexedDB at this point, so a draft with attachments that is
 * abandoned (never sent) leaves those bytes orphaned there rather than
 * cleaned up immediately -- see docs/interaction-refinement.md.
 */
export type DraftAttachment = {
  id: string;
  name: string;
  size: number;
  kind: AttachmentKind | null;
  status: "staging" | "ready" | "error";
  error?: string;
  previewUrl?: string;
  prepared?: PreparedAttachment;
};

function classifyByName(name: string): AttachmentKind | null {
  const lower = name.toLowerCase();
  if ((ALLOWED_TEXT_EXTENSIONS as readonly string[]).some((ext) => lower.endsWith(ext))) return "text";
  return null;
}

/** Best-effort classification from what the browser reports -- never the
 * final word; `sniff()` below independently verifies image/PDF content
 * against their real magic bytes rather than trusting this. */
export function classifyFile(file: File): AttachmentKind | null {
  if ((ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) return "image";
  if (file.type === PDF_MIME_TYPE) return "pdf";
  // Browsers frequently report an empty or generic MIME type for text/code
  // files (especially by extension on Windows) -- name-based classification
  // is the primary path for this kind, not a fallback.
  return classifyByName(file.name);
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47];
const JPEG_SIG = [0xff, 0xd8, 0xff];
const PDF_SIG = [0x25, 0x50, 0x44, 0x46]; // "%PDF"

function matchesSignature(bytes: Uint8Array, sig: number[]): boolean {
  return sig.every((b, i) => bytes[i] === b);
}

function isWebp(bytes: Uint8Array): boolean {
  // "RIFF" .... "WEBP"
  const riff = [0x52, 0x49, 0x46, 0x46];
  const webp = [0x57, 0x45, 0x42, 0x50];
  return riff.every((b, i) => bytes[i] === b) && webp.every((b, i) => bytes[i + 8] === b);
}

/**
 * Real content verification, not just extension/MIME trust -- "images must
 * reach the provider as genuine image input," and a file that only claims
 * to be one must not silently pass as one. Mirrors (independently) the
 * server-side check in `route.ts`, which never trusts this client result
 * either.
 */
function sniffMatches(kind: AttachmentKind, mimeType: string, bytes: Uint8Array): boolean {
  if (kind === "pdf") return matchesSignature(bytes, PDF_SIG);
  if (kind === "image") {
    if (mimeType === "image/png") return matchesSignature(bytes, PNG_SIG);
    if (mimeType === "image/jpeg") return matchesSignature(bytes, JPEG_SIG);
    if (mimeType === "image/webp") return isWebp(bytes);
    return false;
  }
  return true; // text: verified by decodability below, not a signature
}

/** A crude but effective "does this look like real text" heuristic: no NUL
 * bytes, and the decoded form round-trips without the replacement
 * character flooding in from binary garbage. */
function looksLikeText(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const replacementCount = (text.match(/�/g) ?? []).length;
  if (bytes.length > 0 && replacementCount / text.length > 0.01) return null;
  return text;
}

export type PreparedAttachment = {
  meta: AttachmentMeta;
  wire: WireAttachment;
};

/**
 * Validates and reads ONE file's content (count/size limits are checked
 * separately, across the whole batch, by `validateAttachmentSizes` in
 * `@/lib/limits` -- this only ever handles one file's own content), saves
 * its raw bytes to IndexedDB under a fresh id, and builds both the
 * persisted `AttachmentMeta` and the `WireAttachment` for the request this
 * file is being sent with right now.
 */
export async function prepareAttachment(
  id: string,
  file: File,
  kind: AttachmentKind,
): Promise<{ ok: true; prepared: PreparedAttachment } | { ok: false; error: string }> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  if (kind === "text") {
    const text = looksLikeText(bytes);
    if (text === null) {
      return { ok: false, error: "Doesn’t look like a text file." };
    }
    const capped = text.slice(0, MAX_ATTACHMENT_TEXT_CHARS);
    await saveAttachmentBytes(id, buffer);
    const meta: AttachmentMeta = { id, name: file.name, mimeType: file.type || "text/plain", kind, size: file.size };
    return {
      ok: true,
      prepared: { meta, wire: { kind: "text", mimeType: meta.mimeType, name: meta.name, text: capped } },
    };
  }

  const mimeType = kind === "pdf" ? PDF_MIME_TYPE : file.type;
  if (!sniffMatches(kind, mimeType, bytes)) {
    return { ok: false, error: "File content doesn’t match its type." };
  }
  await saveAttachmentBytes(id, buffer);
  const meta: AttachmentMeta = { id, name: file.name, mimeType, kind, size: file.size };
  const data = arrayBufferToBase64(buffer);
  return { ok: true, prepared: { meta, wire: { kind, mimeType, name: meta.name, data } } };
}

function jpegName(name: string): string {
  const dot = name.lastIndexOf(".");
  return `${dot > 0 ? name.slice(0, dot) : name}.jpg`;
}

/**
 * A real camera photo (2-8MB is routine on any current phone) is almost
 * always well over `MAX_ATTACHMENT_BYTES` -- without this, "attach a photo"
 * would fail for most photos, every time, with the user's only recourse
 * being to manually shrink the file themselves first. Every mainstream chat
 * app recompresses an outgoing photo rather than rejecting it outright, so
 * this does the same: shrink dimensions and step down JPEG quality until it
 * fits, or give up and return the original file unchanged so the existing
 * size check can reject it with its normal, visible error message. Only
 * called for files already over budget -- an image already under it is
 * sent as-is, original format and quality untouched.
 */
async function downscaleImageIfNeeded(file: File): Promise<File> {
  if (file.size <= MAX_ATTACHMENT_BYTES) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  try {
    let width = bitmap.width;
    let height = bitmap.height;
    const maxDimension = 2000;
    if (width > maxDimension || height > maxDimension) {
      const scale = maxDimension / Math.max(width, height);
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
    }
    let quality = 0.85;
    for (let attempt = 0; attempt < 6; attempt++) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;
      ctx.drawImage(bitmap, 0, 0, width, height);
      const blob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", quality),
      );
      if (blob && blob.size <= MAX_ATTACHMENT_BYTES) {
        return new File([blob], jpegName(file.name), { type: "image/jpeg" });
      }
      quality = Math.max(0.4, quality - 0.15);
      width = Math.round(width * 0.85);
      height = Math.round(height * 0.85);
    }
    return file;
  } finally {
    bitmap.close();
  }
}

/**
 * The composer's own entry point: classifies, validates/sniffs, and (for a
 * supported file) prepares a chip ready to send immediately, with no
 * further async work at Send time. Count/combined-size limits are a
 * separate, batch-level check (`validateAttachmentSizes`) the caller runs
 * across the whole staged set, since they depend on sibling files this
 * function does not see.
 *
 * `id`, when given, lets the caller show an immediate `"staging"` placeholder
 * chip (see `DraftAttachment`) and later match this function's resolved
 * result back onto that exact same chip rather than a new one -- keeping the
 * chip's identity (and its thumbnail, once one exists) stable across the
 * staging state, instead of losing then re-adding it.
 */
export async function stageAttachment(file: File, id: string = newId("att")): Promise<DraftAttachment> {
  const kind = classifyFile(file);
  if (!kind) {
    return { id, name: file.name, size: file.size, kind: null, status: "error", error: "Unsupported file type." };
  }
  const effectiveFile = kind === "image" ? await downscaleImageIfNeeded(file) : file;
  const result = await prepareAttachment(id, effectiveFile, kind);
  if (!result.ok) {
    return { id, name: file.name, size: effectiveFile.size, kind, status: "error", error: result.error };
  }
  const previewUrl = kind === "image" ? URL.createObjectURL(effectiveFile) : undefined;
  return {
    id,
    name: file.name,
    size: effectiveFile.size,
    kind,
    status: "ready",
    previewUrl,
    prepared: result.prepared,
  };
}

/**
 * Rebuilds the wire form of already-persisted attachments -- Retry/
 * Regenerate re-sending an existing message, or Edit-resend re-truncating
 * history to a point that still includes one. Reads back from IndexedDB by
 * id rather than trusting anything held in memory, since that memory may
 * not even exist any more (a page reload between the original send and
 * this one). A missing entry (storage cleared, quota eviction) is silently
 * omitted from the OUTGOING request -- never a fabricated stand-in -- the
 * message's own display separately shows an "attachment unavailable"
 * state for exactly this case (`SentAttachmentChip` in `MessageList.tsx`).
 */
export async function buildWireAttachments(metas: readonly AttachmentMeta[]): Promise<WireAttachment[]> {
  const results: WireAttachment[] = [];
  for (const meta of metas) {
    const buffer = await getAttachmentBytes(meta.id);
    if (!buffer) continue;
    if (meta.kind === "text") {
      const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer).slice(0, MAX_ATTACHMENT_TEXT_CHARS);
      results.push({ kind: "text", mimeType: meta.mimeType, name: meta.name, text });
    } else {
      const data = arrayBufferToBase64(buffer);
      results.push({ kind: meta.kind, mimeType: meta.mimeType, name: meta.name, data });
    }
  }
  return results;
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * The composer's fallback question for "attach a file and hit Send with no
 * text typed" -- a real request (reported bug: it silently did nothing,
 * since `validateDraft()` refuses blank content regardless of attachments),
 * not just a validation workaround. Rather than teach every layer downstream
 * (validation, storage, both provider adapters) to treat "no text" as a
 * legitimate message shape, the composer substitutes a real, visible
 * question here -- the transcript then shows exactly what was actually
 * asked, same as any other turn. Only ever used when the user typed nothing;
 * real typed text is never touched.
 */
export function defaultPromptForAttachments(attachments: readonly { kind: AttachmentKind | null }[]): string {
  const kinds = new Set(attachments.map((a) => a.kind));
  if (kinds.size === 1 && kinds.has("image")) {
    return attachments.length === 1
      ? "What's in this image? Give me a brief summary."
      : "What's in these images? Give me a brief summary of each.";
  }
  if (kinds.size === 1 && kinds.has("pdf")) {
    return attachments.length === 1 ? "Summarize this document." : "Summarize these documents.";
  }
  if (kinds.size === 1 && kinds.has("text")) {
    return attachments.length === 1 ? "Summarize this file." : "Summarize these files.";
  }
  return "Summarize what's in the attached file(s).";
}
