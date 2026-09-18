/**
 * Provider registry.
 *
 * Only Gemini is connected. Claude and GPT stay visible so the switcher reads
 * as intended, but `enabled: false` is enforced in three independent places:
 * the selector cannot focus or activate them, the send path refuses to run
 * unless the active provider is enabled, and the API route rejects any provider
 * other than Gemini. A disabled provider must never produce a response --
 * real or simulated.
 */

export type ProviderId = "gemini" | "claude" | "gpt";

export type Provider = {
  id: ProviderId;
  label: string;
  enabled: boolean;
  /** Shown on hover/focus for disabled providers. */
  note?: string;
};

export const PROVIDERS: readonly Provider[] = [
  { id: "gemini", label: "Gemini", enabled: true },
  {
    id: "claude",
    label: "Claude",
    enabled: false,
    note: "This provider is not connected yet.",
  },
  {
    id: "gpt",
    label: "GPT",
    enabled: false,
    note: "This provider is not connected yet.",
  },
];

export const DEFAULT_PROVIDER: ProviderId = "gemini";

export const COMING_SOON_LABEL = "Coming soon";

export function isProviderEnabled(id: string): id is ProviderId {
  return PROVIDERS.some((p) => p.id === id && p.enabled);
}
