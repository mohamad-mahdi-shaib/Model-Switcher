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
            <strong className="font-semibold">{getProviderMeta(from).label}</strong>.{" "}
            {getProviderMeta(to).label} will continue with the existing context,
            and its answers may differ in style and substance.
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
  onSelectProvider,
  pickerOpen,
  activeBackground,
  activeGlass,
  onPickerOpenChange,
  onSelectBackground,
  onSelectGlass,
}: ChatHeaderProps) {
  const [pending, setPending] = useState<ProviderId | null>(null);

  const requestSwitch = (target: ProviderId) => {
    if (target === provider) return;
    if (!isProviderUsable(target, availability)) return;
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
        <div
          aria-label="AI provider"
          className="glass-btn flex h-[30px] items-center gap-0.5 rounded-full p-0.5"
          role="radiogroup"
        >
          {PROVIDERS.map((item) => {
            const usable = isProviderUsable(item.id, availability);
            const isActive = item.id === provider;
            const reason =
              availability?.[item.id]?.reason ??
              item.note ??
              "Not connected yet.";
            return (
              <button
                aria-checked={isActive}
                aria-disabled={!usable}
                aria-label={
                  usable
                    ? item.label
                    : `${item.label} — ${UNAVAILABLE_LABEL}. ${reason}`
                }
                className={`focus-glass rounded-full px-2.5 py-[3px] text-[11.5px] font-medium transition-colors ${
                  isActive
                    ? "provider-chip-active border glass-text-dark"
                    : usable
                      ? "border border-transparent glass-text-muted hover:bg-white/10"
                      : "cursor-not-allowed border border-transparent opacity-45 glass-text-subtle"
                }`}
                data-provider={item.id}
                key={item.id}
                onClick={() => {
                  if (!usable) return;
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
