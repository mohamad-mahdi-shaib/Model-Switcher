"use client";

import { GearIcon, PanelLeftIcon, SparklesIcon } from "@/components/icons";

/**
 * Layout-restructure pass: the global header. Replaces `ChatHeader.tsx`,
 * which was a title row rendered INSIDE the chat panel and therefore could
 * never hold anything that applies to the whole workspace.
 *
 * Its content is all pre-existing application chrome, relocated once -- not
 * invented to fill a bar, and not duplicated:
 *
 * - The sidebar toggle, unchanged in behavior: below `lg` it opens the
 *   sidebar drawer, at `>=lg` it collapses/expands the inline sidebar
 *   (`WorkspaceLayout` decides which, and `sidebarVisible` keeps this
 *   button's own label describing what it currently controls).
 * - The brand mark, moved up from the top of the sidebar body. It belonged
 *   to the whole app, not to the conversation list, and in the sidebar it
 *   disappeared entirely whenever the sidebar was collapsed or closed.
 * - The active conversation title, moved from `ChatHeader`.
 * - Settings, moved from the sidebar footer. It is a global action, and the
 *   sidebar was the wrong home for it in two concrete ways: it was
 *   unreachable while the sidebar was collapsed, and it rendered TWICE
 *   whenever the drawer was mounted alongside the inline sidebar (the
 *   drawer and the `<aside>` share one `SidebarBody`). One trigger, always
 *   on screen, at every width.
 *
 * New chat and Search stay in the sidebar: they act on the conversation
 * list, which is what the sidebar is.
 */
type AppHeaderProps = {
  title: string;
  sidebarVisible: boolean;
  onToggleSidebar: () => void;
  settingsOpen: boolean;
  onToggleSettings: () => void;
};

export function AppHeader({
  title,
  sidebarVisible,
  onToggleSidebar,
  settingsOpen,
  onToggleSettings,
}: AppHeaderProps) {
  return (
    <header className="optical-glass relative z-20 flex shrink-0 items-center gap-1 rounded-[20px] px-1.5 py-1.5 sm:gap-2 sm:rounded-[22px] sm:px-2.5">
      <button
        aria-expanded={sidebarVisible}
        aria-label={sidebarVisible ? "Close conversation list" : "Open conversation list"}
        className="focus-glass flex h-11 w-11 shrink-0 items-center justify-center rounded-full glass-text-dark hover:bg-white/15"
        onClick={onToggleSidebar}
        type="button"
      >
        <PanelLeftIcon className="h-4 w-4" />
      </button>

      {/* The brand mark, byte-identical to the one that used to sit at the
          top of the sidebar body -- same circle, same icon, same uppercase
          label -- so the workspace's identity reads exactly as before, just
          from a place that is always visible. The word mark itself is the
          one part that drops below `sm`, where the conversation title needs
          the width more than the (still-present) glyph does. */}
      <span className="flex min-w-0 shrink-0 items-center gap-2">
        <span className="relative flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-white/80 bg-white/25 shadow-sm backdrop-blur-md">
          <span className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-white/40 to-transparent" />
          <SparklesIcon className="relative z-10 h-3.5 w-3.5 glass-text-dark" strokeWidth="2.2" />
        </span>
        <span className="hidden text-[13px] font-semibold tracking-wide uppercase glass-text-dark sm:inline">
          AI Workspace
        </span>
      </span>

      <span
        aria-hidden="true"
        className="hidden h-5 w-px shrink-0 bg-[var(--hairline)] sm:block"
      />

      <h1 className="flex min-w-0 flex-1">
        <span className="truncate text-[15px] font-semibold tracking-tight glass-text-dark sm:text-[17px]">
          {title}
        </span>
      </h1>

      <button
        aria-expanded={settingsOpen}
        aria-haspopup="dialog"
        aria-label="Settings"
        className="focus-glass flex h-11 w-11 shrink-0 items-center justify-center rounded-full glass-text-dark hover:bg-white/15"
        onClick={onToggleSettings}
        type="button"
      >
        <GearIcon className="h-4 w-4" />
      </button>
    </header>
  );
}
