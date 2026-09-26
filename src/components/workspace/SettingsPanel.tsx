"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertIcon,
  CheckIcon,
  DownloadIcon,
  GearIcon,
  SpeakerIcon,
  TrashIcon,
  XIcon,
} from "@/components/icons";
import {
  BACKGROUND_COLLECTIONS,
  BACKGROUNDS,
  GLASS_STYLES,
  type BackgroundId,
  type GlassStyleId,
} from "@/lib/backgrounds";
import {
  MAX_CUSTOM_INSTRUCTIONS_CHARS,
  MAX_PREFERRED_NAME_CHARS,
  validatePreferences,
  preferencesRejectionMessage,
  type Preferences,
} from "@/lib/preferences";
import { TEXT_SIZES, type TextSizeId } from "@/lib/text-size";
import {
  AUTO_VOICE,
  MAX_SPEECH_RATE,
  MIN_SPEECH_RATE,
  type VoiceGenderPreference,
  type VoiceOption,
} from "@/lib/use-speech";

/**
 * Settings pass: ONE overlay, mounted ONCE (here, in `ConversationSidebar`'s
 * own top level, exactly like the previous `SettingsMobileSheet` was),
 * portaled to a stacking-context-free container, gated purely on `open`.
 *
 * This replaces the previous TWO components (`SettingsDesktopPopover` +
 * `SettingsMobileSheet`) that used to sit here, each gated by its OWN
 * `useMediaQuery` breakpoint (639px) independent of the sidebar's own
 * compact/drawer threshold (1023px), with the desktop variant nested
 * *inside* `SidebarBody`'s own footer. In the 640-1023px range that mismatch
 * meant: opening Settings from inside the drawer closed the drawer (since
 * they shared the same `activeOverlay` slot) as intended, but neither
 * variant could actually render anything -- the mobile sheet's guard
 * (`isMobileSheet`) was false at that width, and the desktop popover, while
 * its OWN guard was true, only existed inside the full `<aside>`'s copy of
 * `SidebarBody`, which is `display:none` below `lg` (1024px). The result
 * was confirmed with a real pointer click at 900px width: the workspace/
 * drawer closed and nothing replaced it -- exactly the reported bug.
 *
 * The fix here is architectural, not a threshold tweak: ONE component, ONE
 * mount point independent of the sidebar/drawer's own lifecycle, and the
 * dialog-vs-sheet layout switch is done with plain CSS (`sm:` responsive
 * classes) inside that single mount, rather than two separate React
 * components gated by two independently-computed `useMediaQuery` hooks that
 * can disagree with each other or with a third breakpoint elsewhere.
 */

const FOCUSABLE_SELECTOR = "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

type Section = "appearance" | "personalizations" | "readAloud" | "conversations";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "appearance", label: "Appearance" },
  { id: "personalizations", label: "Personalizations" },
  { id: "readAloud", label: "Read aloud" },
  { id: "conversations", label: "Conversations" },
];

function SectionHeading({ children }: { children: string }) {
  return (
    <h3 className="px-0.5 text-[9.5px] font-semibold tracking-[0.12em] uppercase glass-text-subtle">
      {children}
    </h3>
  );
}

/* ----------------------------------------------------------------- Appearance */

function AppearanceSection({
  background,
  glass,
  textSize,
  onSelectBackground,
  onSelectGlass,
  onSelectTextSize,
}: {
  background: BackgroundId;
  glass: GlassStyleId;
  textSize: TextSizeId;
  onSelectBackground: (id: BackgroundId) => void;
  onSelectGlass: (id: GlassStyleId) => void;
  onSelectTextSize: (id: TextSizeId) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Background" className="flex flex-col gap-2">
        <SectionHeading>Background</SectionHeading>
        <div aria-label="Background" className="flex flex-col gap-2.5" role="radiogroup">
          {BACKGROUND_COLLECTIONS.map((collection) => {
            const inCollection = BACKGROUNDS.filter((b) => b.collection === collection);
            if (inCollection.length === 0) return null;
            return (
              <div className="flex flex-col gap-1.5" key={collection}>
                <p className="px-0.5 text-[9px] font-medium tracking-wider uppercase glass-text-subtle opacity-80">
                  {collection}
                </p>
                {inCollection.map((bg) => {
                  const isActive = bg.id === background;
                  return (
                    <button
                      aria-checked={isActive}
                      className="bg-card focus-glass flex min-h-11 w-full cursor-pointer items-center justify-between rounded-xl p-1.5 text-left"
                      key={bg.id}
                      onClick={() => onSelectBackground(bg.id)}
                      role="radio"
                      type="button"
                    >
                      <span className="flex items-center gap-2.5">
                        <span
                          className="h-8 w-8 shrink-0 rounded-lg border border-white/70 shadow-sm"
                          style={{ background: bg.swatch }}
                        />
                        <span className="block">
                          <span className="block text-[11.5px] font-semibold leading-tight glass-text-dark">
                            {bg.name}
                          </span>
                          <span className="block text-[9.5px] glass-text-subtle">{bg.description}</span>
                        </span>
                      </span>
                      {isActive ? (
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/90 text-[#1a1c22] shadow-sm">
                          <CheckIcon className="h-2.5 w-2.5" />
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </section>

      <section aria-label="Glass appearance" className="flex flex-col gap-2 border-t border-white/30 pt-3">
        <SectionHeading>Glass appearance</SectionHeading>
        <div aria-label="Glass appearance" className="grid grid-cols-2 gap-1.5" role="radiogroup">
          {GLASS_STYLES.map((style) => {
            const isActive = style.id === glass;
            return (
              <button
                aria-checked={isActive}
                className="bg-card focus-glass flex min-h-11 cursor-pointer flex-col gap-1.5 rounded-xl p-2 text-left"
                key={style.id}
                onClick={() => onSelectGlass(style.id)}
                role="radio"
                type="button"
              >
                <span className="flex items-center justify-between">
                  <span className="text-[11.5px] font-semibold leading-tight glass-text-dark">{style.name}</span>
                  {isActive ? (
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/90 text-[#1a1c22] shadow-sm">
                      <CheckIcon className="h-2.5 w-2.5" />
                    </span>
                  ) : null}
                </span>
                <span className="block text-[9.5px] leading-snug glass-text-subtle">{style.description}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section aria-label="Text size" className="flex flex-col gap-2 border-t border-white/30 pt-3">
        <SectionHeading>Text size</SectionHeading>
        <div aria-label="Text size" className="grid grid-cols-3 gap-1.5" role="radiogroup">
          {TEXT_SIZES.map((size) => {
            const isActive = size.id === textSize;
            return (
              <button
                aria-checked={isActive}
                className={`focus-glass flex min-h-11 items-center justify-center rounded-xl border text-[11.5px] font-medium ${
                  isActive ? "border-white/70 bg-white/20 glass-text-dark" : "border-white/25 bg-white/8 glass-text-subtle hover:bg-white/12"
                }`}
                key={size.id}
                onClick={() => onSelectTextSize(size.id)}
                role="radio"
                type="button"
              >
                {size.name}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------ Personalizations */

function PersonalizationsSection({
  preferences,
  onSave,
}: {
  preferences: Preferences;
  onSave: (next: Preferences) => void;
}) {
  // Initialized once from the saved value, not kept in sync via an effect:
  // this section is conditionally rendered (unmounted when another Settings
  // tab is active), so switching back to Personalizations remounts it and
  // re-reads whatever is currently saved -- the only thing that ever
  // changes the saved value is this section's own Save/Reset below, so
  // there is no external change to synchronize while it stays mounted.
  const [name, setName] = useState(preferences.preferredName);
  const [instructions, setInstructions] = useState(preferences.customInstructions);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = (next: Preferences) => {
    const validation = validatePreferences(next);
    if (!validation.ok) {
      setError(preferencesRejectionMessage(validation));
      return;
    }
    onSave(next);
    setError(null);
    setNotice("Saved.");
    setTimeout(() => setNotice(null), 1800);
  };

  const reset = () => {
    const empty: Preferences = { preferredName: "", customInstructions: "" };
    setName(empty.preferredName);
    setInstructions(empty.customInstructions);
    onSave(empty);
    setError(null);
    setNotice("Reset.");
    setTimeout(() => setNotice(null), 1800);
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[10.5px] leading-snug glass-text-subtle">
        These preferences are saved in this browser and sent to the selected AI provider with future requests. This
        is not an account or login feature -- nothing here is tied to an identity.
      </p>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-medium glass-text-subtle">Preferred name</span>
        <input
          className="focus-glass h-11 w-full rounded-xl border border-white/25 bg-white/10 px-3 text-[12px] glass-text-dark outline-none placeholder:glass-text-subtle"
          maxLength={MAX_PREFERRED_NAME_CHARS}
          onChange={(e) => setName(e.target.value)}
          placeholder="How should the AI address you?"
          type="text"
          value={name}
        />
        <span className="self-end text-[9px] glass-text-subtle">
          {name.length}/{MAX_PREFERRED_NAME_CHARS}
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-medium glass-text-subtle">Custom instructions</span>
        <textarea
          className="glass-scroll focus-glass min-h-[90px] w-full resize-y rounded-xl border border-white/25 bg-white/10 px-3 py-2 text-[12px] leading-relaxed glass-text-dark outline-none placeholder:glass-text-subtle"
          maxLength={MAX_CUSTOM_INSTRUCTIONS_CHARS}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="e.g. Prefer concise answers. Explain code line by line."
          value={instructions}
        />
        <span className="self-end text-[9px] glass-text-subtle">
          {instructions.length}/{MAX_CUSTOM_INSTRUCTIONS_CHARS}
        </span>
      </label>

      {error ? (
        <p className="flex items-center gap-1.5 text-[10.5px] glass-text-subtle" role="alert">
          <AlertIcon className="h-3 w-3 shrink-0" />
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          className="glass-btn focus-glass min-h-11 flex-1 rounded-xl text-[11.5px] font-medium glass-text-dark"
          onClick={() => save({ preferredName: name, customInstructions: instructions })}
          type="button"
        >
          Save changes
        </button>
        <button
          className="focus-glass min-h-11 rounded-xl px-3 text-[11.5px] glass-text-subtle hover:bg-white/10"
          onClick={reset}
          type="button"
        >
          Reset to defaults
        </button>
      </div>
      {notice ? (
        <p className="flex items-center gap-1 text-[10.5px] glass-text-subtle" role="status">
          <CheckIcon className="h-3 w-3" />
          {notice}
        </p>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- Read aloud */

const VOICE_GENDER_OPTIONS: { id: VoiceGenderPreference; label: string }[] = [
  { id: "any", label: "Any" },
  { id: "female", label: "Female" },
  { id: "male", label: "Male" },
];

function ReadAloudSection({
  supported,
  voices,
  speechVoiceId,
  speechRate,
  speechVoiceGender,
  onChangeVoice,
  onChangeRate,
  onChangeVoiceGender,
}: {
  supported: boolean;
  voices: VoiceOption[];
  speechVoiceId: string;
  speechRate: number;
  speechVoiceGender: VoiceGenderPreference;
  onChangeVoice: (id: string) => void;
  onChangeRate: (rate: number) => void;
  onChangeVoiceGender: (pref: VoiceGenderPreference) => void;
}) {
  if (!supported) {
    return (
      <p className="flex items-start gap-1.5 rounded-lg border border-white/25 bg-white/10 px-3 py-2 text-[11px] leading-snug glass-text-subtle" role="status">
        <AlertIcon className="mt-px h-3 w-3 shrink-0" />
        Read aloud is not available in this browser -- it relies on the browser/device&apos;s own speech synthesis,
        which was not found here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-medium glass-text-subtle">Voice</span>
        <select
          className="focus-glass h-11 w-full rounded-xl border border-white/25 bg-white/10 px-3 text-[12px] glass-text-dark outline-none"
          onChange={(e) => onChangeVoice(e.target.value)}
          value={speechVoiceId}
        >
          <option value={AUTO_VOICE}>Automatic (matches the answer&apos;s language)</option>
          {voices.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} ({v.lang})
            </option>
          ))}
        </select>
        {voices.length === 0 ? (
          <span className="text-[9.5px] glass-text-subtle">
            No specific voices were reported by this device yet -- Automatic still works.
          </span>
        ) : null}
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] font-medium glass-text-subtle">
          Voice tone {speechVoiceId === AUTO_VOICE ? "" : "(only applies to Automatic)"}
        </span>
        <div aria-label="Voice tone" className="grid grid-cols-3 gap-1.5" role="radiogroup">
          {VOICE_GENDER_OPTIONS.map((opt) => {
            const isActive = opt.id === speechVoiceGender;
            return (
              <button
                aria-checked={isActive}
                className={`focus-glass flex min-h-11 items-center justify-center rounded-xl border text-[11.5px] font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
                  isActive ? "border-white/70 bg-white/20 glass-text-dark" : "border-white/25 bg-white/8 glass-text-subtle hover:bg-white/12"
                }`}
                disabled={speechVoiceId !== AUTO_VOICE}
                key={opt.id}
                onClick={() => onChangeVoiceGender(opt.id)}
                role="radio"
                type="button"
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <span className="text-[9px] glass-text-subtle">
          Best-effort, guessed from each voice&apos;s name -- not available for every voice or language.
        </span>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="flex items-center justify-between text-[10px] font-medium glass-text-subtle">
          <span>Reading speed</span>
          <span className="tabular-nums glass-text-dark">{speechRate.toFixed(2)}×</span>
        </span>
        <input
          className="w-full accent-current"
          max={MAX_SPEECH_RATE}
          min={MIN_SPEECH_RATE}
          onChange={(e) => onChangeRate(Number(e.target.value))}
          step={0.1}
          type="range"
          value={speechRate}
        />
        <span className="flex justify-between text-[9px] glass-text-subtle">
          <span>{MIN_SPEECH_RATE}×</span>
          <span>1× default</span>
          <span>{MAX_SPEECH_RATE}×</span>
        </span>
      </label>

      <p className="text-[9.5px] leading-snug glass-text-subtle">
        Uses this browser/device&apos;s own speech synthesis -- no paid speech service. Voice availability (including for
        Arabic) varies by device, and speech is not guaranteed to work fully offline.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------- Conversations */

function ConversationsSection({
  conversations,
  onExport,
  onDeleteAll,
}: {
  conversations: readonly { id: string; title: string }[];
  onExport: (conversationIds: string[]) => void;
  onDeleteAll: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  // Initialized once (all selected, the previous "always export everything"
  // behavior) -- not kept in sync with `conversations` via an effect, since
  // this section is conditionally rendered (unmounted when another
  // Settings tab is active) and remounts, picking a fresh default, any
  // time it becomes visible again, the same pattern PersonalizationsSection
  // already uses for its own draft state.
  const [selected, setSelected] = useState(() => new Set(conversations.map((c) => c.id)));

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <SectionHeading>Export</SectionHeading>
        {conversations.length === 0 ? (
          <p className="text-[10.5px] leading-snug glass-text-subtle">No saved conversations to export yet.</p>
        ) : (
          <>
            <div className="flex items-center justify-between px-0.5">
              <span className="text-[9.5px] glass-text-subtle">
                {selected.size} of {conversations.length} selected
              </span>
              <div className="flex gap-2">
                <button
                  className="focus-glass min-h-11 rounded-md px-1.5 text-[10px] font-medium glass-text-dark hover:bg-white/10"
                  onClick={() => setSelected(new Set(conversations.map((c) => c.id)))}
                  type="button"
                >
                  Select all
                </button>
                <button
                  className="focus-glass min-h-11 rounded-md px-1.5 text-[10px] glass-text-subtle hover:bg-white/10"
                  onClick={() => setSelected(new Set())}
                  type="button"
                >
                  Clear
                </button>
              </div>
            </div>
            <ul className="glass-scroll flex max-h-[160px] flex-col gap-0.5 overflow-y-auto rounded-xl border border-white/20 bg-white/8 p-1.5">
              {conversations.map((c) => (
                <li key={c.id}>
                  <label className="focus-glass flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-1.5 hover:bg-white/10">
                    <input
                      checked={selected.has(c.id)}
                      className="h-3.5 w-3.5 shrink-0 accent-current"
                      onChange={() => toggle(c.id)}
                      type="checkbox"
                    />
                    <span className="truncate text-[11px] glass-text-dark">{c.title}</span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
        <button
          className="glass-btn focus-glass flex min-h-11 items-center justify-center gap-1.5 rounded-xl text-[11.5px] font-medium glass-text-dark disabled:cursor-not-allowed disabled:opacity-50"
          disabled={selected.size === 0}
          onClick={() => onExport([...selected])}
          type="button"
        >
          <DownloadIcon className="h-3.5 w-3.5" />
          Export {selected.size > 0 ? (selected.size === conversations.length ? "all" : `${selected.size} `) : ""}
          conversation{selected.size === 1 ? "" : "s"}
        </button>
        <p className="text-[9.5px] leading-snug glass-text-subtle">
          Downloads a clean, readable PDF with just each question and its answer, for the conversations checked above
          -- no dates, provider names, or other metadata. There is no import for this file.
        </p>
      </section>

      <section className="flex flex-col gap-2 border-t border-white/30 pt-3">
        <SectionHeading>Delete</SectionHeading>
        {confirming ? (
          <div className="rounded-xl border border-white/30 bg-white/12 p-3">
            <p className="mb-2 text-[11px] leading-snug glass-text-dark">
              Delete every saved conversation? This cannot be undone. Appearance and Personalization preferences are
              kept.
            </p>
            <div className="flex gap-2">
              <button
                className="focus-glass min-h-11 flex-1 rounded-lg border border-white/40 text-[11px] font-medium glass-text-dark hover:bg-white/15"
                onClick={() => {
                  onDeleteAll();
                  setConfirming(false);
                }}
                type="button"
              >
                Delete all
              </button>
              <button
                className="focus-glass min-h-11 flex-1 rounded-lg text-[11px] glass-text-subtle hover:bg-white/10"
                onClick={() => setConfirming(false)}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            className="focus-glass flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-white/25 text-[11.5px] font-medium glass-text-dark hover:bg-white/10"
            onClick={() => setConfirming(true)}
            type="button"
          >
            <TrashIcon className="h-3.5 w-3.5" />
            Delete all conversations
          </button>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------- Overlay */

export type SettingsOverlayProps = {
  open: boolean;
  onClose: () => void;
  portalContainer: HTMLElement | null;

  background: BackgroundId;
  glass: GlassStyleId;
  textSize: TextSizeId;
  onSelectBackground: (id: BackgroundId) => void;
  onSelectGlass: (id: GlassStyleId) => void;
  onSelectTextSize: (id: TextSizeId) => void;

  preferences: Preferences;
  onSavePreferences: (next: Preferences) => void;

  speechSupported: boolean;
  voices: VoiceOption[];
  speechVoiceId: string;
  speechRate: number;
  speechVoiceGender: VoiceGenderPreference;
  onChangeSpeechVoice: (id: string) => void;
  onChangeSpeechRate: (rate: number) => void;
  onChangeSpeechVoiceGender: (pref: VoiceGenderPreference) => void;

  /** Title only -- just enough to let the user pick which to export. */
  exportableConversations: readonly { id: string; title: string }[];
  onExportConversations: (conversationIds: string[]) => void;
  onDeleteAllConversations: () => void;
};

export function SettingsOverlay({
  open,
  onClose,
  portalContainer,
  background,
  glass,
  textSize,
  onSelectBackground,
  onSelectGlass,
  onSelectTextSize,
  preferences,
  onSavePreferences,
  speechSupported,
  voices,
  speechVoiceId,
  speechRate,
  speechVoiceGender,
  onChangeSpeechVoice,
  onChangeSpeechRate,
  onChangeSpeechVoiceGender,
  exportableConversations,
  onExportConversations,
  onDeleteAllConversations,
}: SettingsOverlayProps) {
  const [section, setSection] = useState<Section>("appearance");
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // Escape closes; focus moves onto the panel on open and returns to
  // whatever had it (there are several possible Settings triggers -- the
  // full sidebar's own footer button and the drawer's own copy -- so a
  // `document.activeElement` snapshot is used rather than one fixed ref).
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      restoreFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open || !portalContainer) return null;

  return createPortal(
    <>
      {/* Blurred, not just dimmed -- same treatment as the sidebar drawer's
          own backdrop, for the same reason: dense, readable form content
          needs the chat panel behind it visually quieted, not just tinted. */}
      <div aria-hidden="true" className="fixed inset-0 z-40 bg-black/40 backdrop-blur-md" onClick={onClose} />
      {/* Below `sm` (640px): an appropriately-sized bottom sheet, internally
          scrollable. At/above `sm`: a centered dialog, capped width/height,
          also internally scrollable. One mount, one breakpoint, resolved by
          the browser's own CSS engine -- not two independently-gated React
          components that can disagree with each other. `.glass-modal` (not
          `.optical-glass`): this holds dense, readable form content, and
          needs the same strong occlusion the switch-confirmation dialog
          already uses, not a see-through material. */}
      <div
        aria-label="Settings"
        aria-modal="true"
        className="glass-modal fixed inset-x-3 bottom-3 z-50 flex max-h-[80vh] flex-col gap-3 overflow-hidden rounded-[26px] p-4 pt-[max(1rem,env(safe-area-inset-bottom))] sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:max-h-[min(80vh,600px)] sm:w-[min(560px,calc(100vw-48px))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:p-5"
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-white/30 pb-2">
          <div className="flex items-center gap-1.5">
            <GearIcon className="h-3.5 w-3.5 glass-text-dark" />
            <h2 className="text-[12.5px] font-semibold tracking-tight glass-text-dark">Settings</h2>
          </div>
          <button
            aria-label="Close settings"
            className="focus-glass flex h-11 w-11 items-center justify-center rounded-full glass-text-dark transition-colors hover:bg-white/20"
            onClick={onClose}
            type="button"
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </div>

        <div aria-label="Settings sections" className="flex shrink-0 gap-1 overflow-x-auto pb-1" role="tablist">
          {SECTIONS.map((s) => (
            <button
              aria-selected={section === s.id}
              className={`focus-glass min-h-11 shrink-0 rounded-lg px-2.5 text-[11px] font-medium whitespace-nowrap ${
                section === s.id ? "bg-white/20 glass-text-dark" : "glass-text-subtle hover:bg-white/10"
              }`}
              key={s.id}
              onClick={() => setSection(s.id)}
              role="tab"
              type="button"
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="glass-scroll min-h-0 flex-1 overflow-y-auto pr-1">
          {section === "appearance" ? (
            <AppearanceSection
              background={background}
              glass={glass}
              onSelectBackground={onSelectBackground}
              onSelectGlass={onSelectGlass}
              onSelectTextSize={onSelectTextSize}
              textSize={textSize}
            />
          ) : null}
          {section === "personalizations" ? (
            <PersonalizationsSection onSave={onSavePreferences} preferences={preferences} />
          ) : null}
          {section === "readAloud" ? (
            <ReadAloudSection
              onChangeRate={onChangeSpeechRate}
              onChangeVoice={onChangeSpeechVoice}
              onChangeVoiceGender={onChangeSpeechVoiceGender}
              speechRate={speechRate}
              speechVoiceGender={speechVoiceGender}
              speechVoiceId={speechVoiceId}
              supported={speechSupported}
              voices={voices}
            />
          ) : null}
          {section === "conversations" ? (
            <ConversationsSection
              conversations={exportableConversations}
              onDeleteAll={onDeleteAllConversations}
              onExport={onExportConversations}
            />
          ) : null}
        </div>
      </div>
    </>,
    portalContainer,
  );
}

/** Kept only so the SpeakerIcon import above is not flagged unused if a
 * future section wants an icon next to "Read aloud" in the tab list -- not
 * currently rendered anywhere. */
void SpeakerIcon;
