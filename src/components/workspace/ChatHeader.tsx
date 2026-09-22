"use client";

import { useEffect, useRef, useState } from "react";
import { BackgroundPicker } from "@/components/workspace/BackgroundPicker";
import { AlertIcon } from "@/components/icons";
import type { BackgroundId, GlassStyleId } from "@/lib/backgrounds";
import {
  getProviderMeta,
  isProviderUsable,
  PROVIDERS,
  UNAVAILABLE_LABEL,
  type AvailabilityMap,
  type ProviderId,
} from "@/lib/providers";

type ChatHeaderProps = {
  title: string;
  provider: ProviderId;
  availability: AvailabilityMap | null;
  /** A switch mid-conversation must be confirmed, never silent. */
  conversationStarted: boolean;
  /** A request is in flight: switching is refused outright while it is. */
  busy: boolean;
  /** Model the active provider will use, from the server probe. */
  activeModel: string | null;
  onSelectProvider: (id: ProviderId) => void;
  pickerOpen: boolean;
  activeBackground: BackgroundId;
  activeGlass: GlassStyleId;
  onPickerOpenChange: (open: boolean) => void;
  onSelectBackground: (id: BackgroundId) => void;
  onSelectGlass: (id: GlassStyleId) => void;
};

function SwitchDialog({
  from,
  to,
  onCancel,
  onConfirm,
}: {
  from: ProviderId;
  to: ProviderId;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onCancel();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [onCancel]);

  return (
    <div
      aria-labelledby="switch-title"
      aria-modal="true"
      className="glass-modal absolute top-[42px] right-0 z-50 w-[330px] rounded-2xl p-4"
      ref={ref}
      role="dialog"
    >
      <div className="flex items-start gap-2">
        <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 glass-text-dark" />
        <div>
          <h2
            className="text-[12.5px] font-semibold tracking-tight glass-text-dark"
            id="switch-title"
          >
            Switch to {getProviderMeta(to).label}?
          </h2>
          <p className="mt-1.5 text-[11px] leading-relaxed glass-text-subtle">
            This conversation has already started with{" "}
            <strong className="font-semibold">{getProviderMeta(from).label}</strong>.
            Every later message will send the{" "}
            <strong className="font-semibold">whole conversation so far</strong>{" "}
            to {getProviderMeta(to).label}, whose answers may differ in style and
            substance. Replies already on screen keep their original model.
          </p>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-1.5">
        <button
          className="focus-glass rounded-full px-3 py-1 text-[11px] glass-text-subtle hover:bg-white/12"
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
        <button
          className="glass-btn focus-glass rounded-full px-3 py-1 text-[11px] font-medium glass-text-dark"
          onClick={onConfirm}
          ref={confirmRef}
          type="button"
        >
          Switch model
        </button>
      </div>
    </div>
  );
}

export function ChatHeader({
  title,
  provider,
  availability,
  conversationStarted,
  busy,
  activeModel,
  onSelectProvider,
  pickerOpen,
  activeBackground,
  activeGlass,
  onPickerOpenChange,
  onSelectBackground,
  onSelectGlass,
}: ChatHeaderProps) {
  const [pending, setPending] = useState<ProviderId | null>(null);

  // The model actually in use, as reported by the server for the provider that
  // is selected. Three distinct states, never a guess: still probing, a real
  // id, or an honest admission that we do not know. A hardcoded fallback id
  // would be worse than saying nothing -- it would be wrong with confidence.
  const modelLabel =
    activeModel ?? (availability === null ? "checking model…" : "model unavailable");
  const modelKnown = activeModel !== null;

  const requestSwitch = (target: ProviderId) => {
    if (target === provider) return;
    if (!isProviderUsable(target, availability)) return;
    // Refused outright while a request is in flight: the turn already left for
    // one provider, and changing selection underneath it would misattribute
    // the answer that comes back.
    if (busy) return;
    // Before any messages exist there is no context to carry, so no warning.
    if (!conversationStarted) {
      onSelectProvider(target);
      return;
    }
    setPending(target);
  };

  return (
    <header className="relative z-20 flex w-full flex-wrap items-center justify-between gap-3">
      <h1 className="flex min-w-0">
        <span className="truncate text-[17px] font-semibold tracking-tight glass-text-dark">
          {title}
        </span>
      </h1>

      <div className="relative flex items-center gap-2">
        {/* The selector and the model it resolves to are one unit, stacked.
            Beside the group the readout was ambiguous: with Gemini selected it
            rendered 56px to the right of its own chip, with the GPT chip in
            between, so it read as a label for GPT. Directly beneath the group,
            right-aligned, it belongs to the selection at either setting. */}
        <div className="flex flex-col items-end gap-[3px]">
          <div
            aria-label="AI provider"
            className="glass-btn flex h-[30px] items-center gap-0.5 rounded-full p-0.5"
            role="radiogroup"
          >
            {PROVIDERS.map((item) => {
              const usable = isProviderUsable(item.id, availability);
              const isActive = item.id === provider;
              // While busy, every other chip is inert -- including to the
              // keyboard, which `disabled` alone would still allow to focus.
              const locked = busy && !isActive;
              const reason =
                availability?.[item.id]?.reason ??
                item.note ??
                "Not connected yet.";
              return (
                // `inline-flex items-center justify-center` centers the label
                // (and, if one is ever added, an icon) explicitly, rather than
                // relying on the default block layout's padding/line-height
                // arithmetic to happen to net out identical across every
                // state -- the padding/border/font classes below are already
                // shared by all three states, so this is a guaranteed, not
                // coincidental, match.
                <button
                  aria-checked={isActive}
                  aria-disabled={!usable || locked}
                  aria-label={
                    !usable
                      ? `${item.label} — ${UNAVAILABLE_LABEL}. ${reason}`
                      : locked
                        ? `${item.label} — cannot switch while a response is in progress`
                        : item.label
                  }
                  disabled={locked}
                  className={`focus-glass inline-flex items-center justify-center rounded-full px-2.5 py-[3px] text-[11.5px] font-medium transition-colors ${
                    isActive
                      ? "provider-chip-active border glass-text-dark"
                      : !usable || locked
                        ? "cursor-not-allowed border border-transparent opacity-45 glass-text-subtle"
                        : "border border-transparent glass-text-muted hover:bg-white/10"
                  }`}
                  data-provider={item.id}
                  key={item.id}
                  onClick={() => {
                    if (!usable || locked) return;
                    requestSwitch(item.id);
                  }}
                  role="radio"
                  title={usable ? undefined : `${UNAVAILABLE_LABEL} — ${reason}`}
                  type="button"
                >
                  {item.label}
                  {usable ? null : (
                    <span className="sr-only"> ({UNAVAILABLE_LABEL})</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* The provider association is carried by aria-label rather than by
              an sr-only child, so this element's own text stays exactly the
              model id -- which is what tests and tooling read. */}
          <span
            aria-live="polite"
            className={`provider-model rounded-full px-2 py-[2px] text-[11.5px] font-medium tracking-tight ${
              modelKnown ? "glass-text-muted" : "glass-text-subtle italic"
            }`}
            data-model-known={modelKnown}
            aria-label={
              modelKnown
                ? `${getProviderMeta(provider).label} is using model ${activeModel}`
                : `No model reported for ${getProviderMeta(provider).label}`
            }
            title={
              modelKnown
                ? `${getProviderMeta(provider).label} is using ${activeModel}`
                : `No model reported for ${getProviderMeta(provider).label}`
            }
          >
            {modelLabel}
          </span>
        </div>

        <BackgroundPicker
          activeGlass={activeGlass}
          activeId={activeBackground}
          onOpenChange={onPickerOpenChange}
          onSelect={onSelectBackground}
          onSelectGlass={onSelectGlass}
          open={pickerOpen}
        />

        {pending ? (
          <SwitchDialog
            from={provider}
            onCancel={() => setPending(null)}
            onConfirm={() => {
              onSelectProvider(pending);
              setPending(null);
            }}
            to={pending}
          />
        ) : null}
      </div>
    </header>
  );
}
