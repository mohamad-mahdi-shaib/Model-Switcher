"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
  XIcon,
} from "@/components/icons";
import { groupByRecency } from "@/lib/conversations";
import { searchConversations, type SearchResult } from "@/lib/search";
import type { Conversation, StorageStatus } from "@/lib/storage";

type ConversationSidebarProps = {
  conversations: readonly Conversation[];
  activeId: string | null;
  storageStatus: StorageStatus;
  onNew: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  /**
   * Interaction refinement: this supersedes the previous pass's
   * always-visible compact rail. Below `lg` (1024px -- mobile AND narrow
   * tablet) the sidebar is a closed-by-default portaled drawer, opened only
   * by the global header's toggle button (`AppHeader.tsx`/`WorkspaceLayout`
   * -- there is no longer an in-sidebar trigger to open it, since nothing
   * inside this component is visible until it is already open). `mobileOpen`
   * is that drawer's open state; `desktopSidebarCollapsed` is the
   * independent, `>=lg`-only collapse state for the inline sidebar.
   */
  mobileOpen: boolean;
  onMobileClose: () => void;
  desktopSidebarCollapsed: boolean;
  portalContainer: HTMLElement | null;
  /**
   * Interaction refinement: local search over conversation titles and
   * saved message text (`@/lib/search`). Lifted to WorkspaceLayout, like
   * every other piece of sidebar state, so there is one query and one
   * result set regardless of which shell (full sidebar or drawer) is
   * currently showing it. Selecting a message match also scrolls to and
   * briefly highlights it -- `messageId` is null for a title-only match.
   */
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onSelectSearchResult: (conversationId: string, messageId: string | null) => void;
};

const STORAGE_NOTE: Partial<Record<StorageStatus, string>> = {
  unavailable:
    "Browser storage is unavailable, so this session will not be saved.",
  corrupt:
    "Saved history could not be read and was left untouched. This session runs in memory.",
  full: "Browser storage is full, so recent changes may not be saved.",
};

const FOCUSABLE_SELECTOR = "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

function Row({
  conversation,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  conversation: Conversation;
  active: boolean;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(conversation.title);
  const [confirming, setConfirming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft !== conversation.title) {
      onRename(conversation.id, draft);
    } else {
      setDraft(conversation.title);
    }
  };

  if (editing) {
    return (
      <li>
        <input
          aria-label={`Rename ${conversation.title}`}
          className="focus-glass w-full rounded-lg border border-white/30 bg-white/12 px-1.5 py-1 text-[11.5px] glass-text-dark outline-none"
          onBlur={commit}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(conversation.title);
              setEditing(false);
            }
          }}
          ref={inputRef}
          value={draft}
        />
      </li>
    );
  }

  if (confirming) {
    return (
      <li className="rounded-lg border border-white/30 bg-white/12 px-1.5 py-1.5">
        <p className="mb-1 text-[10.5px] leading-snug glass-text-dark">
          Delete “{conversation.title}”?
        </p>
        <div className="flex gap-1">
          <button
            className="focus-glass min-h-11 rounded-md border border-white/40 px-2 py-0.5 text-[10px] font-medium glass-text-dark hover:bg-white/15"
            onClick={() => onDelete(conversation.id)}
            type="button"
          >
            Delete
          </button>
          <button
            className="focus-glass min-h-11 rounded-md px-2 py-0.5 text-[10px] glass-text-subtle hover:bg-white/10"
            onClick={() => setConfirming(false)}
            type="button"
          >
            Cancel
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="group/row relative">
      <button
        aria-current={active ? "true" : undefined}
        className="glass-row focus-glass min-h-11 w-full rounded-lg py-1 pr-16 pl-1.5 text-left text-[11.5px]"
        onClick={() => onSelect(conversation.id)}
        type="button"
      >
        {/* Settings pass: inactive rows now match the active row's own
            font-medium weight (previously font-normal, a step lighter) --
            "chat names" read clearly on their own now, distinguished from
            the active row purely by ink color and the highlighted
            background, rather than needing a lighter weight to carry part
            of that distinction too. */}
        <span
          className={`block truncate font-medium ${active ? "glass-text-dark" : "glass-text-muted"}`}
        >
          {conversation.title}
        </span>
      </button>
      <span className="absolute top-1/2 right-1 flex -translate-y-1/2 gap-0.5">
        <button
          aria-label={`Rename ${conversation.title}`}
          className="focus-glass flex h-8 w-8 items-center justify-center rounded p-1 glass-text-subtle hover:bg-white/15 hover:glass-text-dark"
          onClick={() => setEditing(true)}
          type="button"
        >
          <PencilIcon className="h-3.5 w-3.5" />
        </button>
        <button
          aria-label={`Delete ${conversation.title}`}
          className="focus-glass flex h-8 w-8 items-center justify-center rounded p-1 glass-text-subtle hover:bg-white/15 hover:glass-text-dark"
          onClick={() => setConfirming(true)}
          type="button"
        >
          <TrashIcon className="h-3.5 w-3.5" />
        </button>
      </span>
    </li>
  );
}

/** Bolds the matched substring within a snippet -- no background fill (a
 * plain `<mark>` default would clash with the glass palette), just weight
 * and ink strength, consistent with how selection is already signalled
 * elsewhere in this sidebar. `dir="auto"` lets the browser's own bidi
 * algorithm lay Arabic/mixed-direction snippets out correctly with no
 * extra logic here. */
function HighlightedSnippet({ snippet, start, length }: { snippet: string; start: number; length: number }) {
  if (length <= 0 || start < 0 || start + length > snippet.length) return <>{snippet}</>;
  return (
    <span dir="auto">
      {snippet.slice(0, start)}
      <mark className="bg-transparent font-semibold glass-text-dark">
        {snippet.slice(start, start + length)}
      </mark>
      {snippet.slice(start + length)}
    </span>
  );
}

function SearchResultsList({
  results,
  activeIndex,
  onSelect,
  query,
  listboxId,
}: {
  results: SearchResult[];
  activeIndex: number;
  onSelect: (conversationId: string, messageId: string | null) => void;
  query: string;
  /**
   * Prefixed with the caller's own `useId()` value -- the full sidebar and
   * the mobile drawer both render a `SidebarBody`, and the drawer stays
   * MOUNTED (just CSS-hidden via its ancestor's `display:none`) below `lg`
   * even while the drawer is the one actually shown, so a literal, un-
   * prefixed id here would collide with the other instance's -- duplicate
   * ids that broke both `aria-activedescendant` correctness and any
   * `#id`-based query, real assistive tech included, not just a test.
   */
  listboxId: string;
}) {
  if (results.length === 0) {
    return (
      <p className="px-1.5 pt-1 text-[10.5px] leading-snug glass-text-subtle">
        No matches for “{query.trim()}”.
      </p>
    );
  }
  return (
    <ul
      aria-label="Search results"
      className="glass-scroll relative h-full space-y-1 overflow-y-auto pr-1"
      id={listboxId}
      role="listbox"
    >
      {results.map((result, index) => (
        <li key={result.id}>
          <button
            aria-selected={index === activeIndex}
            className={`focus-glass flex min-h-11 w-full flex-col items-start gap-0.5 rounded-lg px-2 py-1.5 text-left ${
              index === activeIndex ? "bg-white/14" : "hover:bg-white/8"
            }`}
            id={`${listboxId}-${result.id}`}
            onClick={() => onSelect(result.conversationId, result.messageId)}
            role="option"
            type="button"
          >
            <span className="block w-full truncate text-[11px] font-medium glass-text-dark">
              {result.conversationTitle}
            </span>
            <span className="block w-full truncate text-[10px] glass-text-subtle">
              <HighlightedSnippet length={result.matchLength} snippet={result.snippet} start={result.matchStart} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

type SidebarBodyProps = Omit<
  ConversationSidebarProps,
  "mobileOpen" | "onMobileClose" | "desktopSidebarCollapsed" | "portalContainer"
>;

function SidebarBody({
  conversations,
  activeId,
  storageStatus,
  onNew,
  onSelect,
  onRename,
  onDelete,
  searchQuery,
  onSearchQueryChange,
  onSelectSearchResult,
}: SidebarBodyProps) {
  const groups = groupByRecency(conversations);
  const note = STORAGE_NOTE[storageStatus];
  const searchInputRef = useRef<HTMLInputElement>(null);
  // See SearchResultsList's own comment on `listboxId`: this SidebarBody
  // can be mounted twice at once (full sidebar + drawer), so a literal id
  // here would collide with the other instance's.
  const listboxId = `${useId()}-search-results`;

  const results = useMemo(
    () => searchConversations(conversations, searchQuery),
    [conversations, searchQuery],
  );
  const searching = searchQuery.trim().length > 0;
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const clampedIndex = results.length === 0 ? -1 : Math.min(activeResultIndex, results.length - 1);

  return (
    <>
      {/* Layout-restructure pass: the brand mark that used to open this body
          now lives in the global header (`AppHeader.tsx`), where it is
          visible whether or not the sidebar is open. This region is purely
          the conversation list and the two actions that operate on it. */}

      {/* Interaction refinement: local search, above New chat, per the
          task's own ordering ("Search chats, New chat, saved
          conversations, Settings"). Purely local (`@/lib/search`) -- no
          request is ever made, and results recompute fresh from whatever
          `conversations` currently is, so a rename/delete/new message never
          leaves a stale result behind. */}
      <div className="relative shrink-0">
        <SearchIcon
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 glass-text-subtle"
        />
        <input
          aria-activedescendant={clampedIndex >= 0 ? `${listboxId}-${results[clampedIndex].id}` : undefined}
          aria-controls={listboxId}
          aria-expanded={searching}
          aria-label="Search chats"
          className="focus-glass h-11 w-full rounded-xl border border-white/25 bg-white/10 pr-9 pl-8 text-[12px] glass-text-dark outline-none placeholder:glass-text-subtle"
          onChange={(e) => {
            onSearchQueryChange(e.target.value);
            setActiveResultIndex(0);
          }}
          onKeyDown={(e) => {
            // A non-empty query clears first; only an Escape on an already-
            // empty query is left to bubble (to the drawer's own Escape-
            // closes handler, when this is rendered inside one).
            if (e.key === "Escape") {
              if (searchQuery) {
                e.stopPropagation();
                onSearchQueryChange("");
              }
              return;
            }
            if (!searching || results.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveResultIndex((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveResultIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const result = results[clampedIndex];
              if (result) onSelectSearchResult(result.conversationId, result.messageId);
            }
          }}
          placeholder="Search chats"
          ref={searchInputRef}
          role="combobox"
          type="text"
          value={searchQuery}
        />
        {searchQuery ? (
          <button
            aria-label="Clear search"
            className="focus-glass absolute top-1/2 right-1.5 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full glass-text-subtle hover:bg-white/15"
            onClick={() => {
              onSearchQueryChange("");
              searchInputRef.current?.focus();
            }}
            type="button"
          >
            <XIcon className="h-3 w-3" />
          </button>
        ) : null}
      </div>

      <button
        className="glass-btn focus-glass flex h-11 w-full items-center justify-center gap-1.5 rounded-xl text-[12px] font-medium tracking-tight glass-text-dark active:scale-[0.98]"
        onClick={onNew}
        type="button"
      >
        <PlusIcon className="h-3.5 w-3.5" strokeWidth="2.4" />
        <span>New chat</span>
      </button>

      {note ? (
        <p
          className="flex items-start gap-1.5 rounded-lg border border-white/25 bg-white/10 px-2 py-1.5 text-[10px] leading-snug glass-text-subtle"
          role="status"
        >
          <AlertIcon className="mt-px h-3 w-3 shrink-0" />
          {note}
        </p>
      ) : null}

      <div className="relative min-h-0 flex-1">
        {searching ? (
          <SearchResultsList
            activeIndex={clampedIndex}
            listboxId={listboxId}
            onSelect={onSelectSearchResult}
            query={searchQuery}
            results={results}
          />
        ) : (
          <nav
            aria-label="Conversation history"
            className="glass-scroll relative h-full overflow-y-auto pr-1"
          >
            {groups.length === 0 ? (
              <p className="px-1.5 pt-1 text-[10.5px] leading-snug glass-text-subtle">
                No saved conversations yet. Send a message and it will appear here.
              </p>
            ) : (
              <div className="space-y-3.5 pt-1">
                {groups.map((group) => (
                  <section key={group.label}>
                    <h2 className="mb-1.5 px-1 text-[10px] font-semibold tracking-wider uppercase glass-text-subtle">
                      {group.label}
                    </h2>
                    <ul className="space-y-1">
                      {group.conversations.map((conversation) => (
                        <Row
                          active={conversation.id === activeId}
                          conversation={conversation}
                          key={conversation.id}
                          onDelete={onDelete}
                          onRename={onRename}
                          onSelect={onSelect}
                        />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </nav>
        )}
      </div>
    </>
  );
}

type MobileDrawerProps = Omit<
  ConversationSidebarProps,
  "mobileOpen" | "onMobileClose" | "desktopSidebarCollapsed"
> & {
  onClose: () => void;
};

/**
 * The closed-by-default drawer for mobile and narrow tablet (<lg). Opened
 * only by the global header's toggle button (`WorkspaceLayout`/`AppHeader`).
 * Backdrop + panel portaled together as true DOM siblings, full keyboard
 * focus trap while open, focus restored on close, and selecting a
 * conversation closes the drawer as part of the same action.
 */
function MobileDrawer({ onClose, portalContainer, ...body }: MobileDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    return () => {
      restoreFocusRef.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!portalContainer) return null;

  return createPortal(
    <>
      {/* Blurred, not just dimmed: the drawer's own panel is deliberately
          see-through (`.optical-glass`, matching the workspace's own
          background/design), so without blurring what sits behind it the
          chat panel's text/controls stayed sharp enough to compete with the
          drawer's own content. The blur is on this backdrop layer only --
          the drawer panel itself is unaffected, and the effect disappears
          the instant the drawer closes. */}
      <div aria-hidden="true" className="fixed inset-0 z-40 bg-black/40 backdrop-blur-md" onClick={onClose} />
      {/*
        `.optical-glass`, the same material as the full sidebar and the chat
        panel -- so the opened drawer reads as the same surface and color as
        the rest of the workspace instead of a visually disconnected card.
        Portaled as a true sibling into `<main>` (a backdrop-filter-free
        ancestor), so this blur still reaches the real page background
        directly, exactly like the full sidebar's own `.optical-glass`
        already does. Trade-off, by explicit request: the chat panel's own
        controls sitting underneath stay faintly legible through the drawer
        (the dimmed backdrop is what marks them inert, not full occlusion).
      */}
      <div
        aria-label="Conversations"
        className="optical-glass glass-scroll fixed inset-y-3 left-3 z-50 flex w-[min(300px,calc(100vw-48px))] flex-col gap-4 overflow-y-auto rounded-[28px] p-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))]"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
      >
        <button
          aria-label="Close conversation list"
          className="focus-glass absolute top-4 right-4 flex h-11 w-11 items-center justify-center rounded-full glass-text-dark hover:bg-white/15"
          onClick={onClose}
          ref={closeButtonRef}
          type="button"
        >
          <XIcon className="h-4 w-4" />
        </button>
        <SidebarBody
          {...body}
          onNew={() => {
            body.onNew();
            onClose();
          }}
          onSelect={(id) => {
            body.onSelect(id);
            onClose();
          }}
          onSelectSearchResult={(conversationId, messageId) => {
            body.onSelectSearchResult(conversationId, messageId);
            onClose();
          }}
        />
      </div>
    </>,
    portalContainer,
  );
}

export function ConversationSidebar({
  mobileOpen,
  onMobileClose,
  desktopSidebarCollapsed,
  portalContainer,
  ...body
}: ConversationSidebarProps) {
  return (
    <>
      {/* Desktop/tablet, >=lg (1024px): full inline sidebar, open by
          default. Pure CSS visibility for the viewport threshold itself (no
          JS gating there, so there is no hydration-timing flash); the
          `desktopSidebarCollapsed` collapse is a separate, ordinary
          `useState(false)` conditional render -- its default value agrees
          with the server render, so toggling it (only ever a user action,
          post-hydration) carries no mismatch risk either. Width and padding
          still scale fluidly with the viewport via clamp(). */}
      {!desktopSidebarCollapsed ? (
        <aside
          aria-label="Conversations"
          // Full-width pass: a fixed, consistent width (and a fixed
          // padding) rather than the previous `clamp(200px,20vw,238px)`.
          // A viewport-relative width made the sidebar a different size on
          // every screen -- and, because it was capped at 238px, it could
          // never take a sensible share of a wide one. The main panel takes
          // all remaining width, so this is the only width that needs
          // deciding.
          className="optical-glass hidden w-[248px] shrink-0 flex-col gap-3.5 rounded-[24px] p-3 xl:w-[276px] xl:p-3.5 lg:flex"
        >
          <SidebarBody {...body} />
        </aside>
      ) : null}

      {mobileOpen ? (
        <MobileDrawer onClose={onMobileClose} portalContainer={portalContainer} {...body} />
      ) : null}
    </>
  );
}
