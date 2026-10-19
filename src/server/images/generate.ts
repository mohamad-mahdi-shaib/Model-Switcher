import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import { DEFAULT_IMAGE_MODEL } from "@/lib/models";
import { ProviderError } from "@/server/providers/types";
import { classifyOpenRouterError } from "@/server/providers/openrouter";

/**
 * Project 3: real image generation through OpenRouter.
 *
 * Route choice, and why it is the chat endpoint rather than an images
 * endpoint: `google/gemini-2.5-flash-image` is listed in OpenRouter's
 * catalogue with `input_modalities: ["image","text"]` and
 * `output_modalities: ["image","text"]` -- it is a chat model that can emit
 * images, not a dedicated text-to-image endpoint. The installed
 * `@openrouter/ai-sdk-provider` (v3.1.0) already maps `choice.message.images[]`
 * from a chat completion into AI SDK `file` content parts
 * (`dist/index.js`, the `if (choice.message.images)` branch), which the SDK
 * surfaces as `result.files`. Going through `chat()` therefore uses the path
 * the provider actually implements for these models, and the same path gives
 * image INPUT for free -- which is what makes reference images, editing and
 * variations one integration instead of three.
 *
 * `modalities: ["image","text"]` is required by OpenRouter for a model to
 * return image output, and the SDK provider does not add it, so it is passed
 * through `extraBody` (a documented setting on `OpenRouterChatSettings`).
 */

export type ImageOperation = "generate" | "edit" | "variation";

export type SourceImage = {
  mimeType: string;
  /** Base64 WITHOUT a data: prefix. */
  data: string;
};

export type GeneratedImage = {
  mediaType: string;
  base64: string;
};

export type GenerateImageInput = {
  prompt: string;
  /**
   * Reference / source images. For `edit` and `variation` this is the image
   * being worked from; for `generate` it is optional style guidance.
   */
  images?: readonly SourceImage[];
  operation?: ImageOperation;
  model?: string;
  signal?: AbortSignal;
};

export type GenerateImageResult = {
  images: GeneratedImage[];
  /** Any commentary the model returned alongside the image. */
  text: string;
  model: string;
  operation: ImageOperation;
};

const KEY_ENV = "OPENROUTER_API_KEY";

export function imageGenerationConfigured(): boolean {
  return Boolean(process.env[KEY_ENV]?.trim());
}

export function imageModelId(): string {
  return process.env.OPENROUTER_IMAGE_MODEL?.trim() || DEFAULT_IMAGE_MODEL;
}

/**
 * Operation-specific instruction. The operation is NOT merely cosmetic: an
 * edit must be anchored to the supplied image rather than treated as a fresh
 * prompt, or the result is an unrelated new image presented as an edit --
 * exactly what the brief rules out.
 */
function instructionFor(operation: ImageOperation, prompt: string, hasImages: boolean): string {
  if (operation === "edit" && hasImages) {
    return (
      "Edit the attached image as described, keeping the original composition, " +
      "subject and framing except where the instruction requires a change. " +
      `Instruction: ${prompt}`
    );
  }
  if (operation === "variation" && hasImages) {
    return (
      "Create a variation of the attached image: keep its subject, style and " +
      "overall composition recognisable while varying the details. " +
      (prompt ? `Additional direction: ${prompt}` : "")
    ).trim();
  }
  if (hasImages) {
    return `Generate an image guided by the attached reference image(s). ${prompt}`;
  }
  return prompt;
}

/**
 * Generates one or more images. Throws `ProviderError` (never a raw SDK
 * error), exactly like every chat adapter, so the routes above can use one
 * error vocabulary.
 */
export async function generateImages(input: GenerateImageInput): Promise<GenerateImageResult> {
  const key = process.env[KEY_ENV]?.trim();
  if (!key) throw new ProviderError("MISSING_KEY");

  const prompt = input.prompt.trim();
  const images = input.images ?? [];
  const operation: ImageOperation = input.operation ?? (images.length > 0 ? "edit" : "generate");

  if (!prompt && images.length === 0) {
    throw new ProviderError("BAD_REQUEST");
  }
  if ((operation === "edit" || operation === "variation") && images.length === 0) {
    // An edit with nothing to edit is a caller bug, not a provider failure.
    throw new ProviderError("BAD_REQUEST");
  }

  const model = input.model?.trim() || imageModelId();
  const openrouter = createOpenRouter({ apiKey: key });

  const parts: Array<
    { type: "text"; text: string } | { type: "image"; image: string; mediaType: string }
  > = [{ type: "text", text: instructionFor(operation, prompt, images.length > 0) }];

  for (const image of images) {
    parts.push({
      type: "image",
      image: `data:${image.mimeType};base64,${image.data}`,
      mediaType: image.mimeType,
    });
  }

  let result;
  try {
    result = await generateText({
      model: openrouter.chat(model, {
        // Required for image OUTPUT; without it OpenRouter returns text only.
        extraBody: { modalities: ["image", "text"] },
      }),
      messages: [{ role: "user", content: parts }],
      ...(input.signal ? { abortSignal: input.signal } : {}),
    });
  } catch (error) {
    throw classifyOpenRouterError(error);
  }

  const files = result.files ?? [];
  const generated: GeneratedImage[] = files
    .filter((file) => file.mediaType.startsWith("image/"))
    .map((file) => ({ mediaType: file.mediaType, base64: file.base64 }));

  if (generated.length === 0) {
    // The request succeeded but produced no image: a real, reportable
    // outcome (a refused prompt, or a model that answered in text only).
    throw new ProviderError("EMPTY_REPLY");
  }

  return {
    images: generated,
    text: result.text ?? "",
    model,
    operation,
  };
}
