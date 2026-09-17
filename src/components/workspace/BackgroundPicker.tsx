"use client";

import { useEffect, useRef } from "react";
import {
  BACKGROUND_COLLECTIONS,
  BACKGROUNDS,
  GLASS_STYLES,
  type BackgroundId,
  type GlassStyleId,
} from "@/lib/backgrounds";
import {
  CheckIcon,
  ImageIcon,
  PaletteIcon,
  XIcon,
} from "@/components/icons";

type BackgroundPickerProps = {
  open: boolean;
  activeId: BackgroundId;
  activeGlass: GlassStyleId;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: BackgroundId) => void;
  onSelectGlass: (id: GlassStyleId) => void;
};

function SectionHeading({ children }: { children: string }) {
  return (
    <h3 className="px-0.5 text-[9.5px] font-semibold tracking-[0.12em] uppercase glass-text-subtle">
      {children}
    </h3>
  );
}

export function BackgroundPicker({
  open,
  activeId,
  activeGlass,
  onOpenChange,
  onSelect,
  onSelectGlass,
}: BackgroundPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape closes and returns focus to the trigger; a pointer press anywhere
  // outside the popover (trigger included) closes it.
  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onOpenChange(false);
        triggerRef.current?.focus();
      }
    }

    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        onOpenChange(false);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, onOpenChange]);

  useEffect(() => {
    if (open) {
      panelRef.current?.focus();
    }
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        className="glass-btn focus-glass flex h-[30px] items-center gap-1.5 rounded-full border border-white/80 px-3.5 text-[11.5px] font-medium glass-text-dark active:scale-95"
        onClick={() => onOpenChange(!open)}
        ref={triggerRef}
        type="button"
      >
        <ImageIcon className="h-3 w-3" />
        <span>Change background</span>
      </button>

      {open ? (
        <div
          aria-label="Appearance"
          className="glass-modal glass-scroll absolute right-0 top-[42px] z-50 flex max-h-[min(70vh,560px)] w-[336px] flex-col gap-3 overflow-y-auto rounded-2xl p-4"
          ref={panelRef}
          role="dialog"
          tabIndex={-1}
        >
          <div className="flex items-center justify-between border-b border-white/30 pb-2">
            <div className="flex items-center gap-1.5">
              <PaletteIcon className="h-3.5 w-3.5 glass-text-dark" />
              <span className="text-[12.5px] font-semibold tracking-tight glass-text-dark">
                Appearance
              </span>
            </div>
            <button
              aria-label="Close appearance picker"
              className="focus-glass flex h-5 w-5 items-center justify-center rounded-full glass-text-dark transition-colors hover:bg-white/20"
              onClick={() => {
                onOpenChange(false);
                triggerRef.current?.focus();
              }}
              type="button"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* --- Section 1: background ------------------------------------ */}
          <section aria-label="Background" className="flex flex-col gap-2">
            <SectionHeading>Background</SectionHeading>

            <div
              aria-label="Background"
              className="flex flex-col gap-2.5"
              role="radiogroup"
            >
              {BACKGROUND_COLLECTIONS.map((collection) => (
                <div className="flex flex-col gap-1.5" key={collection}>
                  <p className="px-0.5 text-[9px] font-medium tracking-wider uppercase glass-text-subtle opacity-80">
                    {collection}
                  </p>
                  {BACKGROUNDS.filter(
                    (background) => background.collection === collection,
                  ).map((background) => {
                    const isActive = background.id === activeId;
                    return (
                      <button
                        aria-checked={isActive}
                        className="bg-card focus-glass flex w-full cursor-pointer items-center justify-between rounded-xl p-1.5 text-left"
                        key={background.id}
                        onClick={() => onSelect(background.id)}
                        role="radio"
                        type="button"
                      >
                        <span className="flex items-center gap-2.5">
                          <span
                            className="h-8 w-8 shrink-0 rounded-lg border border-white/70 shadow-sm"
                            style={{ background: background.swatch }}
                          />
                          <span className="block">
                            <span className="block text-[11.5px] font-semibold leading-tight glass-text-dark">
                              {background.name}
                            </span>
                            <span className="block text-[9.5px] glass-text-subtle">
                              {background.description}
                            </span>
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
              ))}
            </div>
          </section>

          {/* --- Section 2: glass appearance ------------------------------ */}
          <section
            aria-label="Glass appearance"
            className="flex flex-col gap-2 border-t border-white/30 pt-3"
          >
            <SectionHeading>Glass appearance</SectionHeading>

            <div
              aria-label="Glass appearance"
              className="grid grid-cols-2 gap-1.5"
              role="radiogroup"
            >
              {GLASS_STYLES.map((style) => {
                const isActive = style.id === activeGlass;
                return (
                  <button
                    aria-checked={isActive}
                    className="bg-card focus-glass flex cursor-pointer flex-col gap-1.5 rounded-xl p-2 text-left"
                    key={style.id}
                    onClick={() => onSelectGlass(style.id)}
                    role="radio"
                    type="button"
                  >
                    <span className="flex items-center justify-between">
                      <span className="text-[11.5px] font-semibold leading-tight glass-text-dark">
                        {style.name}
                      </span>
                      {isActive ? (
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/90 text-[#1a1c22] shadow-sm">
                          <CheckIcon className="h-2.5 w-2.5" />
                        </span>
                      ) : null}
                    </span>
                    <span className="block text-[9.5px] leading-snug glass-text-subtle">
                      {style.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
