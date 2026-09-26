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
 *
 * A `Map`, not a plain object (Finding F4): a plain object literal is indexed
 * off `Object.prototype`, so `REGISTRY["constructor"]` or
 * `REGISTRY["__proto__"]` resolved to an inherited value -- the `Object`
 * constructor function, or `Object.prototype` itself -- which is truthy and
 * so passed the registry's own `?? null` check, then failed downstream with
 * `provider.availability is not a function` instead of the intended
 * `PROVIDER_DISABLED`. A `Map`'s keys are never looked up through a prototype
 * chain, so `.get("__proto__")` and `.get("constructor")` simply miss, exactly
 * like any other unregistered id.
 */

const REGISTRY = new Map<ProviderId, ChatProvider>([
  ["gemini", geminiProvider],
  ["gpt", openaiProvider],
  // ["claude", anthropicProvider] <- needs the adapter, a ProviderId member,
  //                                   a PROVIDERS entry and ANTHROPIC_API_KEY
]);

export function getProvider(id: string): ChatProvider | null {
  return REGISTRY.get(id as ProviderId) ?? null;
}

export function listProviders(): ChatProvider[] {
  return [...REGISTRY.values()];
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
