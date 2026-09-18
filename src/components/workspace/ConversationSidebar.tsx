"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertIcon,
  PencilIcon,
  PlusIcon,
  SparklesIcon,
  TrashIcon,
} from "@/components/icons";
import { groupByRecency } from "@/lib/conversations";
import type { Conversation, StorageStatus } from "@/lib/storage";

type ConversationSidebarProps = {
  conversations: readonly Conversation[];
  activeId: string | null;
  storageStatus: StorageStatus;
  onNew: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
};

const STORAGE_NOTE: Partial<Record<StorageStatus, string>> = {
  unavailable:
    "Browser storage is unavailable, so this session will not be saved.",
  corrupt:
    "Saved history could not be read and was left untouched. This session runs in memory.",
  full: "Browser storage is full, so recent changes may not be saved.",
};

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
            className="focus-glass rounded-md border border-white/40 px-2 py-0.5 text-[10px] font-medium glass-text-dark hover:bg-white/15"
            onClick={() => onDelete(conversation.id)}
            type="button"
          >
            Delete
          </button>
          <button
            className="focus-glass rounded-md px-2 py-0.5 text-[10px] glass-text-subtle hover:bg-white/10"
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
        className="glass-row focus-glass w-full rounded-lg py-1 pr-12 pl-1.5 text-left text-[11.5px]"
        onClick={() => onSelect(conversation.id)}
        type="button"
      >
        <span
          className={`block truncate ${
            active ? "font-medium glass-text-dark" : "font-normal glass-text-muted"
          }`}
        >
          {conversation.title}
        </span>
      </button>
      {/* Compact actions: always reachable by keyboard, revealed on hover. */}
      <span className="absolute top-1/2 right-1 flex -translate-y-1/2 gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
        <button
          aria-label={`Rename ${conversation.title}`}
          className="focus-glass rounded p-1 glass-text-subtle hover:bg-white/15 hover:glass-text-dark"
          onClick={() => setEditing(true)}
          type="button"
        >
          <PencilIcon className="h-3 w-3" />
        </button>
        <button
          aria-label={`Delete ${conversation.title}`}
          className="focus-glass rounded p-1 glass-text-subtle hover:bg-white/15 hover:glass-text-dark"
          onClick={() => setConfirming(true)}
          type="button"
        >
          <TrashIcon className="h-3 w-3" />
        </button>
      </span>
    </li>
  );
}

export function ConversationSidebar({
  conversations,
  activeId,
  storageStatus,
  onNew,
  onSelect,
  onRename,
  onDelete,
}: ConversationSidebarProps) {
  const groups = groupByRecency(conversations);
  const note = STORAGE_NOTE[storageStatus];

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
        onClick={onNew}
        type="button"
      >
        <PlusIcon className="h-3.5 w-3.5" strokeWidth="2.4" />
        <span>New conversation</span>
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
        <div
          aria-hidden="true"
          className="diffusion-scrim absolute -inset-x-2 -inset-y-1 rounded-[18px]"
        />
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
      </div>
    </aside>
  );
}
