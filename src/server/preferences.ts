import type { Preferences } from "@/lib/preferences";

/**
 * Turns saved Personalizations into ONE plain-text instruction string,
 * shared by both adapters (`gemini.ts` passes it as `systemInstruction`,
 * `openai.ts` passes it as the Responses API's top-level `instructions`
 * field) so the actual wording a model sees is identical across providers,
 * not maintained twice.
 *
 * The preferred name is treated as DATA, not concatenated blindly into an
 * instruction string as if it were itself a command -- it is named
 * explicitly ("The user's preferred name is ...") and the model is told to
 * use it naturally rather than forced to repeat it in every reply, exactly
 * as requested. Returns `undefined` when both fields are empty, so a
 * request with no saved preferences builds no instruction at all -- the
 * empty-defaults-preserve-current-behavior requirement, satisfied by never
 * adding a field rather than by adding an empty one.
 */
export function buildSystemInstructionText(preferences: Preferences | undefined): string | undefined {
  if (!preferences) return undefined;
  const name = preferences.preferredName.trim();
  const custom = preferences.customInstructions.trim();
  if (!name && !custom) return undefined;

  const lines: string[] = [];
  if (name) {
    lines.push(
      `The user's preferred name is "${name}". Use it naturally where it fits (such as a greeting), without forcing it into every reply.`,
    );
  }
  if (custom) {
    lines.push(`The user has also asked for this guidance on how to respond:\n${custom}`);
  }
  return lines.join("\n\n");
}
