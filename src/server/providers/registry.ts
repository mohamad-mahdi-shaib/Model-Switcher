import type { ProviderId } from "@/lib/providers";
import { geminiProvider } from "@/server/providers/gemini";
import { openaiProvider } from "@/server/providers/openai";
import type { ChatProvider } from "@/server/providers/types";

/**
 * Server-side provider registry.
 *
 * Adding a provider = write an adapter implementing ChatProvider, then add one
 * line here. The API route never learns a vendor name.
 *
 * Anthropic is intentionally absent rather than stubbed: an adapter that cannot
 * reach a real model would either fabricate replies or fail confusingly. It is
 * absent from the client-side PROVIDERS list too, so the selector never offers
 * a control that cannot answer. Adding it later is an adapter file, one line
 * here, and one entry in src/lib/providers.ts.
 *
 * Registration alone does not make a provider usable. Each adapter's
 * availability() decides that from whether its key is present on the server,
 * and "key present" means configured -- not validated, and not funded.
 */

const REGISTRY: Partial<Record<ProviderId, ChatProvider>> = {
  gemini: geminiProvider,
  gpt: openaiProvider,
  // claude: anthropicProvider <- needs the adapter, a ProviderId member,
  //                               a PROVIDERS entry and ANTHROPIC_API_KEY
};

export function getProvider(id: string): ChatProvider | null {
  return REGISTRY[id as ProviderId] ?? null;
}

export function listProviders(): ChatProvider[] {
  return Object.values(REGISTRY).filter(Boolean) as ChatProvider[];
}

/** Availability of every registered provider, for the client's capability probe. */
export function providerAvailability(): Record<
  string,
  { configured: boolean; model: string; reason?: string }
> {
  const out: Record<string, { configured: boolean; model: string; reason?: string }> = {};
  for (const provider of listProviders()) {
    out[provider.id] = provider.availability();
  }
  return out;
}
