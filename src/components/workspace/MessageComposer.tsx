"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { AlertIcon, PaperclipIcon, SparklesIcon, StopIcon } from "@/components/icons";
import { AttachmentTray } from "@/components/workspace/AttachmentTray";
import {
  draftRejectionMessage,
  attachmentRejectionMessage,
  validateAttachmentSizes,
  MAX_CHARS,
  MAX_MESSAGES,
} from "@/lib/limits";
import {
  classifyFile,
  defaultPromptForAttachments,
  stageAttachment,
  type DraftAttachment,
} from "@/lib/attachments";
import { deleteAttachmentsBytes } from "@/lib/attachment-storage";
import { ProviderSwitcher } from "@/components/workspace/ProviderMenu";
import { newId, type AttachmentMeta } from "@/lib/chat";
import type { AvailabilityMap, ProviderId } from "@/lib/providers";
import type { ChatStatus, SendResult } from "@/lib/use-conversations";

export type ComposerHandle = {
  /** Places text in the field for editing. Never sends on its own. */
  setText: (text: string) => void;
};

type MessageComposerProps = {
  status: ChatStatus;
  disabled: boolean;
  disabledReason?: string;
  /** The active conversation is already at the F3 message cap. */
  conversationFull: boolean;
  /**
   * The active conversation contains a message over the per-message limit
   * (Finding U1, independent follow-up review). This conversation can never
   * be sent further at all -- there is no partial fix, only a new
   * conversation -- so, like `conversationFull`, it is a property of the
   * conversation itself, not of whatever draft happens to be typed.
   */
  hasOversizedHistoryMessage: boolean;
  onSend: (text: string, attachments?: AttachmentMeta[]) => SendResult;
  onStop: () => void;
  onStartNewConversation: () => void;
  handleRef?: Ref<ComposerHandle>;
  /**
   * Responsive UI refinement (placement pass): provider selection now lives
   * in this bottom toolbar rather than the header -- see ProviderMenu.tsx
   * for the trigger/listbox/confirmation-dialog implementation this simply
   * wires up. Nothing here reads or resets `value` (the draft) as part of
   * switching, which is what keeps an unsent draft intact across a provider
   * change -- see MessageComposer.test-equivalent coverage in
   * tests/browser/verify-responsive.mjs.
   */
  provider: ProviderId;
  availability: AvailabilityMap | null;
  conversationStarted: boolean;
  onSelectProvider: (id: ProviderId) => void;
  providerMenuOpen: boolean;
  onProviderMenuOpenChange: (open: boolean) => void;
  portalContainer: HTMLElement | null;
};

const MAX_ROWS = 6;

export function MessageComposer({
  status,
  disabled,
  disabledReason,
  conversationFull,
  hasOversizedHistoryMessage,
  onSend,
  onStop,
  onStartNewConversation,
  handleRef,
  provider,
  availability,
  conversationStarted,
  onSelectProvider,
  providerMenuOpen,
  onProviderMenuOpenChange,
  portalContainer,
}: MessageComposerProps) {
  const [value, setValue] = useState("");
  // F3: set only when a submit attempt is refused for a reason worth its own
  // copy (too long / conversation full) -- not for "empty" or the guards
  // send() applies before ever reaching validation, which the surrounding UI
  // already prevents or explains another way.
  const [rejection, setRejection] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streaming = status === "streaming";

  useImperativeHandle(handleRef, () => ({
    setText: (text: string) => {
      setValue(text);
      const el = areaRef.current;
      if (el) {
        el.focus();
        requestAnimationFrame(() => {
          el.selectionStart = el.selectionEnd = text.length;
        });
      }
    },
  }));

  // Grow with content up to MAX_ROWS, then scroll. Keeps the composer visible.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 20 * MAX_ROWS)}px`;
  }, [value]);

  // Revoke every still-outstanding preview URL on unmount -- a normal send
  // already revokes its own (see `submit()`), this only catches drafts
  // abandoned mid-edit (a conversation switch, closing the tab).
  useEffect(() => {
    return () => {
      for (const a of attachments) if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount-only cleanup, intentionally not re-running per keystroke/attachment change.
  }, []);

  /**
   * Stages one batch of files: validates each individually (type/content),
   * then the whole now-current set together (count/size), so "too many" or
   * "over budget" rejects the files that just caused it rather than
   * silently dropping some. A rejected file still gets a chip explaining
   * why, with a remove control -- never a silent drop.
   *
   * A file's chip appears immediately, in `"staging"` state (with a real
   * thumbnail for an image, from the original file, so there's no blank
   * flash), rather than only once `stageAttachment()` resolves -- reading a
   * large photo and, when it's oversized, recompressing it is real async
   * work that can take a visible moment, and the whole point of the loading
   * state is showing that it's still in progress rather than the chip
   * silently appearing only once it's already done.
   */
  const handleFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    const placeholders: DraftAttachment[] = files.map((file) => ({
      id: newId("att"),
      name: file.name,
      size: file.size,
      kind: classifyFile(file),
      status: "staging",
      previewUrl: classifyFile(file) === "image" ? URL.createObjectURL(file) : undefined,
    }));
    setAttachments((prev) => [...prev, ...placeholders]);

    const staged = await Promise.all(
      files.map((file, i) => stageAttachment(file, placeholders[i].id)),
    );

    setAttachments((prev) => {
      const resolvedById = new Map(staged.map((a) => [a.id, a]));
      const replaced = prev.map((a) => {
        const resolved = resolvedById.get(a.id);
        if (!resolved) return a;
        // The placeholder's own temporary preview (from the original file)
        // is superseded by the resolved chip's (from the possibly-
        // compressed one) -- revoked here rather than left to leak.
        if (a.previewUrl && a.previewUrl !== resolved.previewUrl) URL.revokeObjectURL(a.previewUrl);
        return resolved;
      });
      const stagedIds = new Set(placeholders.map((p) => p.id));
      const readyCheck = validateAttachmentSizes(
        replaced.filter((a) => a.status === "ready").map((a) => ({ name: a.name, size: a.size })),
      );
      if (readyCheck.ok) return replaced;
      const message = attachmentRejectionMessage(readyCheck);
      return replaced.map((a) =>
        stagedIds.has(a.id) && a.status === "ready" ? { ...a, status: "error" as const, error: message } : a,
      );
    });
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      // A removed chip's bytes, if already saved (a "ready" one), will
      // never be attached to any message -- clean them up immediately
      // rather than leaving them orphaned in IndexedDB.
      if (target?.prepared) void deleteAttachmentsBytes([id]);
      return prev.filter((a) => a.id !== id);
    });
  };

  const hasAttachmentErrors = attachments.some((a) => a.status === "error");
  // Send stays disabled while any chip is still staging -- this is the
  // actual fix for "how do I know when I should send it": before, a chip
  // that wasn't finished preparing yet was indistinguishable from a ready
  // one, so nothing stopped sending too early.
  const hasPendingAttachments = attachments.some((a) => a.status === "staging");
  // The chip itself always shows its own reason too (see AttachmentTray), but
  // that caption is small and easy to miss, and it alone was previously the
  // ONLY explanation for why Send had gone gray -- surfaced here as well, in
  // the same place every other send-blocking reason already appears.
  const attachmentErrorMessage = attachments.find((a) => a.status === "error")?.error ?? null;

  const submit = () => {
    if (streaming || disabled) return;
    if (hasAttachmentErrors || hasPendingAttachments) return;
    if (!value.trim() && attachments.length === 0) return;
    const metas: AttachmentMeta[] = attachments
      .filter((a): a is DraftAttachment & { prepared: NonNullable<DraftAttachment["prepared"]> } => Boolean(a.prepared))
      .map((a) => a.prepared.meta);
    // Bug report: sending a photo with nothing typed did nothing at all --
    // Send looked clickable (an attachment alone satisfies the guard above),
    // but the text reaching validateDraft() was still empty, which it
    // unconditionally refuses. Rather than teach validation to special-case
    // "blank but has attachments," a real fallback question is substituted
    // here so what actually gets sent -- and shown in the transcript -- is
    // a genuine question, exactly like asking "what's in this photo?"
    // by hand. Only applies when nothing was typed; real text is untouched.
    const text = value.trim() ? value : defaultPromptForAttachments(attachments);
    const result = onSend(text, metas);
    if (result.ok) {
      setValue("");
      setRejection(null);
      setAttachments([]);
      return;
    }
    // F3/U1: the draft (text AND attachments) is deliberately left exactly
    // as it was in every rejection case -- "too long", "conversation full"
    // and "history too long" must all keep it editable, never lose it.
    if (
      result.reason === "tooLong" ||
      result.reason === "conversationFull" ||
      result.reason === "historyTooLong"
    ) {
      setRejection(draftRejectionMessage(result));
    }
  };

  // A conversation already blocked (at the cap, or carrying an oversized
  // historical message) shows the same notice unconditionally, even before
  // anything is typed -- both are a property of the conversation itself, not
  // of the current draft, and neither clears short of a new conversation.
  // history-too-long takes priority, matching validateDraft()'s own order.
  const capNotice = hasOversizedHistoryMessage
    ? draftRejectionMessage({ ok: false, reason: "historyTooLong", limit: MAX_CHARS })
    : conversationFull
      ? draftRejectionMessage({ ok: false, reason: "conversationFull", limit: MAX_MESSAGES })
      : null;
  const notice = capNotice ?? rejection ?? attachmentErrorMessage;
  const blocked = conversationFull || hasOversizedHistoryMessage;

  return (
    <footer className="relative z-10 shrink-0 pt-1">
      <div
        className={`glass-input-capsule flex flex-col gap-1 rounded-[26px] px-4 py-2.5 transition-colors ${
          dragActive ? "outline outline-2 outline-white/70" : ""
        }`}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragActive(false);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          if (event.dataTransfer.files.length > 0) void handleFiles(event.dataTransfer.files);
        }}
      >
        <AttachmentTray attachments={attachments} onRemove={removeAttachment} />

        <textarea
          aria-label="Message"
          className="glass-scroll max-h-[120px] w-full resize-none border-0 bg-transparent py-1 text-[13px] leading-5 glass-text-dark outline-none placeholder:text-[color:var(--ink-subtle)] focus:outline-none disabled:cursor-not-allowed"
          disabled={disabled}
          onChange={(event) => {
            setValue(event.target.value);
            // A fresh edit clears a stale "too long" notice; it reappears on
            // the next submit attempt if the new text is still over budget.
            if (rejection) setRejection(null);
          }}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter inserts a line break. IME composition
            // must not be interrupted.
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              submit();
            }
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData?.files ?? []);
            if (files.length === 0) return; // ordinary text paste, untouched
            event.preventDefault();
            void handleFiles(files);
          }}
          placeholder={disabled ? (disabledReason ?? "Unavailable") : "Ask anything…"}
          ref={areaRef}
          rows={1}
          title={disabled ? disabledReason : undefined}
          value={value}
        />

        {/* Interaction refinement: provider selection moved to the RIGHT of
            the toolbar, grouped with Send/Stop but with a real `gap-3`
            (~12px) between them so a mis-tap can't land on both -- the
            trigger's own borderless style, listbox, and confirmation dialog
            are otherwise unchanged. The attachment button anchors the LEFT
            end of this same row. */}
        <div className="flex items-center justify-between gap-2 pt-0.5">
          <button
            aria-label="Attach files"
            className="focus-glass flex h-11 w-11 shrink-0 items-center justify-center rounded-full glass-text-subtle transition-colors hover:bg-white/12 hover:glass-text-dark"
            disabled={disabled}
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            <PaperclipIcon className="h-4 w-4" />
          </button>
          <input
            accept="image/jpeg,image/png,image/webp,application/pdf,.txt,.md,.csv,.json,.js,.ts,.tsx,.jsx,.py,.java,.c,.cpp,.h,.css,.html,.yaml,.yml,.xml,.sh"
            className="sr-only"
            multiple
            onChange={(event) => {
              if (event.target.files) void handleFiles(event.target.files);
              event.target.value = ""; // lets the same file be re-picked after removal
            }}
            ref={fileInputRef}
            type="file"
          />

          <div className="flex items-center gap-3">
            <ProviderSwitcher
              availability={availability}
              busy={streaming}
              conversationStarted={conversationStarted}
              onOpenChange={onProviderMenuOpenChange}
              onSelectProvider={onSelectProvider}
              open={providerMenuOpen}
              portalContainer={portalContainer}
              provider={provider}
            />

            {streaming ? (
              // Responsive UI refinement: 44x44 CSS px, the touch-target floor
              // this pass asks for on every "primary control" at every size --
              // not narrowed back down at wider breakpoints, since a larger
              // click target costs a mouse user nothing. The visible glyph
              // stays the same small size as before; only the tappable circle
              // around it grew.
              <button
                aria-label="Stop generating"
                className="focus-glass flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/90 bg-gradient-to-tr from-white/35 to-white/70 text-[#1a1c22] shadow-sm backdrop-blur-md transition-all"
                onClick={onStop}
                type="button"
              >
                <StopIcon className="h-3 w-3" />
              </button>
            ) : (
              <button
                aria-label="Send message"
                className="focus-glass flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/90 bg-gradient-to-tr from-white/35 to-white/70 text-[#1a1c22] shadow-sm backdrop-blur-md transition-all disabled:cursor-not-allowed disabled:opacity-50"
                disabled={
                  disabled ||
                  (!value.trim() && attachments.length === 0) ||
                  blocked ||
                  hasAttachmentErrors ||
                  hasPendingAttachments
                }
                onClick={submit}
                title={disabled ? disabledReason : undefined}
                type="button"
              >
                <SparklesIcon className="h-3.5 w-3.5" strokeWidth="2.2" />
              </button>
            )}
          </div>
        </div>
      </div>
      {notice ? (
        <p
          className="mt-1.5 flex flex-wrap items-start gap-x-1.5 gap-y-0.5 px-4 text-[10px] leading-snug glass-text-subtle"
          role="alert"
        >
          <AlertIcon className="mt-px h-3 w-3 shrink-0" />
          <span>{notice}</span>
          {blocked ? (
            <button
              className="focus-glass font-medium underline underline-offset-2 glass-text-dark"
              onClick={onStartNewConversation}
              type="button"
            >
              Start new conversation
            </button>
          ) : null}
        </p>
      ) : (
        <p className="mt-1.5 px-4 text-[10px] glass-text-subtle">
          Enter to send · Shift+Enter for a new line
        </p>
      )}
    </footer>
  );
}
