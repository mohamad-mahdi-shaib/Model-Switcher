"use client";

import { BackgroundPicker } from "@/components/workspace/BackgroundPicker";
import { ChevronDownIcon } from "@/components/icons";
import type { BackgroundId, GlassStyleId } from "@/lib/backgrounds";
import {
  ACTIVE_CONVERSATION_TITLE,
  ACTIVE_MODEL_ID,
  AI_MODELS,
} from "@/lib/sample-data";

type ChatHeaderProps = {
  pickerOpen: boolean;
  activeBackground: BackgroundId;
  activeGlass: GlassStyleId;
  onPickerOpenChange: (open: boolean) => void;
  onSelectBackground: (id: BackgroundId) => void;
  onSelectGlass: (id: GlassStyleId) => void;
};

export function ChatHeader({
  pickerOpen,
  activeBackground,
  activeGlass,
  onPickerOpenChange,
  onSelectBackground,
  onSelectGlass,
}: ChatHeaderProps) {
  return (
    <header className="relative z-20 flex w-full flex-wrap items-center justify-between gap-3">
      <h1 className="flex">
        <button
          className="focus-glass flex items-center gap-1.5 rounded-lg text-[17px] font-semibold tracking-tight glass-text-dark"
          disabled
          title="Switching conversations arrives in a later milestone"
          type="button"
        >
          <span>{ACTIVE_CONVERSATION_TITLE}</span>
          <ChevronDownIcon className="mt-0.5 h-4 w-4" strokeWidth="2.4" />
        </button>
      </h1>

      <div className="flex items-center gap-2">
        <div
          aria-label="Model"
          className="glass-btn flex h-[30px] items-center gap-0.5 rounded-full p-0.5"
          role="group"
        >
          {AI_MODELS.map((model) => {
            const isActive = model.id === ACTIVE_MODEL_ID;
            return (
              <button
                aria-pressed={isActive}
                className={`focus-glass rounded-full px-2.5 py-[3px] text-[11.5px] font-medium transition-colors ${
                  isActive
                    ? "border border-white/80 bg-white/30 glass-text-dark"
                    : "border border-transparent glass-text-muted"
                }`}
                disabled
                key={model.id}
                title="Model switching arrives in a later milestone"
                type="button"
              >
                {model.label}
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
