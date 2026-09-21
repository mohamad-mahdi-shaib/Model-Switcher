/**
 * Client-side provider registry.
 *
 * `enabled` here is the *static* capability flag — whether an adapter exists at
 * all. Whether it is actually usable is decided at runtime by the server's
 * availability probe (GET /api/chat), because only the server can see which
 * keys are configured. A provider is offered to the user only when both agree.
 *
 * A disabled provider must never produce a response — real or simulated.
 */

export type ProviderId = "gemini" | "claude" | "gpt";

export type Provider = {
  id: ProviderId;
  label: string;
  /** An adapter exists in the server registry. */
  enabled: boolean;
  /** Shown on hover/focus when unavailable. */
  note?: string;
  /** Restrained accent used for identity. See --accent in globals.css. */
  accent: string;
};

export const PROVIDERS: readonly Provider[] = [
  { id: "gemini", label: "Gemini", enabled: true, accent: "#6f7f9b" },
  {
    id: "claude",
    label: "Claude",
    enabled: false,
    note: "Not connected — no ANTHROPIC_API_KEY configured on the server.",
    accent: "#a8764e",
  },
  {
    id: "gpt",
    label: "GPT",
    enabled: true,
    note: "Not connected — no OPENAI_API_KEY configured on the server.",
    accent: "#4f8c72",
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
