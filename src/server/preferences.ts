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
export function buildSystemInstructionText(
  preferences: Preferences | undefined,
  documentContext?: string,
): string | undefined {
  const lines: string[] = [];

  const name = preferences?.preferredName.trim();
  const custom = preferences?.customInstructions.trim();
  if (name) {
    lines.push(
      `The user's preferred name is "${name}". Use it naturally where it fits (such as a greeting), without forcing it into every reply.`,
    );
  }
  if (custom) {
    lines.push(`The user has also asked for this guidance on how to respond:\n${custom}`);
  }

  /**
   * Project 4: retrieved document passages, rendered by
   * `@/server/documents/retrieve.ts`.
   *
   * It goes LAST, after the user's own personalizations, for two reasons.
   * It is the most specific instruction for this one turn, and position
   * matters for adherence -- the "cite the file and page, and say so when
   * the passages do not answer the question" rule needs to be the nearest
   * instruction to the question, not buried above a block of preferences.
   *
   * It is also passed HERE, as a system instruction, rather than spliced
   * into the conversation's own messages: document text is untrusted input,
   * and keeping it out of the user/assistant turns means it can never be
   * mistaken later for something the user actually typed -- including when
   * the transcript is replayed on the next turn, exported, or re-sent after
   * a model switch.
   */
  const context = documentContext?.trim();
  if (context) lines.push(context);

  // No preferences and no documents builds no instruction at all, so such a
  // request is byte-for-byte what it was before either feature existed.
  return lines.length > 0 ? lines.join("\n\n") : undefined;
}
