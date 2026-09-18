"use client";

import { BackgroundPicker } from "@/components/workspace/BackgroundPicker";
import { ChevronDownIcon } from "@/components/icons";
import type { BackgroundId, GlassStyleId } from "@/lib/backgrounds";
import {
  COMING_SOON_LABEL,
  PROVIDERS,
  type ProviderId,
} from "@/lib/providers";

type ChatHeaderProps = {
  title: string;
  provider: ProviderId;
  onSelectProvider: (id: ProviderId) => void;
  pickerOpen: boolean;
  activeBackground: BackgroundId;
  activeGlass: GlassStyleId;
  onPickerOpenChange: (open: boolean) => void;
  onSelectBackground: (id: BackgroundId) => void;
  onSelectGlass: (id: GlassStyleId) => void;
};

export function ChatHeader({
  title,
  provider,
  onSelectProvider,
  pickerOpen,
  activeBackground,
  activeGlass,
  onPickerOpenChange,
  onSelectBackground,
  onSelectGlass,
}: ChatHeaderProps) {
  return (
    <header className="relative z-20 flex w-full flex-wrap items-center justify-between gap-3">
      <h1 className="flex min-w-0">
        <span className="truncate text-[17px] font-semibold tracking-tight glass-text-dark">
          {title}
        </span>
        <ChevronDownIcon
          aria-hidden="true"
          className="mt-1 ml-1.5 h-4 w-4 shrink-0 opacity-40 glass-text-dark"
          strokeWidth="2.4"
        />
      </h1>

      <div className="flex items-center gap-2">
        <div
          aria-label="AI provider"
          className="glass-btn flex h-[30px] items-center gap-0.5 rounded-full p-0.5"
          role="radiogroup"
        >
          {PROVIDERS.map((item) => {
            const isActive = item.id === provider && item.enabled;
            // Disabled providers get aria-disabled rather than the disabled
            // attribute, so their explanation stays reachable by keyboard.
            return (
              <button
                aria-checked={isActive}
                aria-disabled={!item.enabled}
                aria-label={
                  item.enabled
                    ? item.label
                    : `${item.label} — ${COMING_SOON_LABEL}. ${item.note ?? ""}`
                }
                className={`focus-glass rounded-full px-2.5 py-[3px] text-[11.5px] font-medium transition-colors ${
                  isActive
                    ? "border border-white/80 bg-white/30 glass-text-dark"
                    : item.enabled
                      ? "border border-transparent glass-text-muted hover:bg-white/10"
                      : "cursor-not-allowed border border-transparent opacity-45 glass-text-subtle"
                }`}
                key={item.id}
                onClick={() => {
                  if (!item.enabled) return;
                  onSelectProvider(item.id);
                }}
                role="radio"
                title={item.enabled ? undefined : `${COMING_SOON_LABEL} — ${item.note}`}
                type="button"
              >
                {item.label}
                {item.enabled ? null : (
                  <span className="sr-only"> ({COMING_SOON_LABEL})</span>
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
      </div>
    </header>
  );
}
