import type { ChatErrorCode } from "@/lib/chat";
import { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES } from "@/lib/limits";
import {
  generateImages,
  imageGenerationConfigured,
  imageModelId,
  type ImageOperation,
  type SourceImage,
} from "@/server/images/generate";
import { ProviderError } from "@/server/providers/types";
import { blobStorageConfigured, storeGeneratedImage } from "@/server/storage/images";

/**
 * Project 3: the image-generation endpoint.
 *
 * Deliberately a sibling of `/api/chat` rather than part of it. The chat route
 * streams NDJSON and owns a conversation's whole turn; this one answers a
 * single request/response and is also called by the `generate_image` tool
 * (`@/server/images/tool.ts`) on the server side. Keeping them apart means the
 * tool path and the explicit path share one implementation
 * (`@/server/images/generate.ts`) without the chat route growing a second
 * response shape.
 *
 * Mirrors `/api/chat`'s conventions exactly: `nodejs` runtime, forced dynamic,
 * the same 300 s ceiling, the same `{ code, detail }` error envelope and the
 * same `ChatErrorCode` vocabulary, so the client's existing error copy applies
 * unchanged.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Prompt ceiling: long enough for real direction, short enough to bound cost. */
const MAX_PROMPT_CHARS = 2_000;

const OPERATIONS: readonly ImageOperation[] = ["generate", "edit", "variation"];

function errorResponse(code: ChatErrorCode, status: number, detail?: string) {
  return Response.json({ code, detail }, { status });
}

/**
 * Validates one reference image from the wire. Mirrors
 * `@/server/attachments.ts`'s discipline: the client already checks this, and
 * the server checks it again independently rather than trusting that it did.
 */
function isValidSourceImage(value: unknown): value is SourceImage {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.mimeType !== "string" || typeof v.data !== "string") return false;
  if (!/^image\/(png|jpeg|webp)$/.test(v.mimeType)) return false;
  if (v.data.length === 0) return false;
  // Base64 inflates by ~4/3; cap the decoded size at the same per-attachment
  // limit the composer enforces, so one route cannot be used to bypass it.
  if (Math.floor((v.data.length * 3) / 4) > MAX_ATTACHMENT_BYTES) return false;
  return true;
}

/** Reports what is configured, for the client's capability probe. */
export async function GET() {
  return Response.json(
    {
      configured: imageGenerationConfigured(),
      model: imageModelId(),
      storage: blobStorageConfigured() ? "blob" : "inline",
      maxPromptChars: MAX_PROMPT_CHARS,
      maxReferenceImages: MAX_ATTACHMENTS,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return errorResponse("BAD_REQUEST", 400, "Body was not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return errorResponse("BAD_REQUEST", 400, "Body must be a JSON object.");
  }

  const body = parsed as {
    prompt?: unknown;
    images?: unknown;
    operation?: unknown;
  };

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (prompt.length > MAX_PROMPT_CHARS) {
    return errorResponse(
      "BAD_REQUEST",
      400,
      `Prompt is over the ${MAX_PROMPT_CHARS.toLocaleString()}-character limit.`,
    );
  }

  const operation: ImageOperation = OPERATIONS.includes(body.operation as ImageOperation)
    ? (body.operation as ImageOperation)
    : "generate";

  let images: SourceImage[] = [];
  if (body.images !== undefined) {
    if (!Array.isArray(body.images)) {
      return errorResponse("BAD_REQUEST", 400, "`images` must be an array.");
    }
    if (body.images.length > MAX_ATTACHMENTS) {
      return errorResponse(
        "BAD_REQUEST",
        400,
        `At most ${MAX_ATTACHMENTS} reference images per request.`,
      );
    }
    if (!body.images.every(isValidSourceImage)) {
      return errorResponse(
        "BAD_REQUEST",
        400,
        "Each reference image must be PNG, JPEG or WebP and within the size limit.",
      );
    }
    images = body.images as SourceImage[];
  }

  if (!prompt && images.length === 0) {
    return errorResponse("BAD_REQUEST", 400, "Supply a prompt, a reference image, or both.");
  }
  if ((operation === "edit" || operation === "variation") && images.length === 0) {
    return errorResponse(
      "BAD_REQUEST",
      400,
      `A ${operation} needs the image it is working from.`,
    );
  }

  if (!imageGenerationConfigured()) {
    return errorResponse("MISSING_KEY", 503, "OPENROUTER_API_KEY is not set.");
  }

  try {
    const result = await generateImages({
      prompt,
      images,
      operation,
      signal: request.signal,
    });

    // Stored one by one so a single storage failure degrades only that image.
    const stored = await Promise.all(
      result.images.map(async (image) => {
        const ref = await storeGeneratedImage(image.base64, image.mediaType);
        return ref.kind === "url"
          ? { url: ref.url, mediaType: ref.mediaType, persisted: true }
          : { url: ref.dataUrl, mediaType: ref.mediaType, persisted: false };
      }),
    );

    return Response.json({
      images: stored,
      text: result.text,
      model: result.model,
      operation: result.operation,
      prompt,
    });
  } catch (error) {
    if (error instanceof ProviderError) {
      const status =
        error.code === "MISSING_KEY" || error.code === "PROVIDER_DISABLED"
          ? 503
          : error.code === "INVALID_KEY"
            ? 401
            : error.code === "INSUFFICIENT_CREDIT"
              ? 402
              : error.code === "RATE_LIMIT"
                ? 429
                : error.code === "BAD_REQUEST"
                  ? 400
                  : error.code === "ABORTED"
                    ? 499
                    : 502;
      // The code only -- never the upstream message, which can echo request
      // fragments back to the client.
      return errorResponse(error.code, status);
    }
    return errorResponse("UPSTREAM", 502);
  }
}
