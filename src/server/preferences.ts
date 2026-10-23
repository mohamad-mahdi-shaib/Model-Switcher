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
 * as requested.
 *
 * It also carries the one thing the model cannot discover for itself: what
 * this app can do with the answer once written. See FILE_CAPABILITY_NOTE.
 */

/**
 * What the app can do that the MODEL cannot do by itself.
 *
 * Without this, a model asked for a Word document answers -- accurately
 * about itself, misleadingly about the app -- "I cannot create downloadable
 * files", which is exactly what was reported. The capability is real and
 * already reachable: `SaveAnswerMenu` renders on every settled answer and
 * produces a genuine .docx / .pdf / .xlsx from the reply (see
 * `file-generation.ts`, and the tests that reopen each format). The model
 * simply had no way to know it existed, so it declined.
 *
 * So it is told, and told what to DO about it: write the document rather
 * than refuse. Deliberately narrow -- it describes one capability and does
 * not otherwise instruct the model how to answer.
 */
export const FILE_CAPABILITY_NOTE =
  "This app can turn any answer you write into a real downloadable file: every answer has a " +
  '"Save as" control offering Word (.docx), PDF, Excel (.xlsx), Markdown and code files, generated ' +
  "from your reply. So when the user asks for a document, report, spreadsheet or code file, never say " +
  "you cannot create files - write the full content as your answer, formatted with Markdown headings, " +
  "lists and tables (a Markdown table becomes a real table in Word and real cells in Excel), then tell " +
  'them to use "Save as" beneath your reply and pick the format they want.';

/**
 * Whether this turn is asking for a file, and so needs the note above.
 *
 * Added CONDITIONALLY rather than on every request, for the same reason
 * retrieved document context is: a request that has nothing to say in a
 * system instruction should still send none at all, which is a property this
 * project deliberately holds and tests for.
 *
 * The matching is generous on purpose. A false positive costs one harmless
 * sentence; a false negative returns the old behaviour of refusing outright,
 * so the asymmetry should favour matching.
 */
const FILE_REQUEST_PATTERNS: readonly RegExp[] = [
  /\b(word|docx?|pdf|xlsx?|excel|spreadsheet|csv|powerpoint|pptx?)\b/i,
  /\b(document|report|memo|letter|proposal|contract|invoice|summary document)\b/i,
  /\b(download|downloadable|export|save (it|this|that) as|generate (a|an) file|create (a|an) file)\b/i,
  /\b(write|draft|produce|generate|create|make|build)\b[^.?!]{0,40}\b(file|doc|sheet|workbook)\b/i,
];

export function wantsFile(text: string): boolean {
  return FILE_REQUEST_PATTERNS.some((pattern) => pattern.test(text));
}

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

  // Still no instruction at all when there is nothing to say: no
  // preferences, no documents, and not a file request.
  return lines.length > 0 ? lines.join("\n\n") : undefined;
}
