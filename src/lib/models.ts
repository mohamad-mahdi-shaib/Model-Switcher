/**
 * Project 3: the OpenRouter model catalogue.
 *
 * Every id and every capability flag in this file was read from OpenRouter's
 * own public model catalogue (`GET https://openrouter.ai/api/v1/models`, 470
 * models at the time of writing) rather than recalled or inferred from a
 * display name. The `input_modalities` / `output_modalities` recorded there
 * are what `vision` and `imageOutput` below mean:
 *
 *   anthropic/claude-sonnet-4.5       in: text,image,file   out: text
 *   qwen/qwen2.5-vl-72b-instruct      in: text,image        out: text
 *   deepseek/deepseek-chat-v3.1       in: text              out: text
 *   google/gemini-2.5-flash-image     in: text,image        out: text,image
 *
 * The two vision models are deliberately from different vendors and model
 * families -- Anthropic's Claude Sonnet 4.5 and Alibaba's Qwen2.5-VL-72B --
 * so "two distinct vision models" means two genuinely different models, not
 * one model under two display names.
 *
 * The text-only model is here on purpose too: it is what makes the
 * capability gating in `serializeForModel()` a real, exercisable path rather
 * than dead code, since every other model this app registers accepts images.
 */

import type { ProviderId } from "@/lib/providers";

export type ModelCapabilities = {
  /** Accepts image parts as input (OpenRouter `input_modalities` has "image"). */
  vision: boolean;
  /** Emits images (OpenRouter `output_modalities` has "image"). */
  imageOutput: boolean;
};

export type OpenRouterModel = {
  /** This app's own provider id -- the wire value and the persisted key. */
  id: ProviderId;
  /** The OpenRouter model id, sent verbatim in the request. */
  openrouterId: string;
  label: string;
  capabilities: ModelCapabilities;
};

/**
 * Chat models reachable through OpenRouter. Order is the order the selector
 * renders them in.
 */
export const OPENROUTER_CHAT_MODELS: readonly OpenRouterModel[] = [
  {
    id: "or-claude",
    openrouterId: "anthropic/claude-sonnet-4.5",
    label: "Claude Sonnet 4.5",
    capabilities: { vision: true, imageOutput: false },
  },
  {
    id: "or-qwen",
    openrouterId: "qwen/qwen2.5-vl-72b-instruct",
    label: "Qwen2.5-VL 72B",
    capabilities: { vision: true, imageOutput: false },
  },
  {
    id: "or-deepseek",
    openrouterId: "deepseek/deepseek-chat-v3.1",
    label: "DeepSeek V3.1",
    capabilities: { vision: false, imageOutput: false },
  },
] as const;

/**
 * The image-generation model, used by the `/api/images` route and by the
 * `generate_image` tool.
 *
 * `google/gemini-2.5-flash-image` accepts image input AND emits image output,
 * which is what lets one model cover text-to-image, reference-guided
 * generation, editing and variations without a second integration: the
 * reference or source image is simply another image part in the request.
 *
 * Overridable with `OPENROUTER_IMAGE_MODEL` for anyone who prefers a newer or
 * dearer tier (`google/gemini-3.1-flash-image`, `google/gemini-3-pro-image`
 * and `openai/gpt-5-image` were all confirmed image-in/image-out in the same
 * catalogue read).
 */
export const DEFAULT_IMAGE_MODEL = "google/gemini-2.5-flash-image";

/** Models that may be asked to produce an image. */
export const IMAGE_CAPABLE_MODELS: readonly string[] = [
  "google/gemini-2.5-flash-image",
  "google/gemini-3.1-flash-image",
  "google/gemini-3-pro-image",
  "openai/gpt-5-image",
  "openai/gpt-5-image-mini",
] as const;

export function findOpenRouterModel(id: string): OpenRouterModel | null {
  return OPENROUTER_CHAT_MODELS.find((m) => m.id === id) ?? null;
}

export function isOpenRouterModelId(id: string): boolean {
  return OPENROUTER_CHAT_MODELS.some((m) => m.id === id);
}
