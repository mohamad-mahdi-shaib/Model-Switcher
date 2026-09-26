"use client";

/**
 * Versioned localStorage persistence for Appearance/Personalizations/Read
 * aloud settings -- background, glass style, text size, saved
 * preferences (preferred name + custom instructions), and the read-aloud
 * voice/rate choice. Deliberately one key, mirroring `storage.ts`'s own
 * conventions for conversations (safe access, corrupt-payload tolerance,
 * optional-field validation) rather than several scattered keys.
 *
 * Unlike conversation storage, a corrupt or unreadable read here is safe to
 * fall back to defaults from -- these are preferences, not user-authored
 * content, so there is nothing irreplaceable to protect by refusing to
 * write. A failed read simply means the app runs with defaults for this
 * session, and a later save still succeeds.
 */

import { migrateBackgroundId, type BackgroundId, type GlassStyleId } from "@/lib/backgrounds";
import { EMPTY_PREFERENCES, type Preferences } from "@/lib/preferences";
import { AUTO_VOICE, clampSpeechRate, DEFAULT_SPEECH_RATE, type VoiceGenderPreference } from "@/lib/use-speech";
import { DEFAULT_TEXT_SIZE, isTextSizeId, type TextSizeId } from "@/lib/text-size";

const KEY = "model-switcher:settings";
const VERSION = 1;

export type AppSettings = {
  background: BackgroundId;
  glass: GlassStyleId;
  textSize: TextSizeId;
  preferences: Preferences;
  speechVoiceId: string;
  speechRate: number;
  speechVoiceGender: VoiceGenderPreference;
};

function isVoiceGenderPreference(v: unknown): v is VoiceGenderPreference {
  return v === "any" || v === "female" || v === "male";
}

export function defaultAppSettings(defaultBackground: BackgroundId, defaultGlass: GlassStyleId): AppSettings {
  return {
    background: defaultBackground,
    glass: defaultGlass,
    textSize: DEFAULT_TEXT_SIZE,
    preferences: EMPTY_PREFERENCES,
    speechVoiceId: AUTO_VOICE,
    speechRate: DEFAULT_SPEECH_RATE,
    speechVoiceGender: "any",
  };
}

function getStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function readString(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

/**
 * Reads back whatever was saved, migrating a removed background id and
 * falling back field-by-field (never wholesale) on anything malformed --
 * one bad field must not discard an otherwise-valid save.
 */
export function loadAppSettings(defaultBackground: BackgroundId, defaultGlass: GlassStyleId): AppSettings {
  const fallback = defaultAppSettings(defaultBackground, defaultGlass);
  const storage = getStorage();
  if (!storage) return fallback;

  let raw: string | null;
  try {
    raw = storage.getItem(KEY);
  } catch {
    return fallback;
  }
  if (raw === null) return fallback;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (!parsed || typeof parsed !== "object") return fallback;
  const obj = parsed as Record<string, unknown>;
  if (obj.version !== VERSION || !obj.settings || typeof obj.settings !== "object") return fallback;
  const s = obj.settings as Record<string, unknown>;

  const glass: GlassStyleId = s.glass === "classic" || s.glass === "ultra" ? s.glass : defaultGlass;
  const textSize = isTextSizeId(s.textSize) ? s.textSize : DEFAULT_TEXT_SIZE;

  const rawPrefs = s.preferences && typeof s.preferences === "object" ? (s.preferences as Record<string, unknown>) : {};
  const preferences: Preferences = {
    preferredName: readString(rawPrefs.preferredName, ""),
    customInstructions: readString(rawPrefs.customInstructions, ""),
  };

  const speechVoiceId = readString(s.speechVoiceId, AUTO_VOICE);
  const speechRate = typeof s.speechRate === "number" ? clampSpeechRate(s.speechRate) : DEFAULT_SPEECH_RATE;
  const speechVoiceGender = isVoiceGenderPreference(s.speechVoiceGender) ? s.speechVoiceGender : "any";

  return {
    background: migrateBackgroundId(typeof s.background === "string" ? s.background : undefined),
    glass,
    textSize,
    preferences,
    speechVoiceId,
    speechRate,
    speechVoiceGender,
  };
}

export function saveAppSettings(settings: AppSettings): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(KEY, JSON.stringify({ version: VERSION, settings }));
  } catch {
    // Best effort only -- losing a preference save is not worth surfacing
    // an error over; the in-memory value the user just set still applies
    // for the rest of this session.
  }
}
