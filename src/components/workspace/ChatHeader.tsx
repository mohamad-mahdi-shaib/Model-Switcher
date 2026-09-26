"use client";

import { PanelLeftIcon } from "@/components/icons";

/**
 * Interaction refinement: the sidebar is closed by default on mobile and
 * narrow tablet again (superseding the previous pass's always-visible
 * compact rail), and desktop gains a real collapse/expand control -- both
 * need a way back in, and this is it. One button serves both roles
 * (WorkspaceLayout decides what "toggle" means at the current width); the
 * label always describes what it currently controls, not which layout mode
 * produced it. New chat lives in the sidebar itself (its existing "New
 * conversation" button, above the list), not duplicated here.
 */
type ChatHeaderProps = {
  title: string;
  sidebarVisible: boolean;
  onToggleSidebar: () => void;
};

export function ChatHeader({ title, sidebarVisible, onToggleSidebar }: ChatHeaderProps) {
  return (
    <header className="relative z-20 flex w-full items-center gap-2">
      <button
        aria-expanded={sidebarVisible}
        aria-label={sidebarVisible ? "Close conversation list" : "Open conversation list"}
        className="focus-glass flex h-11 w-11 shrink-0 items-center justify-center rounded-full glass-text-dark hover:bg-white/15"
        onClick={onToggleSidebar}
        type="button"
      >
        <PanelLeftIcon className="h-4 w-4" />
      </button>

      <h1 className="flex min-w-0 flex-1">
        <span className="truncate text-[17px] font-semibold tracking-tight glass-text-dark">
          {title}
        </span>
      </h1>
    </header>
  );
}
