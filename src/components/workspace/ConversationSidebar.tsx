"use client";

import { CONVERSATION_GROUPS } from "@/lib/sample-data";
import { PlusIcon, SparklesIcon } from "@/components/icons";

type ConversationSidebarProps = {
  currentTitle: string;
  hasMessages: boolean;
  onNewConversation: () => void;
};

const DEMO_NOTE =
  "Demo placeholder from the design mock — not a saved conversation. Chat history is not stored yet.";

export function ConversationSidebar({
  currentTitle,
  hasMessages,
  onNewConversation,
}: ConversationSidebarProps) {
  return (
    <aside
      aria-label="Conversations"
      className="optical-glass hidden w-[238px] shrink-0 flex-col gap-4 rounded-[30px] p-5 md:flex"
    >
      <div className="flex items-center gap-2.5 px-0.5 pt-0.5">
        <span className="relative flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-white/80 bg-white/25 shadow-sm backdrop-blur-md">
          <span className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-white/40 to-transparent" />
          <SparklesIcon className="relative z-10 h-3.5 w-3.5 glass-text-dark" strokeWidth="2.2" />
        </span>
        <span className="text-[13px] font-semibold tracking-wide uppercase glass-text-dark">
          AI Workspace
        </span>
      </div>

      <button
        className="glass-btn focus-glass flex h-[34px] w-full items-center justify-center gap-1.5 rounded-xl text-[12px] font-medium tracking-tight glass-text-dark active:scale-[0.98]"
        onClick={onNewConversation}
        type="button"
      >
        <PlusIcon className="h-3.5 w-3.5" strokeWidth="2.4" />
        <span>New conversation</span>
      </button>

      <div className="relative min-h-0 flex-1">
        <div
          aria-hidden="true"
          className="diffusion-scrim absolute -inset-x-2 -inset-y-1 rounded-[18px]"
        />
        <nav
          aria-label="Recent conversations"
          className="glass-scroll relative h-full overflow-y-auto pr-1"
        >
          <div className="space-y-3.5 pt-1">
            <section>
              <h2 className="mb-1.5 px-1 text-[10px] font-semibold tracking-wider uppercase glass-text-subtle">
                This session
              </h2>
              <p
                aria-current="true"
                className="glass-row truncate rounded-lg px-1.5 py-1 text-[11.5px] font-medium glass-text-dark"
              >
                {currentTitle}
              </p>
              {hasMessages ? null : (
                <p className="px-1.5 pt-0.5 text-[10px] glass-text-subtle">
                  Empty — send a message to begin.
                </p>
              )}
            </section>

            {/* Retained from the design mock. Marked as demos so they are never
                mistaken for real history: chat is in-memory only for now. */}
            <section aria-label="Sample conversations">
              <h2 className="mb-1 px-1 text-[10px] font-semibold tracking-wider uppercase glass-text-subtle">
                Samples
              </h2>
              <p className="mb-1.5 px-1 text-[9.5px] leading-snug glass-text-subtle opacity-80">
                Design demos. Not clickable, not stored.
              </p>
              {CONVERSATION_GROUPS.map((group) => (
                <div className="mb-2" key={group.label}>
                  <h3 className="mb-1 px-1 text-[9px] font-medium tracking-wider uppercase glass-text-subtle opacity-70">
                    {group.label}
                  </h3>
                  <ul className="space-y-1">
                    {group.conversations.map((conversation) => (
                      <li key={conversation.id}>
                        <span
                          className="flex cursor-not-allowed items-center justify-between gap-1.5 rounded-lg px-1.5 py-1 text-[11.5px] opacity-55"
                          title={DEMO_NOTE}
                        >
                          <span className="truncate font-normal glass-text-muted">
                            {conversation.title}
                          </span>
                          <span className="shrink-0 rounded-full border border-white/30 px-1.5 text-[8.5px] font-medium tracking-wide uppercase glass-text-subtle">
                            Demo
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          </div>
        </nav>
      </div>
    </aside>
  );
}
