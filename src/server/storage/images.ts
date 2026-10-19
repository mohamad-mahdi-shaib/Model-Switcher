import { put } from "@vercel/blob";

/**
 * Project 3: durable storage for generated images.
 *
 * Why this is optional rather than required: the app's existing design keeps
 * user data in the browser (conversations in localStorage, attachment bytes
 * in IndexedDB) and ships no account system. Generated images follow the same
 * rule -- they are returned to the conversation and persisted with it in the
 * browser -- so the app works with no storage configured at all.
 *
 * When `BLOB_READ_WRITE_TOKEN` IS configured, generated images are uploaded to
 * Vercel Blob and the conversation keeps a stable https URL instead of a
 * multi-hundred-kilobyte base64 string. That is the real benefit: it keeps the
 * persisted conversation small and gives the download action a direct URL.
 *
 * `access: "public"` is Vercel Blob's only supported value today, and the
 * pathname carries a random suffix (`addRandomSuffix`), so a URL is
 * unguessable but not secret. Nothing private is written here -- only images
 * the user just asked this app to generate -- and the README states that
 * plainly rather than implying a stronger guarantee than Blob offers.
 */

const TOKEN_ENV = "BLOB_READ_WRITE_TOKEN";

export function blobStorageConfigured(): boolean {
  return Boolean(process.env[TOKEN_ENV]?.trim());
}

export type StoredImage =
  | { kind: "url"; url: string; mediaType: string }
  | { kind: "inline"; dataUrl: string; mediaType: string };

function extensionFor(mediaType: string): string {
  if (mediaType === "image/png") return "png";
  if (mediaType === "image/webp") return "webp";
  if (mediaType === "image/gif") return "gif";
  return "jpg";
}

/**
 * Stores one generated image and returns how to reference it.
 *
 * Never throws: a storage failure must not lose an image the user already
 * paid a provider call for, so the inline data URL is returned instead and the
 * conversation still renders. The caller decides whether to mention the
 * degraded path.
 */
export async function storeGeneratedImage(
  base64: string,
  mediaType: string,
): Promise<StoredImage> {
  const token = process.env[TOKEN_ENV]?.trim();
  const dataUrl = `data:${mediaType};base64,${base64}`;
  if (!token) return { kind: "inline", dataUrl, mediaType };

  try {
    const bytes = Buffer.from(base64, "base64");
    const blob = await put(`generated/${Date.now()}.${extensionFor(mediaType)}`, bytes, {
      access: "public",
      contentType: mediaType,
      addRandomSuffix: true,
      token,
    });
    return { kind: "url", url: blob.url, mediaType };
  } catch {
    // Deliberately swallowed: see the doc comment. The error itself is not
    // surfaced because it can carry the token-bearing request URL.
    return { kind: "inline", dataUrl, mediaType };
  }
}
