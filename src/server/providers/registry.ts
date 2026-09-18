import type { ProviderId } from "@/lib/providers";
import { geminiProvider } from "@/server/providers/gemini";
import type { ChatProvider } from "@/server/providers/types";

/**
 * Server-side provider registry.
 *
 * Adding a provider = write an adapter implementing ChatProvider, then add one
 * line here. The API route never learns a vendor name.
 *
 * Adapters for OpenAI and Anthropic are intentionally absent rather than
 * stubbed: an adapter that cannot reach a real model would either fabricate
 * replies or fail confusingly. Both stay unavailable until a real key exists.
 */

const REGISTRY: Partial<Record<ProviderId, ChatProvider>> = {
  gemini: geminiProvider,
  // openai: openaiProvider,     <- requires OPENAI_API_KEY
  // anthropic: anthropicProvider <- requires ANTHROPIC_API_KEY
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
