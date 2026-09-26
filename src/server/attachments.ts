import type { WireAttachment } from "@/lib/chat";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENTS_TOTAL_BYTES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_TEXT_CHARS,
  PDF_MIME_TYPE,
} from "@/lib/limits";

/**
 * Server-side attachment validation -- the authoritative gate. Never trusts
 * the client's own declared size, mime type, or extension: every check
 * here is against the DECODED bytes (or decoded text length) this process
 * actually received, the same discipline `isValidWireMessage` already
 * applies to a plain message's `content`.
 */

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47];
const JPEG_SIG = [0xff, 0xd8, 0xff];
const PDF_SIG = [0x25, 0x50, 0x44, 0x46]; // "%PDF"

function matchesSignature(bytes: Buffer, sig: number[]): boolean {
  return sig.every((b, i) => bytes[i] === b);
}

function isWebp(bytes: Buffer): boolean {
  const riff = [0x52, 0x49, 0x46, 0x46];
  const webp = [0x57, 0x45, 0x42, 0x50];
  return riff.every((b, i) => bytes[i] === b) && webp.every((b, i) => bytes[i + 8] === b);
}

function sniffMatches(kind: "image" | "pdf", mimeType: string, bytes: Buffer): boolean {
  if (kind === "pdf") return matchesSignature(bytes, PDF_SIG);
  if (mimeType === "image/png") return matchesSignature(bytes, PNG_SIG);
  if (mimeType === "image/jpeg") return matchesSignature(bytes, JPEG_SIG);
  if (mimeType === "image/webp") return isWebp(bytes);
  return false;
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validates and decodes one attachment entry. Returns the decoded byte
 * length actually used (for the combined-size check the caller performs
 * across the whole array) alongside the validated attachment, or a
 * rejection reason -- never throws on malformed input, matching
 * `isValidWireMessage`'s own "reject, don't crash" discipline for
 * anything client-controlled.
 */
function validateOne(v: unknown): { ok: true; attachment: WireAttachment; bytes: number } | { ok: false } {
  if (!isPlainRecord(v)) return { ok: false };
  const kind = v.kind;
  const name = v.name;
  const mimeType = v.mimeType;
  if (typeof name !== "string" || !name || name.length > 255) return { ok: false };
  if (typeof mimeType !== "string") return { ok: false };

  if (kind === "text") {
    const text = v.text;
    if (typeof text !== "string" || text.length === 0 || text.length > MAX_ATTACHMENT_TEXT_CHARS) {
      return { ok: false };
    }
    return { ok: true, attachment: { kind: "text", mimeType, name, text }, bytes: text.length };
  }

  if (kind !== "image" && kind !== "pdf") return { ok: false };
  if (kind === "image" && !(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return { ok: false };
  }
  if (kind === "pdf" && mimeType !== PDF_MIME_TYPE) return { ok: false };

  const data = v.data;
  if (typeof data !== "string" || data.length === 0) return { ok: false };
  let bytes: Buffer;
  try {
    bytes = Buffer.from(data, "base64");
  } catch {
    return { ok: false };
  }
  // An empty decode from a non-empty string means the input was not valid
  // base64 in the first place, not genuinely a zero-byte file.
  if (bytes.length === 0) return { ok: false };
  if (bytes.length > MAX_ATTACHMENT_BYTES) return { ok: false };
  // Real content verification, never trusting the declared mimeType alone.
  if (!sniffMatches(kind, mimeType, bytes)) return { ok: false };

  return { ok: true, attachment: { kind, mimeType, name, data }, bytes: bytes.length };
}

/**
 * Validates a whole message's `attachments` array. `undefined` (no
 * attachments) is valid -- the overwhelmingly common case, and every
 * existing message shape must keep working unchanged.
 */
export function validateWireAttachments(v: unknown): v is WireAttachment[] | undefined {
  if (v === undefined) return true;
  if (!Array.isArray(v)) return false;
  if (v.length === 0 || v.length > MAX_ATTACHMENTS) return false;
  let total = 0;
  for (const entry of v) {
    const result = validateOne(entry);
    if (!result.ok) return false;
    total += result.bytes;
  }
  if (total > MAX_ATTACHMENTS_TOTAL_BYTES) return false;
  return true;
}
