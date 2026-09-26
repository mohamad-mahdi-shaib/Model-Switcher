/**
 * Personalizations (Settings > Personalizations): a preferred name and
 * custom instructions, saved locally in this browser and sent -- separately
 * from conversation messages, through the request's own `preferences` field
 * -- with every future request to the selected provider. This is NOT an
 * account/login feature: nothing here is tied to an identity server-side,
 * only to whatever this browser has saved (see `app-settings-storage.ts`
 * for the client-side persistence, and `@/server/preferences.ts` for how a
 * server request turns this into each provider's own instruction field).
 *
 * Shared between client and server (no "use client"): the client uses
 * `validatePreferences()` before saving and before sending, the server uses
 * the exact same function to independently re-validate what actually
 * arrived on the wire, never trusting the client's own check alone.
 */

/** Long enough for a real name, short enough to never crowd a request. */
export const MAX_PREFERRED_NAME_CHARS = 80;
/** Generous for a few real sentences of guidance, capped so it can never
 * dominate a request the way an accidentally-pasted document would. */
export const MAX_CUSTOM_INSTRUCTIONS_CHARS = 1500;

export type Preferences = {
  preferredName: string;
  customInstructions: string;
};

export const EMPTY_PREFERENCES: Preferences = {
  preferredName: "",
  customInstructions: "",
};

/** Empty preferences must be indistinguishable from "no preferences at all". */
export function hasPreferences(p: Preferences | null | undefined): boolean {
  return Boolean(p && (p.preferredName.trim().length > 0 || p.customInstructions.trim().length > 0));
}

export type PreferencesRejection =
  | { ok: false; reason: "preferredNameTooLong"; limit: number }
  | { ok: false; reason: "customInstructionsTooLong"; limit: number }
  | { ok: false; reason: "malformed" };

export type PreferencesValidation = { ok: true } | PreferencesRejection;

/**
 * Structural + length validation only. Used identically client-side (before
 * saving, before sending) and server-side (re-checking what actually
 * arrived, never trusting the client's own check alone -- the same
 * discipline `validateAttachmentSizes`/`validateWireAttachments` already
 * apply to attachments).
 */
export function validatePreferences(v: unknown): PreferencesValidation {
  if (!v || typeof v !== "object") return { ok: false, reason: "malformed" };
  const p = v as Record<string, unknown>;
  if (typeof p.preferredName !== "string" || typeof p.customInstructions !== "string") {
    return { ok: false, reason: "malformed" };
  }
  if (p.preferredName.length > MAX_PREFERRED_NAME_CHARS) {
    return { ok: false, reason: "preferredNameTooLong", limit: MAX_PREFERRED_NAME_CHARS };
  }
  if (p.customInstructions.length > MAX_CUSTOM_INSTRUCTIONS_CHARS) {
    return { ok: false, reason: "customInstructionsTooLong", limit: MAX_CUSTOM_INSTRUCTIONS_CHARS };
  }
  return { ok: true };
}

export function preferencesRejectionMessage(rejection: PreferencesRejection): string {
  switch (rejection.reason) {
    case "preferredNameTooLong":
      return `Preferred name is over the ${rejection.limit}-character limit.`;
    case "customInstructionsTooLong":
      return `Custom instructions are over the ${rejection.limit.toLocaleString()}-character limit.`;
    case "malformed":
      return "Preferences could not be saved.";
  }
}
