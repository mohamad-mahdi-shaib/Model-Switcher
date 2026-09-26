"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

/**
 * Whether `window.speechSynthesis` exists at all. Same server-snapshot-
 * `false` pattern as `useMediaQuery` (`@/lib/use-media-query.ts`) -- support
 * for the API does not change at runtime, so the "subscribe" side is a
 * no-op; this only exists to read `window` safely without an SSR mismatch.
 */
export function useSpeechSupported(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => typeof window !== "undefined" && "speechSynthesis" in window,
    () => false,
  );
}

/** Bounded, sensible reading-speed range. 1 is the browser/device default. */
export const MIN_SPEECH_RATE = 0.5;
export const MAX_SPEECH_RATE = 2;
export const DEFAULT_SPEECH_RATE = 1;

export function clampSpeechRate(rate: number): number {
  if (!Number.isFinite(rate)) return DEFAULT_SPEECH_RATE;
  return Math.min(MAX_SPEECH_RATE, Math.max(MIN_SPEECH_RATE, rate));
}

/** "auto" keeps the existing language-aware best-match behavior. */
export const AUTO_VOICE = "auto";

export type VoiceOption = {
  /** The real `SpeechSynthesisVoice.voiceURI` -- what a saved choice is keyed by. */
  id: string;
  name: string;
  lang: string;
};

/**
 * A preference applied only while using the Automatic voice ("auto" --
 * picking one specific voice by name makes this moot, since that voice's
 * own tone is already fixed). "any" is the default and previous behavior
 * unchanged: language match alone, no gender filtering at all.
 */
export type VoiceGenderPreference = "any" | "female" | "male";

const KNOWN_FEMALE_VOICE_NAMES = [
  "zira", "hazel", "susan", "samantha", "victoria", "karen", "moira", "tessa",
  "fiona", "veena", "salli", "joanna", "kimberly", "ivy", "kendra", "amy",
  "emma", "hoda",
];
const KNOWN_MALE_VOICE_NAMES = [
  "david", "mark", "george", "alex", "fred", "daniel", "james", "ryan",
  "brian", "justin", "naayf", "majed", "maged", "tarik",
];

/**
 * The Web Speech API's `SpeechSynthesisVoice` has no standardised gender
 * field at all -- this is a best-effort guess from the voice's own NAME
 * (many platforms name voices after a person, or literally say "Female"/
 * "Male"), never a guarantee. Returns "unknown" for a name that matches
 * neither list, which callers treat as "no preference could be honoured
 * for this one," not an error. `\b` word boundaries specifically avoid
 * "female" itself ever being misread as containing "male".
 */
export function guessVoiceGender(name: string): "female" | "male" | "unknown" {
  const lower = name.toLowerCase();
  if (/\bfemale\b/.test(lower) || KNOWN_FEMALE_VOICE_NAMES.some((n) => lower.includes(n))) return "female";
  if (/\bmale\b/.test(lower) || KNOWN_MALE_VOICE_NAMES.some((n) => lower.includes(n))) return "male";
  return "unknown";
}

/**
 * The voices this browser/device actually offers right now, loaded
 * asynchronously (Chrome, notably, populates its voice list AFTER the
 * initial `getVoices()` call resolves empty, only firing `voiceschanged`
 * once the real list is ready -- read once on mount is not enough).
 * `supported` distinguishes "no speech synthesis at all" from "supported,
 * but zero voices installed on this device," which get different UI
 * treatment (an honest unavailable state vs. an empty list with the
 * automatic option still offered).
 */
export function useVoiceOptions(): { supported: boolean; voices: VoiceOption[] } {
  const supported = useSpeechSupported();
  const [voices, setVoices] = useState<VoiceOption[]>([]);

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    const load = () => {
      const list = window.speechSynthesis.getVoices();
      if (cancelled) return;
      setVoices(list.map((v) => ({ id: v.voiceURI, name: v.name, lang: v.lang })));
    };
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => {
      cancelled = true;
      window.speechSynthesis.removeEventListener("voiceschanged", load);
    };
  }, [supported]);

  return { supported, voices };
}

/**
 * One "currently speaking" slot, backed by the browser's own
 * `speechSynthesis`. Used once per `MessageList` (which is itself keyed by
 * conversation id), so a hook-local slot is already the "one at a time"
 * guarantee the task asks for -- starting a new read cancels whatever was
 * already playing, and unmounting (a conversation switch) stops speech via
 * the cleanup effect below, rather than leaving old audio playing over a
 * transcript the user has since left.
 */
export function useSpeech() {
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);
  const supported = useSpeechSupported();

  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel();
    };
  }, []);

  const stop = useCallback(() => {
    window.speechSynthesis?.cancel();
    setSpeakingId(null);
  }, []);

  /**
   * `voiceId`: a saved `SpeechSynthesisVoice.voiceURI`, or `"auto"`. A saved
   * id that no longer matches any currently-available voice (a saved
   * choice from a different device/browser session, or a voice pack that
   * was since removed) is NOT an error -- it silently falls back to the
   * same automatic language-matched behavior `"auto"` itself uses, exactly
   * as it would if nothing had ever been chosen.
   *
   * `genderPreference` only ever applies while `voiceId` is `"auto"" -- a
   * specific chosen voice already has its own fixed tone, nothing to
   * prefer. When it does apply: a language+gender match is tried first
   * (via `guessVoiceGender()`'s best-effort name heuristic), falling back
   * to a language-only match if this device/browser has no voice for that
   * language it can confidently identify as that gender -- never silently
   * failing to speak at all just because a preferred tone was not found.
   */
  const speak = useCallback(
    (
      id: string,
      text: string,
      lang: "ar" | "en",
      voiceId: string = AUTO_VOICE,
      rate: number = DEFAULT_SPEECH_RATE,
      genderPreference: VoiceGenderPreference = "any",
    ) => {
      if (typeof window === "undefined" || !window.speechSynthesis) return;
      // Never overlap: starting a new read replaces whatever was playing.
      window.speechSynthesis.cancel();
      setErrorId(null);
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang === "ar" ? "ar-SA" : "en-US";
      utterance.rate = clampSpeechRate(rate);
      const allVoices = window.speechSynthesis.getVoices();
      const chosen = voiceId !== AUTO_VOICE ? allVoices.find((v) => v.voiceURI === voiceId) : undefined;
      let voice = chosen;
      if (!voice) {
        const languageMatches = allVoices.filter((v) => v.lang.toLowerCase().startsWith(lang));
        if (genderPreference !== "any") {
          voice = languageMatches.find((v) => guessVoiceGender(v.name) === genderPreference);
        }
        voice ??= languageMatches[0];
      }
      // Best-effort voice match; proceeding without one is not an error --
      // the browser still uses `utterance.lang` as a hint for its own
      // default voice. Never promises an identical voice across devices.
      if (voice) utterance.voice = voice;
      utterance.onend = () => setSpeakingId((current) => (current === id ? null : current));
      utterance.onerror = (event) => {
        // Cancelling a PREVIOUS utterance to start this one -- or a later
        // one -- fires the previous utterance's own onerror with exactly
        // this reason. That is normal replace-in-progress behavior, not a
        // real failure worth surfacing.
        if (event.error === "interrupted" || event.error === "canceled") return;
        setErrorId(id);
        setSpeakingId((current) => (current === id ? null : current));
      };
      setSpeakingId(id);
      window.speechSynthesis.speak(utterance);
    },
    [],
  );

  return { supported, speakingId, errorId, speak, stop };
}
