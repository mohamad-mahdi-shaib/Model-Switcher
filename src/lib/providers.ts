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
 * Project 3 added OpenRouter-backed models; the catalogue-simplification pass
 * then reduced them to one. `providerId` is a persisted value (see
 * `storage.ts`) as well as a wire value, so removed ids are migrated rather
 * than left dangling -- see `migrateProviderId` below.
 */
export type ProviderId = "gemini" | "gpt" | "or-gpt" | "or-mistral" | "or-deepseek";

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
  /*
   * Project 3, reached through OpenRouter. Claude Sonnet 4.5 and Qwen2.5-VL
   * 72B were removed in the catalogue-simplification pass: Gemini and OpenAI
   * were both live-verified for image description, OCR and multi-image
   * comparison, which made a third and fourth vision model redundant, and
   * Qwen had stopped responding for this account on any request at all
   * (plain text included).
   *
   * DeepSeek stays, and it is NOT redundant: `openrouter.ts` is the only
   * adapter that offers the `generate_image` tool, so this entry is what
   * keeps model-SELECTED image generation working. Removing it would leave
   * generation reachable only by an explicit button, which is exactly what
   * the requirement rules out. It is also the text-only model, so it is what
   * keeps the capability gate a reachable path.
   */
  {
    // The vision model reached through OpenRouter -- see `models.ts` for why
    // Mistral specifically, and why not a second attempt at Qwen.
    id: "or-mistral",
    label: "Mistral Small 3.2",
    enabled: true,
    note: "Not connected — no OPENROUTER_API_KEY configured on the server.",
    accent: "#b4714a",
    vision: true,
  },
  {
    /**
     * The same OpenAI model as the `gpt` entry above, reached through
     * OpenRouter instead of directly. Both are offered: the direct one is
     * the project's second direct integration, and this one keeps OpenAI
     * reachable while that key is being sorted out. See `models.ts`.
     */
    id: "or-gpt",
    label: "OpenAI",
    enabled: true,
    note: "Not connected — no OPENROUTER_API_KEY configured on the server.",
    accent: "#4f8c72",
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

/**
 * Resolves a persisted `providerId` that no longer exists.
 *
 * A conversation saved while Claude Sonnet 4.5 or Qwen2.5-VL was selectable
 * still carries that id. Without this it would fall through
 * `getProviderMeta`'s `?? PROVIDERS[0]` and silently *display* as Gemini
 * while the stored value stayed invalid -- so a later send would post an
 * unregistered provider and be rejected. Both removed models were vision
 * models, so both migrate to Gemini, the direct vision integration that
 * replaced them.
 *
 * Same discipline as `migrateBackgroundId`: every id this app has ever
 * persisted resolves to a real current one.
 */
const MIGRATED_PROVIDER_IDS: Record<string, ProviderId> = {
  "or-claude": "gemini",
  "or-qwen": "gemini",
  /**
   * The DIRECT OpenAI integration, hidden from the selector while its key is
   * rejected (a live 401 `invalid_api_key`). It is not deleted: the adapter,
   * its tests and its registry entry all stay, so re-listing it here is a
   * one-line change once the key is valid.
   *
   * Migrating to `or-gpt` rather than to Gemini because it is literally the
   * same model -- `gpt-5.6-luna`, reached through OpenRouter instead of
   * api.openai.com -- so a conversation that was using OpenAI carries on
   * using OpenAI. Without this a saved conversation would keep an id that
   * `isProviderEnabled` now rejects, and every send from it would be refused
   * as "provider disabled".
   */
  gpt: "or-gpt",
};

export function migrateProviderId(id: string | undefined | null): ProviderId {
  if (PROVIDERS.some((p) => p.id === id)) return id as ProviderId;
  // `Object.hasOwn`, never `in`: `"__proto__" in {}` is TRUE, so an `in`
  // check would match a saved id of "__proto__"/"constructor" and return an
  // inherited value from Object.prototype instead of a ProviderId. The same
  // trap `registry.ts` documents for its own lookup -- caught here by the
  // malformed-id test rather than in production.
  if (typeof id === "string" && Object.hasOwn(MIGRATED_PROVIDER_IDS, id)) {
    return MIGRATED_PROVIDER_IDS[id];
  }
  return DEFAULT_PROVIDER;
}

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
