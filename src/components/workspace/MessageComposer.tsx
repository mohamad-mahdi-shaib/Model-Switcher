"use client";

import { useEffect, useRef, useState } from "react";
import { SparklesIcon, StopIcon } from "@/components/icons";
import type { ChatStatus } from "@/lib/use-chat";

type MessageComposerProps = {
  status: ChatStatus;
  disabled: boolean;
  disabledReason?: string;
  onSend: (text: string) => boolean;
  onStop: () => void;
};

const MAX_ROWS = 6;

export function MessageComposer({
  status,
  disabled,
  disabledReason,
  onSend,
  onStop,
}: MessageComposerProps) {
  const [value, setValue] = useState("");
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const streaming = status === "streaming";

  // Grow with content up to MAX_ROWS, then scroll. Keeps the composer visible.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const line = 20;
    el.style.height = `${Math.min(el.scrollHeight, line * MAX_ROWS)}px`;
  }, [value]);

  const submit = () => {
    if (streaming || disabled) return;
    if (!value.trim()) return;
    if (onSend(value)) setValue("");
  };

  return (
    <footer className="relative z-10 shrink-0 pt-1">
      <div className="glass-input-capsule flex min-h-[48px] items-end gap-3 rounded-[24px] px-4 py-2">
        <textarea
          aria-label="Message"
          className="glass-scroll max-h-[120px] w-full resize-none border-0 bg-transparent py-1.5 text-[13px] leading-5 glass-text-dark outline-none placeholder:text-[color:var(--ink-subtle)] focus:outline-none disabled:cursor-not-allowed"
          disabled={disabled}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter inserts a line break. IME composition
            // must not be interrupted.
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={disabled ? (disabledReason ?? "Unavailable") : "Ask anything…"}
          ref={areaRef}
          rows={1}
          title={disabled ? disabledReason : undefined}
          value={value}
        />

        {streaming ? (
          <button
            aria-label="Stop generating"
            className="focus-glass mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/90 bg-gradient-to-tr from-white/35 to-white/70 text-[#1a1c22] shadow-sm backdrop-blur-md transition-all"
            onClick={onStop}
            type="button"
          >
            <StopIcon className="h-3 w-3" />
          </button>
        ) : (
          <button
            aria-label="Send message"
            className="focus-glass mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/90 bg-gradient-to-tr from-white/35 to-white/70 text-[#1a1c22] shadow-sm backdrop-blur-md transition-all disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled || !value.trim()}
            onClick={submit}
            title={disabled ? disabledReason : undefined}
            type="button"
          >
            <SparklesIcon className="h-3.5 w-3.5" strokeWidth="2.2" />
          </button>
        )}
      </div>
      <p className="mt-1.5 px-4 text-[10px] glass-text-subtle">
        Enter to send · Shift+Enter for a new line
      </p>
    </footer>
  );
}
