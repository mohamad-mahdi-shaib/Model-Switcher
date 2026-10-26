/**
 * Project 3: the OpenRouter model catalogue.
 *
 * Every id and capability flag here was read from OpenRouter's own public
 * catalogue (`GET https://openrouter.ai/api/v1/models`) rather than recalled
 * or inferred from a display name. `input_modalities`/`output_modalities`
 * recorded there are what `vision` and `imageOutput` mean:
 *
 *   mistralai/mistral-small-3.2-24b-instruct  in: text,image  out: text
 *   deepseek/deepseek-chat-v3.1               in: text        out: text
 *   google/gemini-2.5-flash-image             in: text,image  out: text,image
 *
 * CATALOGUE-SIMPLIFICATION PASS. This list used to carry two OpenRouter
 * vision models as well -- `anthropic/claude-sonnet-4.5` and
 * `qwen/qwen2.5-vl-72b-instruct`. Both are gone:
 *
 * - Qwen stopped answering for this account entirely. Confirmed live against
 *   production: even a plain text request ("reply with just: ok") returned an
 *   error, so it was not an image-input problem. A model that cannot answer
 *   is worse than no entry.
 * - Claude was removed as redundant, not as broken. The two DIRECT
 *   integrations were live-verified on production for image description, OCR
 *   and two-image comparison -- `gemini-3.6-flash` through `@google/genai`
 *   and `gpt-5.6-luna` through the OpenAI Responses API -- which covers the
 *   vision requirement without a third vendor or a third key path.
 *
 * DeepSeek remains, and deliberately so. `openrouter.ts` is the ONLY adapter
 * that offers the `generate_image` tool (the direct Gemini and OpenAI
 * adapters have no tool wiring at all), so this entry is what keeps
 * model-SELECTED image generation alive. It is also the text-only model,
 * which keeps the capability gate in `toModelMessages()` an exercisable path
 * rather than dead code.
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
    /*
     * A vision model reached THROUGH OpenRouter, which the brief's technology
     * list asks for explicitly. The two direct integrations (Gemini, OpenAI)
     * cover vision functionally and are verified, but both bypass OpenRouter
     * entirely -- so without an entry like this one, no OpenRouter request
     * ever carries an image.
     *
     * Mistral rather than another attempt at Qwen, chosen on evidence:
     * OpenRouter's per-model endpoint data
     * (`GET /api/v1/models/:id/endpoints`) shows this model served by FOUR
     * providers, three reporting status 0 (DeepInfra, Parasail, Mistral).
     * `qwen/qwen2.5-vl-72b-instruct` has a single provider reporting -5,
     * which is exactly why every request to it failed -- including plain
     * text, so it was never an image-input problem.
     */
    id: "or-mistral",
    openrouterId: "mistralai/mistral-small-3.2-24b-instruct",
    label: "Mistral Small 3.2",
    capabilities: { vision: true, imageOutput: false },
  },
  {
    /**
     * OpenAI's model reached THROUGH OpenRouter, alongside the direct
     * integration rather than replacing it.
     *
     * Added because the direct `OPENAI_API_KEY` was rejected with a live
     * 401 `invalid_api_key` -- a credential problem, not a code one, and not
     * a billing one (that would classify as INSUFFICIENT_CREDIT). An
     * OpenRouter key cannot simply be pasted into `OPENAI_API_KEY`: the
     * direct adapter speaks the Responses API at api.openai.com, which
     * OpenRouter does not serve. Routing the same model through the
     * OpenRouter adapter needs no new credential and no new adapter.
     *
     * It is `openai/gpt-5.6-luna` -- the SAME model the direct adapter is
     * configured for -- so the two entries differ only in how they are
     * reached. The direct one stays: it is the project's second direct
     * integration, and it starts working again the moment the key is valid.
     */
    id: "or-gpt",
    openrouterId: "openai/gpt-5.6-luna",
    label: "OpenAI",
    // Confirmed from OpenRouter's catalogue: input_modalities includes
    // "image", and `tools` is in supported_parameters.
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
