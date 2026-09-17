import {
  ACTIVE_CONVERSATION_ID,
  CONVERSATION_GROUPS,
} from "@/lib/sample-data";
import { PlusIcon, SparklesIcon } from "@/components/icons";

export function ConversationSidebar() {
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
        type="button"
      >
        <PlusIcon className="h-3.5 w-3.5" strokeWidth="2.4" />
        <span>New conversation</span>
      </button>

      <nav aria-label="Recent conversations" className="glass-scroll min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="space-y-3.5 pt-1">
          {CONVERSATION_GROUPS.map((group) => (
            <section key={group.label}>
              <h2 className="mb-1.5 px-1 text-[10px] font-semibold tracking-wider uppercase glass-text-subtle">
                {group.label}
              </h2>
              <ul className="space-y-1">
                {group.conversations.map((conversation) => {
                  const isActive = conversation.id === ACTIVE_CONVERSATION_ID;
                  return (
                    <li key={conversation.id}>
                      <button
                        aria-current={isActive ? "true" : undefined}
                        className="glass-row focus-glass w-full truncate rounded-lg px-1.5 py-1 text-left text-[11.5px]"
                        type="button"
                      >
                        <span
                          className={
                            isActive
                              ? "font-medium glass-text-dark"
                              : "font-normal glass-text-muted"
                          }
                        >
                          {conversation.title}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </nav>
    </aside>
  );
}
