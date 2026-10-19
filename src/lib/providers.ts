/**
 * Client-side provider registry.
 *
 * `enabled` here is the *static* capability flag — whether an adapter exists at
 * all. Whether it is actually usable is decided at runtime by the server's
 * availability probe (GET /api/chat), because only the server can see which
 * keys are configured. A provider is offered to the user only when both agree.
 *
 * A disabled provider must never produce a response — real or simulated.
 *
 * Only providers this app can actually reach are listed. Anthropic was dropped
 * from the selector rather than shown permanently greyed out: an inert control
 * is noise, and "Coming soon" over something with no key and no adapter is a
 * promise the product cannot keep. Nothing about the architecture changed --
 * adding a provider is still one member of ProviderId, one entry below, one
 * adapter implementing ChatProvider, and one line in the server registry.
 */

/**
 * Project 3 added three OpenRouter-backed models. Existing ids are untouched,
 * so every saved conversation keeps loading exactly as before -- `providerId`
 * is a persisted value (see `storage.ts`) as well as a wire value.
 */
export type ProviderId =
  | "gemini"
  | "gpt"
  | "or-claude"
  | "or-qwen"
  | "or-deepseek";

export type Provider = {
  id: ProviderId;
  label: string;
  /** An adapter exists in the server registry. */
  enabled: boolean;
  /** Shown on hover/focus when unavailable. */
  note?: string;
  /** Restrained accent used for identity. See --accent in globals.css. */
  accent: string;
  /**
   * Project 3: whether this model accepts image input, taken from
   * OpenRouter's own catalogue for the OpenRouter models and from each
   * adapter's own verified behaviour for the two direct integrations. The
   * composer reads this to warn -- never to silently drop an attachment --
   * before sending images to a model that cannot read them.
   */
  vision: boolean;
};

export const PROVIDERS: readonly Provider[] = [
  { id: "gemini", label: "Gemini", enabled: true, accent: "#6f7f9b", vision: true },
  {
    id: "gpt",
    // Responsive UI refinement: the reviewer asked for consistent
    // user-facing names -- "Gemini" and "OpenAI" -- rather than "GPT". The
    // internal id stays "gpt" (it is not user-facing: it is the wire value,
    // the .env key lookup, and the data-provider/CSS-selector hook), so
    // nothing about persistence, the API contract, or existing saved
    // conversations changes.
    label: "OpenAI",
    enabled: true,
    note: "Not connected — no OPENAI_API_KEY configured on the server.",
    accent: "#4f8c72",
    vision: true,
  },
  // --- Project 3: reached through OpenRouter, one key for all three. ---
  {
    id: "or-claude",
    label: "Claude Sonnet 4.5",
    enabled: true,
    note: "Not connected — no OPENROUTER_API_KEY configured on the server.",
    accent: "#a8764e",
    vision: true,
  },
  {
    id: "or-qwen",
    label: "Qwen2.5-VL 72B",
    enabled: true,
    note: "Not connected — no OPENROUTER_API_KEY configured on the server.",
    accent: "#7c6fae",
    vision: true,
  },
  {
    id: "or-deepseek",
    label: "DeepSeek V3.1",
    enabled: true,
    note: "Not connected — no OPENROUTER_API_KEY configured on the server.",
    accent: "#4a7fa5",
    // Text-only: confirmed `input_modalities: ["text"]` in OpenRouter's
    // catalogue. The composer warns rather than dropping images silently.
    vision: false,
  },
];

export const DEFAULT_PROVIDER: ProviderId = "gemini";
export const UNAVAILABLE_LABEL = "Coming soon";

export function getProviderMeta(id: ProviderId): Provider {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}

/** Static capability check. Runtime availability is layered on top of this. */
export function isProviderEnabled(id: string): id is ProviderId {
  return PROVIDERS.some((p) => p.id === id && p.enabled);
}

/** Server availability payload from GET /api/chat. */
export type AvailabilityMap = Partial<
  Record<ProviderId, { configured: boolean; model: string; reason?: string }>
>;

/** A provider is usable only if an adapter exists AND the server has its key. */
export function isProviderUsable(
  id: ProviderId,
  availability: AvailabilityMap | null,
): boolean {
  if (!isProviderEnabled(id)) return false;
  if (!availability) return false;
  return Boolean(availability[id]?.configured);
}
