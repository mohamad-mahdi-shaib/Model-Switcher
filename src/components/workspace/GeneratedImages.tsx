"use client";

import { useState } from "react";
import { DownloadIcon, LoaderIcon, RefreshIcon } from "@/components/icons";
import type { GeneratedImageRef } from "@/lib/chat";

/**
 * Project 3: renders the images a turn generated, with the follow-up actions
 * the brief asks for.
 *
 * Why these live on the message rather than in a separate gallery: the
 * reference the conversation persists (`ChatMessage.images`) already carries
 * the prompt, model and operation that produced each image, so Download,
 * Regenerate and Make a variation all act on the REAL original rather than on
 * something reconstructed from the surrounding text. That is what keeps a
 * "variation" an actual variation of this image instead of an unrelated new
 * one wearing the label.
 */

type GeneratedImagesProps = {
  images: readonly GeneratedImageRef[];
  /**
   * Re-runs the original prompt (regenerate) or asks for a variation of this
   * image. Absent while the turn is still streaming, so neither can be fired
   * at a half-finished message.
   */
  onRegenerate?: (image: GeneratedImageRef) => void;
  onVariation?: (image: GeneratedImageRef) => void;
};

/**
 * Downloads via `fetch` + object URL rather than a bare `<a download>`.
 *
 * `download` is only honoured same-origin, and a generated image is either a
 * Vercel Blob URL (cross-origin) or a `data:` URL, so the plain anchor either
 * navigates away or is ignored depending on the browser. Fetching to a Blob
 * and revoking the object URL afterwards works for both and is the one path
 * that actually saves a file.
 */
async function downloadImage(image: GeneratedImageRef): Promise<void> {
  const extension = image.mediaType.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
  const name = `generated-${Date.now()}.${extension}`;
  const response = await fetch(image.url);
  if (!response.ok) throw new Error(`Download failed (${response.status}).`);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Revoked on the next frame: revoking synchronously can cancel the
    // download in some browsers before it has started reading the blob.
    requestAnimationFrame(() => URL.revokeObjectURL(objectUrl));
  }
}

function GeneratedImage({
  image,
  onRegenerate,
  onVariation,
}: {
  image: GeneratedImageRef;
  onRegenerate?: (image: GeneratedImageRef) => void;
  onVariation?: (image: GeneratedImageRef) => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const operationLabel =
    image.operation === "edit" ? "Edited" : image.operation === "variation" ? "Variation" : "Generated";

  return (
    <figure className="mt-2 flex flex-col gap-1.5">
      {failed ? (
        <p className="rounded-xl border border-white/25 bg-white/8 px-3 py-2 text-[11px] glass-text-subtle">
          This image could not be loaded.
          {image.persisted ? "" : " It was held in this conversation only, not stored, so it is gone after a reload."}
        </p>
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element --
           the source is a Blob URL or a data: URL decided at runtime;
           next/image would need every such host pre-registered in
           next.config.ts and cannot handle a data URL at all, and it buys
           nothing for a one-off generated asset that is already sized by
           the provider. */
        <img
          alt={image.prompt ? `${operationLabel}: ${image.prompt}` : operationLabel}
          className="max-h-[420px] w-auto max-w-full rounded-xl border border-white/25 object-contain"
          loading="lazy"
          onError={() => setFailed(true)}
          src={image.url}
        />
      )}

      <figcaption className="flex flex-wrap items-center gap-2 text-[10px] glass-text-subtle">
        <span className="truncate">
          {operationLabel} · {image.model}
        </span>

        <button
          className="focus-glass inline-flex min-h-11 items-center gap-1 rounded-lg px-1.5 hover:bg-white/10 hover:glass-text-dark disabled:opacity-50"
          disabled={downloading || failed}
          onClick={async () => {
            setDownloading(true);
            setError(null);
            try {
              await downloadImage(image);
            } catch {
              setError("Download failed. Try again, or open the image in a new tab.");
            } finally {
              setDownloading(false);
            }
          }}
          type="button"
        >
          {downloading ? (
            <LoaderIcon className="h-3 w-3 animate-spin" />
          ) : (
            <DownloadIcon className="h-3 w-3" />
          )}
          Download
        </button>

        {onRegenerate ? (
          <button
            className="focus-glass inline-flex min-h-11 items-center gap-1 rounded-lg px-1.5 hover:bg-white/10 hover:glass-text-dark"
            onClick={() => onRegenerate(image)}
            type="button"
          >
            <RefreshIcon className="h-3 w-3" />
            Regenerate
          </button>
        ) : null}

        {onVariation && !failed ? (
          <button
            className="focus-glass inline-flex min-h-11 items-center rounded-lg px-1.5 hover:bg-white/10 hover:glass-text-dark"
            onClick={() => onVariation(image)}
            type="button"
          >
            Make a variation
          </button>
        ) : null}

        {!image.persisted ? (
          <span title="Image storage is not configured on this server, so this image lives only in this browser.">
            not stored
          </span>
        ) : null}
      </figcaption>

      {error ? (
        <p className="text-[10px] glass-text-subtle" role="alert">
          {error}
        </p>
      ) : null}
    </figure>
  );
}

export function GeneratedImages({ images, onRegenerate, onVariation }: GeneratedImagesProps) {
  if (images.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {images.map((image, index) => (
        <GeneratedImage
          image={image}
          key={`${image.url}-${index}`}
          onRegenerate={onRegenerate}
          onVariation={onVariation}
        />
      ))}
    </div>
  );
}
