import { tool } from "ai";
import { z } from "zod";
import type { GeneratedImageRef } from "@/lib/chat";
import { generateImages, imageGenerationConfigured } from "@/server/images/generate";
import { storeGeneratedImage } from "@/server/storage/images";

/**
 * Project 3, Phase 4: the image-generation tool the CHAT MODEL selects.
 *
 * This is the real thing the brief asks for, not a button wired to
 * `/api/images`: the tool is handed to `streamText` (see
 * `@/server/providers/openrouter.ts`), the model decides on its own whether a
 * turn needs it, and `execute` runs here on the server -- so the OpenRouter
 * key never leaves the server and the client cannot invoke generation by
 * fabricating a tool call.
 *
 * Loop control: the adapter stops the agent loop after the step that follows
 * the tool call (`stopWhen: stepCountIs(2)`), and `maxImagesPerTurn` below
 * refuses a second generation inside one turn. Between them a model cannot
 * spend money in a loop, which is the failure mode the brief singles out.
 */

/** One generation per turn. Deliberately not configurable from the client. */
const MAX_IMAGES_PER_TURN = 1;

export const imageToolInputSchema = z.object({
  prompt: z
    .string()
    .min(1, "Describe the image to generate.")
    .max(2_000, "Prompt is too long.")
    .describe(
      "A complete, self-contained description of the image to generate. " +
        "Include subject, style, composition and mood. Do not reference the " +
        "conversation; this text is the only thing the image model receives.",
    ),
  useAttachedImage: z
    .boolean()
    .optional()
    .describe(
      "Set true to use the image the user attached to this turn as a visual " +
        "reference or as the image to edit. Only set it when the user's " +
        "request actually refers to their attached image.",
    ),
  operation: z
    .enum(["generate", "edit", "variation"])
    .optional()
    .describe(
      "generate = a new image from the prompt alone; edit = change the " +
        "attached image as instructed; variation = a new take on the attached " +
        "image. edit and variation require useAttachedImage.",
    ),
});

export type ImageToolInput = z.infer<typeof imageToolInputSchema>;

/**
 * What a tool call reports back to the model. The image itself goes to the
 * conversation out-of-band (`onImage`), because a base64 payload fed back
 * into the model's context would be a large, pointless cost -- the model only
 * needs to know that the image exists so it can write its sentence about it.
 */
export type ImageToolOutput =
  | { status: "ok"; summary: string; model: string; operation: string }
  | { status: "error"; error: string };

export type ImageToolContext = {
  /** Images attached to the latest user turn, for edit/variation/reference. */
  attachedImages: readonly { mimeType: string; data: string }[];
  /** Called once per successfully generated image, before the tool returns. */
  onImage: (image: GeneratedImageRef) => void;
  signal?: AbortSignal;
};

export function createImageGenerationTool(context: ImageToolContext) {
  let produced = 0;

  return tool({
    description:
      "Generate an image. Call this whenever the user asks for a picture, " +
      "illustration, logo, drawing, render, or any other visual to be " +
      "created, edited or varied. Do not call it for questions about an " +
      "image that already exists -- answer those directly in text.",
    inputSchema: imageToolInputSchema,
    execute: async ({ prompt, useAttachedImage, operation }): Promise<ImageToolOutput> => {
      if (!imageGenerationConfigured()) {
        return {
          status: "error",
          error: "Image generation is not configured on this server.",
        };
      }
      if (produced >= MAX_IMAGES_PER_TURN) {
        return {
          status: "error",
          error:
            "An image has already been generated for this message. Ask the " +
            "user if they want another before generating again.",
        };
      }

      const wantsAttachment = useAttachedImage === true || operation === "edit" || operation === "variation";
      const images = wantsAttachment ? context.attachedImages : [];

      if (wantsAttachment && images.length === 0) {
        // Honest refusal rather than silently generating something unrelated
        // and calling it an edit.
        return {
          status: "error",
          error:
            "No image is attached to this message, so there is nothing to " +
            "edit or vary. Ask the user to attach one.",
        };
      }

      const resolvedOperation = operation ?? (images.length > 0 ? "edit" : "generate");

      try {
        const result = await generateImages({
          prompt,
          images,
          operation: resolvedOperation,
          ...(context.signal ? { signal: context.signal } : {}),
        });

        for (const image of result.images) {
          const stored = await storeGeneratedImage(image.base64, image.mediaType);
          context.onImage({
            url: stored.kind === "url" ? stored.url : stored.dataUrl,
            mediaType: stored.mediaType,
            prompt,
            model: result.model,
            operation: result.operation,
            persisted: stored.kind === "url",
          });
          produced += 1;
        }

        return {
          status: "ok",
          summary:
            `The image was generated and is already shown to the user. ` +
            `Reply with one short sentence about it. Do not describe it in ` +
            `detail and do not offer to show it -- it is visible.`,
          model: result.model,
          operation: result.operation,
        };
      } catch (error) {
        // The model gets a short, safe reason it can relay; the real error
        // never reaches it (or the client) because it can carry request data.
        const code = (error as { code?: string })?.code;
        const reason =
          code === "INSUFFICIENT_CREDIT"
            ? "the image provider reported no remaining credit"
            : code === "RATE_LIMIT"
              ? "the image provider is rate limiting requests"
              : code === "EMPTY_REPLY"
                ? "the image provider returned no image for that prompt"
                : "the image provider could not be reached";
        return { status: "error", error: `Image generation failed: ${reason}.` };
      }
    },
  });
}
