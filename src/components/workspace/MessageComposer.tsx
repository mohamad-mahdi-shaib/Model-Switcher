import { SparklesIcon } from "@/components/icons";

/**
 * Presentation only for this milestone: the field accepts typing but there is
 * no send handler, so the submit control stays disabled.
 */
export function MessageComposer() {
  return (
    <footer className="relative z-10 shrink-0 pt-1">
      <div className="glass-input-capsule flex h-[48px] items-center justify-between gap-3 rounded-full px-4">
        <input
          aria-label="Message"
          className="w-full border-0 bg-transparent p-0 text-[13px] glass-text-dark outline-none placeholder:text-[color:var(--ink-subtle)] focus:outline-none"
          placeholder="Ask anything…"
          type="text"
        />
        <button
          aria-label="Send message"
          className="focus-glass flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/90 bg-gradient-to-tr from-white/35 to-white/70 text-[#1a1c22] shadow-sm backdrop-blur-md transition-all disabled:cursor-not-allowed disabled:opacity-50"
          disabled
          title="Sending arrives in a later milestone"
          type="button"
        >
          <SparklesIcon className="h-3.5 w-3.5" strokeWidth="2.2" />
        </button>
      </div>
    </footer>
  );
}
