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
import { DocumentTray } from "@/components/workspace/DocumentTray";
import {
  documentKindFromName,
  DOCUMENT_ACCEPT_ATTRIBUTE,
  MAX_DOCUMENTS_PER_CONVERSATION,
  type DocumentRef,
} from "@/lib/documents";
import { uploadDocument, type DraftDocument } from "@/lib/document-upload";
import { ProviderSwitcher } from "@/components/workspace/ProviderMenu";
import { newId, type AttachmentMeta } from "@/lib/chat";
import { getProviderMeta, type AvailabilityMap, type ProviderId } from "@/lib/providers";
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
  /* ----------------------------------------------- Project 4: documents */
  /**
   * The conversation an upload belongs to, captured when the file is picked
   * rather than read when the upload finishes -- parsing and embedding a
   * large PDF takes real time, and the user may switch conversations while
   * it runs. Null before hydration, which disables document upload.
   */
  conversationId: string | null;
  /** Files already indexed for this conversation. */
  documents: readonly DocumentRef[];
  /**
   * Whether the server can index documents (blob storage + embeddings).
   * When false, a picked document falls back to the pre-existing inline
   * attachment path, so an unconfigured deployment behaves exactly as it
   * did before this feature existed rather than refusing the file.
   */
  documentsEnabled: boolean;
  /** Records a finished upload. Returns false if the conversation is full. */
  onDocumentIndexed: (conversationId: string, document: DocumentRef) => boolean;
  onRemoveDocument: (id: string) => void;
  /** Opens the structured-extraction dialog. */
  onExtract: () => void;
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
  conversationId,
  documents,
  documentsEnabled,
  onDocumentIndexed,
  onRemoveDocument,
  onExtract,
}: MessageComposerProps) {
  const [value, setValue] = useState("");
  // F3: set only when a submit attempt is refused for a reason worth its own
  // copy (too long / conversation full) -- not for "empty" or the guards
  // send() applies before ever reaching validation, which the surrounding UI
  // already prevents or explains another way.
  const [rejection, setRejection] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  /**
   * Project 4: uploads still in flight (and failed ones, kept visible until
   * dismissed). A SUCCEEDED upload is not held here -- it moves to the
   * conversation itself via `onDocumentIndexed`, because it now outlives
   * this draft and survives a reload, which is the whole difference between
   * a document and an attachment.
   */
  const [documentDrafts, setDocumentDrafts] = useState<DraftDocument[]>([]);
  const uploadAborts = useRef(new Map<string, AbortController>());
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
    const all = Array.from(fileList);
    if (all.length === 0) return;

    /**
     * Project 4: a picked file goes to ONE of two places.
     *
     * A document (PDF, DOCX, XLSX, CSV, code, text) goes to the document
     * workspace: parsed, chunked, embedded and searchable for the rest of
     * the conversation. Anything else -- in practice an image -- stays on
     * the pre-existing inline attachment path, which is what vision models
     * read.
     *
     * The capability check matters. On a server without blob storage or
     * embeddings there is nothing to index into, so documents fall back to
     * inline attachments and behave exactly as they did before this
     * feature existed -- a deployment missing one variable loses document
     * search, not the ability to attach a PDF.
     */
    const canIndex = documentsEnabled && Boolean(conversationId);
    const files = canIndex ? all.filter((file) => !documentKindFromName(file.name)) : all;
    const documentFiles = canIndex ? all.filter((file) => documentKindFromName(file.name)) : [];
    if (documentFiles.length > 0) void uploadDocuments(documentFiles);
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

  /**
   * Uploads documents one at a time.
   *
   * Sequential, not parallel, and deliberately so: each upload parses the
   * file and then embeds every chunk of it, so ten files at once is the
   * fastest way to hit the embedding service's rate limit and have most of
   * them fail together. One after another is slower in the best case and far
   * more likely to finish in the realistic one. Each file's chip reports its
   * own progress, so the queue is visible rather than looking stalled.
   */
  const uploadDocuments = async (files: File[]) => {
    const conversation = conversationId;
    if (!conversation) return;

    let indexed = documents.length;
    for (const file of files) {
      const key = newId("doc");
      const kind = documentKindFromName(file.name);

      if (indexed >= MAX_DOCUMENTS_PER_CONVERSATION) {
        // Refused with its own chip and reason, never dropped silently.
        setDocumentDrafts((prev) => [
          ...prev,
          {
            key,
            name: file.name,
            size: file.size,
            kind,
            status: "error",
            error: `At most ${MAX_DOCUMENTS_PER_CONVERSATION} files per conversation. Remove one first.`,
          },
        ]);
        continue;
      }

      const controller = new AbortController();
      uploadAborts.current.set(key, controller);
      setDocumentDrafts((prev) => [
        ...prev,
        { key, name: file.name, size: file.size, kind, status: "uploading" },
      ]);

      const outcome = await uploadDocument(file, conversation, {
        existingCount: indexed,
        signal: controller.signal,
      });
      uploadAborts.current.delete(key);

      // The chip may have been dismissed (and the request aborted) while
      // this was in flight -- in which case there is nothing to report and
      // nothing to record.
      if (controller.signal.aborted) continue;

      if (outcome.ok) {
        // Lands on the conversation it was dropped into, which may no
        // longer be the open one.
        const accepted = onDocumentIndexed(conversation, outcome.document);
        setDocumentDrafts((prev) =>
          accepted
            ? prev.filter((draft) => draft.key !== key)
            : prev.map((draft) =>
                draft.key === key
                  ? { ...draft, status: "error", error: "This conversation is already full." }
                  : draft,
              ),
        );
        if (accepted) indexed += 1;
        continue;
      }

      setDocumentDrafts((prev) =>
        prev.map((draft) =>
          draft.key === key ? { ...draft, status: "error", error: outcome.message } : draft,
        ),
      );
    }
  };

  /** Cancels an in-flight upload, or dismisses a failed one's chip. */
  const dismissDocumentDraft = (key: string) => {
    uploadAborts.current.get(key)?.abort();
    uploadAborts.current.delete(key);
    setDocumentDrafts((prev) => prev.filter((draft) => draft.key !== key));
  };

  // Abort every still-running upload if the composer goes away (a closed
  // tab, a conversation switch that remounts it) rather than leaving a
  // request writing into a conversation nobody is looking at.
  useEffect(() => {
    const aborts = uploadAborts.current;
    return () => {
      for (const controller of aborts.values()) controller.abort();
      aborts.clear();
    };
  }, []);

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
  /**
   * Project 4: a question asked while a file is still being indexed would
   * not search that file -- the document id does not exist yet -- and the
   * answer would look as though the file had been read. Send waits, exactly
   * as it already does for a staging attachment.
   */
  const indexingDocuments = documentDrafts.some((d) => d.status === "uploading");
  // The chip itself always shows its own reason too (see AttachmentTray), but
  // that caption is small and easy to miss, and it alone was previously the
  // ONLY explanation for why Send had gone gray -- surfaced here as well, in
  // the same place every other send-blocking reason already appears.
  const attachmentErrorMessage = attachments.find((a) => a.status === "error")?.error ?? null;

  const submit = () => {
    if (streaming || disabled) return;
    if (hasAttachmentErrors || hasPendingAttachments || indexingDocuments) return;
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
  /**
   * Project 3, Phase 5: the selected model cannot read images, and the user
   * has staged one anyway.
   *
   * Warn, never silently drop. The send is NOT blocked -- the user may well
   * want the text answered regardless -- and the server keeps the same
   * promise from its side: `toModelMessages()` replaces an unreadable
   * attachment with an explicit note rather than deleting it, so neither the
   * model nor the transcript pretends the image was never attached.
   */
  const meta = getProviderMeta(provider);
  const stagedImages = attachments.filter((a) => a.kind === "image").length;
  const visionNotice =
    stagedImages > 0 && !meta.vision
      ? `${meta.label} cannot read images. Your ${stagedImages === 1 ? "image" : "images"} will be named in the message but not analysed — switch to a vision model to have ${stagedImages === 1 ? "it" : "them"} read.`
      : null;

  const documentErrorMessage = documentDrafts.find((d) => d.status === "error")?.error ?? null;
  const indexingNotice = indexingDocuments
    ? `Reading and indexing ${documentDrafts.filter((d) => d.status === "uploading").length === 1 ? "your file" : "your files"} — Send unlocks once ${documentDrafts.filter((d) => d.status === "uploading").length === 1 ? "it is" : "they are"} searchable.`
    : null;

  const notice =
    capNotice ?? rejection ?? attachmentErrorMessage ?? documentErrorMessage ?? indexingNotice ?? visionNotice;
  const blocked = conversationFull || hasOversizedHistoryMessage;

  return (
    // Composer-region pass: a plain element, not `<footer>`. The workspace
    // now has a real global footer (`AppFooter.tsx`) and the chat input is
    // deliberately NOT part of it -- the two carry different things (one
    // sends a message, the other reports status), and merging them would
    // make both harder to read. The composer stays where it already was:
    // pinned to the bottom of the main region as a `shrink-0` flex item
    // below the transcript's own `flex-1` scroll area, so the history
    // scrolls independently above it, the input never moves, and neither
    // one can overlap the other or the global footer below.
    //
    // `mx-auto` + `--content-column`: the same centred column the transcript
    // uses, so the input lines up with the conversation it belongs to
    // rather than stretching the full width of a now-full-width panel.
    <div className="relative z-10 mx-auto w-full max-w-[var(--content-column)] shrink-0 pt-1">
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
        <DocumentTray
          documents={documents}
          drafts={documentDrafts}
          onDismissDraft={dismissDocumentDraft}
          onExtract={onExtract}
          onRemoveDocument={onRemoveDocument}
        />

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
            /* Images for vision, plus every document type the workspace can
               parse -- DOCX and XLSX among them, which the inline
               attachment path never accepted. */
            accept={`image/jpeg,image/png,image/webp,${DOCUMENT_ACCEPT_ATTRIBUTE}`}
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
                  hasPendingAttachments ||
                  indexingDocuments
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
    </div>
  );
}
