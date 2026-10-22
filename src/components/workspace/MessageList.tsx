"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertIcon,
  ArrowDownIcon,
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  FileIcon,
  PencilIcon,
  RefreshIcon,
  SparklesIcon,
  SpeakerIcon,
  StopIcon,
  XIcon,
} from "@/components/icons";
import { SaveAnswerMenu } from "@/components/workspace/SaveAnswerMenu";
import { GeneratedImages } from "@/components/workspace/GeneratedImages";
import { Markdown } from "@/components/workspace/Markdown";
import {
  errorCopy,
  noticeForOutcome,
  providerKeyName,
  timeFromId,
  type AttachmentMeta,
  type ChatErrorCode,
  type ChatErrorInfo,
  type ChatMessage,
  type GeneratedImageRef,
} from "@/lib/chat";
import { getAttachmentBytes } from "@/lib/attachment-storage";
import { draftRejectionMessage } from "@/lib/limits";
import { getProviderMeta, type ProviderId } from "@/lib/providers";
import type { ChatStatus, SendResult } from "@/lib/use-conversations";
import { useReveal } from "@/lib/use-reveal";
import { useSpeech, type VoiceGenderPreference } from "@/lib/use-speech";
import { detectSpeechLang, markdownToSpeechText } from "@/lib/speech-text";

type MessageListProps = {
  messages: readonly ChatMessage[];
  status: ChatStatus;
  error: ChatErrorCode | null;
  errorInfo: ChatErrorInfo | null;
  /** The currently SELECTED provider -- used for setup copy and as a fallback. */
  provider: ProviderId;
  /**
   * The provider the failed/in-flight request actually targeted (Finding
   * F5). Used for the error banner and the typing indicator, which must
   * never silently follow a selector change made after the request left.
   */
  requestProvider: ProviderId;
  onRetry: () => void;
  onUsePrompt: (text: string) => void;
  /**
   * Interaction refinement: set by selecting a search result
   * (`ConversationSidebar.tsx` / `WorkspaceLayout.tsx`) to scroll to and
   * briefly flash one message. `onHighlightHandled` resets it back to
   * null once done, which is what lets selecting the SAME result again
   * re-trigger the effect (a prop that does not change would not
   * re-fire the `useEffect` watching it).
   */
  highlightMessageId?: string | null;
  onHighlightHandled?: () => void;
  /**
   * Interaction refinement: Regenerate/version-select/edit-resend are all
   * only ever offered on the conversation's LATEST turn (see
   * `use-conversations.ts`'s own comments on why) -- `MessageList` already
   * computes `isLast` per message for streaming, so the same flag gates
   * these too, rather than threading a second "is this editable" concept
   * down from the caller.
   */
  onRegenerate: (messageId: string) => void;
  /** Project 3: generated-image follow-ups, both routed through a new send. */
  onRegenerateImage?: (image: GeneratedImageRef) => void;
  onImageVariation?: (image: GeneratedImageRef) => void;
  onSelectVersion: (messageId: string, versionId: string) => void;
  onEditResend: (messageId: string, newText: string) => SendResult;
  /**
   * Interaction refinement: drops one dead attachment reference (bytes
   * confirmed missing from IndexedDB) from an already-sent message. See
   * `use-conversations.ts`'s `removeAttachment()` for why there is no
   * "reattach" counterpart.
   */
  onRemoveAttachment: (messageId: string, attachmentId: string) => void;
  /** Settings > Read aloud. See `use-speech.ts`'s `speak()` for fallback
   * behavior when `speechVoiceId` no longer matches an available voice. */
  speechVoiceId: string;
  speechRate: number;
  speechVoiceGender: VoiceGenderPreference;
};

const STARTERS = [
  "Explain a concept I keep half-understanding, simply.",
  "Draft a short, friendly status update for my team.",
  "Help me choose between two options I am stuck on.",
];

/* ----------------------------------------------------------------- messages */

function formatClock(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatAttachmentSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

/**
 * One sent attachment, as it appears with the user message that carried it.
 * Checks IndexedDB for the real bytes on mount rather than assuming they are
 * still there -- storage pressure or manual clearing can remove them
 * independently of the (still-persisted) message metadata. An image whose
 * bytes are present gets a genuine thumbnail (`URL.createObjectURL` on the
 * real bytes, not a stand-in icon); one whose bytes are gone shows an
 * explicit "unavailable" state with a real remove control, never a silent
 * broken image.
 */
function SentAttachmentChip({
  attachment,
  onRemoveUnavailable,
}: {
  attachment: AttachmentMeta;
  onRemoveUnavailable: () => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    void getAttachmentBytes(attachment.id).then((bytes) => {
      if (cancelled) return;
      if (!bytes) {
        setUnavailable(true);
        return;
      }
      if (attachment.kind === "image") {
        url = URL.createObjectURL(new Blob([bytes], { type: attachment.mimeType }));
        setPreviewUrl(url);
      }
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [attachment.id, attachment.kind, attachment.mimeType]);

  return (
    <li
      className={`glass-btn flex max-w-[200px] items-center gap-2 rounded-xl py-1 pr-1 pl-2 text-[10.5px] ${
        unavailable ? "border border-white/40" : ""
      }`}
      title={unavailable ? "This attachment's data is no longer stored in this browser." : attachment.name}
    >
      {previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- a local blob: preview of previously-saved bytes, not a remote/optimizable image.
        <img alt="" className="h-7 w-7 shrink-0 rounded-md object-cover" src={previewUrl} />
      ) : (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/15">
          {unavailable ? (
            <AlertIcon className="h-3.5 w-3.5 glass-text-subtle" />
          ) : (
            <FileIcon className="h-3.5 w-3.5 glass-text-subtle" />
          )}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium glass-text-dark">{attachment.name}</span>
        <span className="block truncate glass-text-subtle">
          {unavailable ? "Unavailable in this browser" : formatAttachmentSize(attachment.size)}
        </span>
      </span>
      {unavailable ? (
        <button
          aria-label={`Remove ${attachment.name}`}
          className="focus-glass flex h-11 w-11 shrink-0 items-center justify-center rounded-full glass-text-subtle hover:bg-white/15"
          onClick={onRemoveUnavailable}
          type="button"
        >
          <XIcon className="h-3 w-3" />
        </button>
      ) : null}
    </li>
  );
}

function SentAttachments({
  attachments,
  onRemove,
}: {
  attachments: readonly AttachmentMeta[] | undefined;
  onRemove: (attachmentId: string) => void;
}) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <ul aria-label="Sent attachments" className="mt-1 flex flex-wrap justify-end gap-1.5">
      {attachments.map((attachment) => (
        <SentAttachmentChip attachment={attachment} key={attachment.id} onRemoveUnavailable={() => onRemove(attachment.id)} />
      ))}
    </ul>
  );
}

/**
 * No container: the user message reads directly on the main glass panel. It
 * previously carried `glass-btn` plus its own radius and border, which stacked
 * a second glass box on top of the approved one. Identity now comes from
 * alignment, a capped measure, a heavier weight and the sent row beneath.
 */
function UserMessage({
  message,
  fresh,
  flashed,
  editable,
  onEditResend,
  onRemoveAttachment,
}: {
  message: ChatMessage;
  fresh: boolean;
  flashed: boolean;
  /** Interaction refinement: only the conversation's latest user turn. */
  editable: boolean;
  onEditResend: (newText: string) => SendResult;
  onRemoveAttachment: (attachmentId: string) => void;
}) {
  const sentAt = timeFromId(message.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [notice, setNotice] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) return;
    const el = textareaRef.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  const startEdit = () => {
    setDraft(message.content);
    setNotice(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    // The original is untouched throughout editing -- this just discards
    // the draft, nothing to restore.
    setEditing(false);
    setNotice(null);
  };

  const saveAndResend = () => {
    const result = onEditResend(draft);
    if (result.ok) {
      setEditing(false);
      setNotice(null);
      return;
    }
    // Same three draft-specific reasons the composer itself surfaces --
    // "busy"/"noConversation"/"providerDisabled" stay silent, since Edit is
    // only ever offered when none of them can actually happen.
    if (result.reason === "tooLong" || result.reason === "conversationFull" || result.reason === "historyTooLong") {
      setNotice(draftRejectionMessage(result));
    }
  };

  if (editing) {
    return (
      <div className="flex justify-end pt-3" data-message-id={message.id}>
        <div className="w-full max-w-[min(58ch,520px)]">
          <div className="glass-input-capsule rounded-[18px] px-3 py-2">
            <textarea
              aria-label="Edit message"
              className="glass-scroll max-h-[160px] w-full resize-none border-0 bg-transparent text-right text-[calc(13.5px*var(--text-scale,1))] leading-relaxed font-semibold tracking-tight glass-text-dark outline-none"
              onChange={(e) => {
                setDraft(e.target.value);
                if (notice) setNotice(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  cancelEdit();
                }
              }}
              ref={textareaRef}
              rows={Math.min(6, Math.max(1, draft.split("\n").length))}
              value={draft}
            />
          </div>
          <p className="mt-1 px-1 text-right text-[10px] leading-snug glass-text-subtle">
            Resending replaces the reply that followed this message.
            {message.attachments && message.attachments.length > 0
              ? " Its attachments will not be included in the resend."
              : ""}
          </p>
          {notice ? (
            <p className="mt-1 flex items-center justify-end gap-1 px-1 text-[10px] leading-snug glass-text-subtle" role="alert">
              <AlertIcon className="h-3 w-3 shrink-0" />
              {notice}
            </p>
          ) : null}
          <div className="mt-1.5 flex justify-end gap-1.5">
            <button
              className="focus-glass min-h-11 rounded-full px-3 py-1 text-[11px] glass-text-subtle hover:bg-white/12"
              onClick={cancelEdit}
              type="button"
            >
              Cancel
            </button>
            <button
              className="glass-btn focus-glass min-h-11 rounded-full px-3 py-1 text-[11px] font-medium glass-text-dark disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!draft.trim()}
              onClick={saveAndResend}
              type="button"
            >
              Save &amp; resend
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-end pt-3">
      {/* The row holds its final size from the first frame -- the entrance
          animates opacity and a few pixels of transform only, so nothing below
          reflows as the message appears. `relative` is only a containing block
          for the travelling light. No min-width: the wrapper shrinks to the
          message and its timestamp, so the light traces the content rather
          than an empty box around it. `data-message-id` and the `search-flash`
          class both live here, on the same element the scroll target and the
          flash visually apply to -- not the outer alignment row. */}
      <div
        className={`relative max-w-[min(58ch,520px)] ${flashed ? "search-flash" : ""}`}
        data-message-id={message.id}
      >
        <div className={fresh ? "user-enter" : ""}>
          {/* whitespace-pre-wrap renders newlines without dangerouslySetInnerHTML. */}
          <p className="text-right text-[calc(13.5px*var(--text-scale,1))] leading-relaxed font-semibold tracking-tight break-words whitespace-pre-wrap glass-text-dark">
            {message.content}
          </p>
          <SentAttachments attachments={message.attachments} onRemove={onRemoveAttachment} />
          <p className="mt-1 flex items-center justify-end gap-1 text-[10px] tracking-tight glass-text-subtle">
            {sentAt ? (
              <time dateTime={sentAt.toISOString()}>{formatClock(sentAt)}</time>
            ) : null}
            <span className="sr-only">Sent</span>
            <CheckIcon aria-hidden="true" className="h-2.5 w-2.5" />
          </p>
        </div>
        {editable ? (
          <div className="flex justify-end">
            <button
              aria-label="Edit message"
              className="focus-glass mt-1 inline-flex min-h-11 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] glass-text-subtle transition-colors hover:bg-white/12 hover:glass-text-dark"
              onClick={startEdit}
              type="button"
            >
              <PencilIcon className="h-2.5 w-2.5" />
              Edit
            </button>
          </div>
        ) : null}
        {/* Newly sent messages only -- a restored conversation renders without
            this element at all, so there is nothing that could replay. Sibling
            of the animated block, so the approved entrance is unaffected. */}
        {fresh ? <span aria-hidden="true" className="gold-orbit" /> : null}
      </div>
    </div>
  );
}

function CopyResponse({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }, [text]);

  return (
    // Responsive UI refinement: previously `opacity-0` until hover or
    // keyboard focus -- hover does not exist on touch, and tapping the
    // message body itself never focuses this sibling button, so a touch
    // user had no way to discover this control at all. Always visible now,
    // at a min-h-11 touch target; the `hover:` rule is harmless extra
    // emphasis for mouse users, not load-bearing for visibility anymore.
    <button
      aria-label={copied ? "Response copied" : "Copy response"}
      className="focus-glass mt-1 inline-flex min-h-11 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] glass-text-subtle transition-colors hover:bg-white/12 hover:glass-text-dark"
      onClick={copy}
      type="button"
    >
      {copied ? <CheckIcon className="h-2.5 w-2.5" /> : <CopyIcon className="h-2.5 w-2.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/**
 * The compact "< 2/2 >" alternate-answer selector (Interaction
 * refinement). Always rendered once a message has more than one version --
 * so a later reader can still see it had alternates -- but only
 * interactive on the conversation's latest message; see
 * `use-conversations.ts`'s `selectMessageVersion()` for why switching an
 * earlier one is deliberately not supported rather than half-built.
 */
function VersionSelector({
  message,
  interactive,
  onSelectVersion,
}: {
  message: ChatMessage;
  interactive: boolean;
  onSelectVersion: (versionId: string) => void;
}) {
  const versions = message.versions;
  if (!versions || versions.length < 2) return null;
  const selectedIndex = Math.max(0, versions.findIndex((v) => v.id === message.selectedVersionId));
  const goTo = (index: number) => {
    const version = versions[index];
    if (version) onSelectVersion(version.id);
  };
  return (
    <div
      aria-label="Answer version"
      className="mt-1 flex items-center gap-0.5 text-[10px] glass-text-subtle"
      role="group"
    >
      <button
        aria-label="Previous version"
        className="focus-glass flex h-11 w-6 items-center justify-center rounded disabled:cursor-not-allowed disabled:opacity-40"
        disabled={!interactive || selectedIndex <= 0}
        onClick={() => goTo(selectedIndex - 1)}
        type="button"
      >
        <ChevronDownIcon className="h-2.5 w-2.5 rotate-90" />
      </button>
      <span className="tabular-nums">
        {selectedIndex + 1}/{versions.length}
      </span>
      <button
        aria-label="Next version"
        className="focus-glass flex h-11 w-6 items-center justify-center rounded disabled:cursor-not-allowed disabled:opacity-40"
        disabled={!interactive || selectedIndex >= versions.length - 1}
        onClick={() => goTo(selectedIndex + 1)}
        type="button"
      >
        <ChevronDownIcon className="h-2.5 w-2.5 -rotate-90" />
      </button>
    </div>
  );
}

function AssistantMessage({
  message,
  streaming,
  fresh,
  flashed,
  fallbackProvider,
  isLast,
  onRegenerate,
  onRegenerateImage,
  onImageVariation,
  onSelectVersion,
  speaking,
  speechError,
  speechSupported,
  onToggleSpeech,
}: {
  message: ChatMessage;
  streaming: boolean;
  fresh: boolean;
  flashed: boolean;
  /** Used only for answers saved before per-message attribution existed. */
  fallbackProvider: ProviderId;
  /** Interaction refinement: Regenerate/version-select gate on this. */
  isLast: boolean;
  onRegenerate: () => void;
  /** Project 3: re-run a generated image's own original prompt. */
  onRegenerateImage?: (image: GeneratedImageRef) => void;
  /** Project 3: ask for a variation of a generated image. */
  onImageVariation?: (image: GeneratedImageRef) => void;
  onSelectVersion: (versionId: string) => void;
  speaking: boolean;
  speechError: boolean;
  speechSupported: boolean;
  onToggleSpeech: () => void;
}) {
  const interrupted = message.state === "interrupted";
  // F2: concise, accurate wording for WHY this answer is partial. Returns the
  // exact original "Response interrupted." for Stop and for any message with
  // no recorded outcome at all (legacy saved data), so nothing about that
  // case's display changes.
  const notice = noticeForOutcome(message.state, message.outcome, message.outcomeReason);
  // Paced only for an answer that is genuinely arriving now. A restored or
  // already-finished message mounts fully revealed and emits no run spans.
  const { text, cuts, pending, showAll } = useReveal({
    content: message.content,
    streaming,
    paced: fresh && message.state === "streaming",
  });

  // Stop must surface everything already received, at once.
  useEffect(() => {
    if (interrupted) showAll();
  }, [interrupted, showAll]);

  return (
    // The class is on the row and the row is keyed by message id, so the
    // animation runs once on insertion. Streamed tokens re-render the contents
    // of a node that already exists; they neither restart nor re-trigger it.
    <div
      className={`group/msg flex items-start gap-3.5 pt-1 ${
        fresh ? "assistant-enter" : ""
      } ${flashed ? "search-flash" : ""}`}
      data-message-id={message.id}
      // Scopes --accent to the model that produced THIS answer, so switching
      // provider does not re-tint the transcript behind it.
      data-msg-provider={message.provider ?? fallbackProvider}
    >
      <span className="provider-avatar mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/70 bg-white/15 shadow-sm backdrop-blur-md">
        <BotIcon className="h-3.5 w-3.5 glass-text-dark" />
      </span>
      <div className="min-w-0 max-w-[680px]">
        <div className="assistant-surface text-[calc(12.5px*var(--text-scale,1))] leading-relaxed">
          {/* aria-busy while text is still being paced, so assistive tech is
              not asked to announce each revealed group as its own update. */}
          <div aria-busy={streaming || pending > 0} className="assistant-content">
            {/* Model output goes through the Markdown AST renderer: React
                elements only, never an HTML string. `copySource` is the whole
                received answer, so a code block's Copy never yields only the
                part that happens to be on screen. */}
            <Markdown copySource={message.content} cuts={cuts} text={text} />
            {/* Project 3: images this turn generated by calling the
                `generate_image` tool. Rendered inside the assistant surface,
                so they read as part of the answer rather than a detached
                gallery, and they re-render from persisted history on reload.
                Follow-up actions are withheld while the turn is still
                streaming. */}
            {message.images && message.images.length > 0 ? (
              <GeneratedImages
                images={message.images}
                onRegenerate={streaming ? undefined : onRegenerateImage}
                onVariation={streaming ? undefined : onImageVariation}
              />
            ) : null}
            {streaming ? <span aria-hidden="true" className="stream-caret" /> : null}
            {notice ? (
              <p className="mt-1 text-[10.5px] glass-text-subtle">{notice}</p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Canonical content, never the revealed prefix. */}
          {!streaming && message.content ? <CopyResponse text={message.content} /> : null}
          {/* Project 4: the same canonical content, as a real file. Offered
              on every settled answer, not only the latest -- an earlier
              answer is just as worth keeping, and nothing about saving it
              depends on it being the most recent. */}
          {!streaming && message.content ? <SaveAnswerMenu text={message.content} /> : null}
          {/* Interaction refinement: only on the conversation's latest,
              settled answer -- see use-conversations.ts's regenerate() for
              why. A real provider request, never a replay of existing
              text. */}
          {isLast && !streaming && message.state !== "streaming" ? (
            <button
              aria-label="Regenerate response"
              className="focus-glass mt-1 inline-flex min-h-11 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] glass-text-subtle transition-colors hover:bg-white/12 hover:glass-text-dark"
              onClick={onRegenerate}
              type="button"
            >
              <RefreshIcon className="h-2.5 w-2.5" />
              Regenerate
            </button>
          ) : null}
          {/* Interaction refinement: browser/device speech synthesis only --
              no paid TTS API. Hidden entirely when unsupported, rather than
              shown disabled, since there is nothing a user could do about
              it. */}
          {speechSupported && !streaming && message.content ? (
            <button
              aria-label={speaking ? "Stop reading" : "Read aloud"}
              className="focus-glass mt-1 inline-flex min-h-11 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] glass-text-subtle transition-colors hover:bg-white/12 hover:glass-text-dark"
              onClick={onToggleSpeech}
              type="button"
            >
              {speaking ? <StopIcon className="h-2.5 w-2.5" /> : <SpeakerIcon className="h-2.5 w-2.5" />}
              {speaking ? "Stop" : "Read aloud"}
            </button>
          ) : null}
          {speechError ? (
            <span className="text-[10px] glass-text-subtle" role="status">
              Couldn’t read this aloud.
            </span>
          ) : null}
          {pending > 0 ? (
            <button
              className="focus-glass mt-1 inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] glass-text-subtle hover:bg-white/12 hover:glass-text-dark"
              onClick={showAll}
              type="button"
            >
              Show full response
            </button>
          ) : null}
        </div>
        <VersionSelector interactive={isLast} message={message} onSelectVersion={onSelectVersion} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- states */

function WelcomeState({ onUsePrompt }: { onUsePrompt: (t: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <span className="provider-avatar mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/60 bg-white/15 shadow-sm backdrop-blur-md">
        <SparklesIcon className="h-5 w-5 glass-text-dark" strokeWidth="2" />
      </span>
      <h2 className="text-[19px] font-semibold tracking-tight glass-text-dark">
        Welcome to AI Workspace
      </h2>
      <p className="mt-1.5 max-w-[390px] text-[12px] leading-relaxed glass-text-muted">
        A calm place to think out loud. Ask anything — follow-ups keep the
        thread, and every conversation is saved to this browser.
      </p>

      <p className="mt-6 mb-2 text-[9.5px] font-semibold tracking-[0.14em] uppercase glass-text-subtle">
        Try starting with
      </p>
      <ul className="flex w-full max-w-[420px] flex-col gap-1.5">
        {STARTERS.map((prompt) => (
          <li key={prompt}>
            <button
              className="glass-btn focus-glass min-h-11 w-full rounded-xl px-3.5 py-2 text-left text-[11.5px] leading-snug glass-text-dark"
              onClick={() => onUsePrompt(prompt)}
              type="button"
            >
              {prompt}
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[10px] glass-text-subtle">
        Prompts fill the composer so you can edit before sending.
      </p>
    </div>
  );
}

/**
 * Finding F5: previously hardcoded to Gemini/GEMINI_API_KEY regardless of
 * which provider is actually selected and unconfigured -- wrong the moment a
 * second provider existed. `providerKeyName()` is the same lookup
 * `errorCopy()` already uses for an ordinary MISSING_KEY error; reused here
 * rather than reintroducing a second hardcoded mapping.
 */
function SetupState({ provider }: { provider: ProviderId }) {
  const meta = getProviderMeta(provider);
  const keyName = providerKeyName(provider);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2.5 px-6 text-center">
      <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/60 bg-white/15 backdrop-blur-md">
        <AlertIcon className="h-4 w-4 glass-text-dark" />
      </span>
      <p className="text-[13px] font-medium glass-text-dark">
        {meta.label} is not configured
      </p>
      <div className="max-w-[420px] space-y-1.5 text-[11.5px] glass-text-subtle">
        <p>
          Create <code className="font-mono">.env.local</code> in the project
          root and add your key:
        </p>
        <pre className="glass-scroll overflow-x-auto rounded-lg border border-white/25 bg-white/10 px-3 py-2 text-left font-mono text-[10.5px] glass-text-muted">
{keyName}=your-key-here
        </pre>
        <p>Then restart the dev server. No replies are simulated meanwhile.</p>
      </div>
    </div>
  );
}

function TypingIndicator({ provider }: { provider: ProviderId }) {
  const label = `${getProviderMeta(provider).label} is responding`;
  return (
    // The avatar sits at the same offset as the assistant row's, so when the
    // first token swaps this for the answer the identity stays put and only
    // the sheet arrives -- the two are never on screen together.
    <div className="typing-row flex items-center gap-3.5 pt-1">
      <span className="provider-avatar flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/70 bg-white/15 backdrop-blur-md">
        <BotIcon className="h-3.5 w-3.5 glass-text-dark" />
      </span>
      {/* Dots are decorative; the live region below carries the meaning. */}
      <span aria-hidden="true" className="typing-dots">
        <i />
        <i />
        <i />
      </span>
      <span className="text-[11.5px] glass-text-subtle" role="status">
        {label}
      </span>
    </div>
  );
}

function useCountdown(seconds: number | undefined) {
  const [left, setLeft] = useState(seconds ?? 0);
  useEffect(() => {
    if (!seconds) return;
    const t = setInterval(() => setLeft((v) => (v <= 1 ? 0 : v - 1)), 1000);
    return () => clearInterval(t);
  }, [seconds]);
  return left;
}

function QuotaDetail({ info }: { info: ChatErrorInfo }) {
  const left = useCountdown(info.retryAfterSeconds);
  const perDay = info.quotaScope === "day";
  const perMinute = info.quotaScope === "minute";
  return (
    <div className="mt-1.5 space-y-1 text-[11px] glass-text-subtle">
      {info.quotaValue !== undefined ? (
        <p>
          Limit: <strong className="font-semibold">{info.quotaValue}</strong> requests
          {perDay ? " per day" : perMinute ? " per minute" : ""}
          {info.quotaModel ? ` for ${info.quotaModel}` : ""} on the free tier.
        </p>
      ) : null}
      {info.retryAfterSeconds ? (
        <p>
          Google asks to retry in{" "}
          <strong className="font-semibold">{left > 0 ? `${left}s` : "now"}</strong>.
          {perDay ? (
            <>
              {" "}
              That delay only paces requests — a{" "}
              <strong className="font-semibold">daily</strong> cap will not clear
              until the quota resets.
            </>
          ) : null}
        </p>
      ) : null}
      {info.quotaScope === "zero" ? (
        <p>This model has no free-tier quota on this project.</p>
      ) : null}
      <p>
        Current usage: <span className="font-mono">https://ai.dev/rate-limit</span>
      </p>
    </div>
  );
}

function ErrorRow({
  code,
  info,
  provider,
  onRetry,
}: {
  code: ChatErrorCode;
  info: ChatErrorInfo | null;
  /** The provider that actually failed, so the copy names the right one. */
  provider: ProviderId;
  onRetry: () => void;
}) {
  return (
    <div className="flex items-start gap-3.5 pt-1" role="alert">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/60 bg-white/15 backdrop-blur-md">
        <AlertIcon className="h-3.5 w-3.5 glass-text-dark" />
      </span>
      <div className="min-w-0">
        <p className="text-[12.5px] glass-text-dark">
          {errorCopy(code, getProviderMeta(provider))}
        </p>
        {info ? (
          <QuotaDetail
            info={info}
            key={`${info.quotaId ?? ""}-${info.retryAfterSeconds ?? 0}`}
          />
        ) : null}
        <button
          className="glass-btn focus-glass mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[11px] font-medium glass-text-dark"
          onClick={onRetry}
          type="button"
        >
          <RefreshIcon className="h-3 w-3" />
          Retry
        </button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------- list */

export function MessageList({
  messages,
  status,
  error,
  errorInfo,
  provider,
  requestProvider,
  onRetry,
  onUsePrompt,
  highlightMessageId,
  onHighlightHandled,
  onRegenerate,
  onRegenerateImage,
  onImageVariation,
  onSelectVersion,
  onEditResend,
  onRemoveAttachment,
  speechVoiceId,
  speechRate,
  speechVoiceGender,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // The centred transcript column inside `scrollRef` -- what actually grows
  // as an answer reveals. See the ResizeObserver effect below.
  const contentRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const streaming = status === "streaming";
  const speech = useSpeech();
  // Interaction refinement: the message currently showing the brief
  // "you found this via search" flash. Deliberately separate from the
  // `fresh`/`baseline` entrance-animation system below -- this must never
  // replay an entrance animation, only add a temporary, independent flash.
  const [flashedId, setFlashedId] = useState<string | null>(null);

  // The setState-in-effect rule is suppressed for this block only, the same
  // justified exception `use-conversations.ts`'s own hydration read uses:
  // `scrollIntoView` is an imperative DOM action that can only happen in an
  // effect, and `flashedId`'s timed expiry (a `setTimeout`) has no
  // render-time equivalent to derive it from instead.
  //
  // Split into two effects, deliberately: `onHighlightHandled()` resets the
  // PARENT's `highlightMessageId` back to null, which flows back down here
  // as a changed prop -- and `highlightMessageId` is this first effect's
  // own dependency. A single combined effect (the original shape) would
  // therefore re-run itself the instant `onHighlightHandled()` was called,
  // and its cleanup would clear the just-started 2s timer before it ever
  // fired -- the flash would arrive but never expire. Keeping the expiry
  // timer in a SECOND effect, keyed only on `flashedId` (which does not
  // change again until the timer itself clears it), means resetting
  // `highlightMessageId` no longer touches this timer at all.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!highlightMessageId) return;
    const el = scrollRef.current?.querySelector(`[data-message-id="${CSS.escape(highlightMessageId)}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashedId(highlightMessageId);
    onHighlightHandled?.();
  }, [highlightMessageId, onHighlightHandled]);

  useEffect(() => {
    if (!flashedId) return;
    const timer = setTimeout(() => setFlashedId(null), 2000);
    return () => clearTimeout(timer);
  }, [flashedId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Ids present when this conversation mounted. Those rows never animate, so a
  // restored history stays still on load. Anything appended afterwards is a new
  // DOM node and animates exactly once on insertion.
  //
  // An earlier attempt gated this with a class added shortly after mount, which
  // was wrong: adding the class later starts the animation on every restored
  // row at once -- the precise replay this is meant to avoid. The parent keys
  // this component by conversation id, so switching chats remounts and rebuilds
  // the baseline rather than animating the whole transcript.
  const [baseline] = useState(() => new Set(messages.map((m) => m.id)));
  const isFresh = (msgId: string) => !baseline.has(msgId);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  }, []);

  // Auto-follow only while the reader is already near the bottom, so someone
  // reading back through the transcript is never yanked forward.
  useEffect(() => {
    if (!atBottom) return;
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, status, atBottom]);

  /**
   * The same follow, driven by the transcript's own height instead of by
   * state changes.
   *
   * `messages` and `status` both settle BEFORE the answer has finished
   * laying itself out: the reveal animation (`use-reveal`) keeps adding
   * rendered runs for a while afterwards, and a Markdown list, table or
   * fenced block can reflow again after that. The effect above has already
   * run by then, so the last stretch of a long answer landed below the fold
   * -- and because `atBottom` is only recomputed from a real scroll event,
   * the view still believed it was at the bottom and did not offer "Jump to
   * latest" either. Measured at 85px of hidden tail on a streamed reply.
   *
   * Observing the content element closes that gap at its source: any growth
   * at all, from any cause, re-pins the view to the end -- but still only
   * while the reader is already there.
   */
  useEffect(() => {
    if (!atBottom) return;
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      endRef.current?.scrollIntoView({ block: "end" });
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [atBottom]);

  const jumpToLatest = () => {
    setAtBottom(true);
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  };

  const needsSetup = error === "MISSING_KEY" && messages.length === 0;
  const isEmpty = messages.length === 0 && !error;

  return (
    <div className="relative z-10 my-3 min-h-0 flex-1">
      {/* The scroll viewport spans the whole panel -- so the scrollbar sits
          at the panel's edge where it belongs -- while the transcript
          itself is a centred column of `--content-column`. Below that width
          the column simply fills the viewport, so nothing changes on a
          phone or a laptop; it only stops lines from running the full width
          of a large display. The composer reads the same variable, so the
          two stay aligned as one column. */}
      <div
        aria-busy={streaming}
        aria-label="Conversation"
        className="glass-scroll relative h-full overflow-y-auto pr-2"
        onScroll={onScroll}
        ref={scrollRef}
        role="log"
      >
        <div className="mx-auto w-full max-w-[var(--content-column)] space-y-6" ref={contentRef}>
        {needsSetup ? <SetupState provider={provider} /> : null}
        {isEmpty ? <WelcomeState onUsePrompt={onUsePrompt} /> : null}

        {messages.map((message, index) => {
          const isLast = index === messages.length - 1;
          // Interaction refinement: "the latest user question" -- either
          // the very last message, or immediately followed only by its own
          // assistant reply. Never offered while a request is active.
          const isLatestUserTurn =
            !streaming &&
            message.role === "user" &&
            (isLast || (index === messages.length - 2 && messages[messages.length - 1]?.role === "assistant"));
          return message.role === "user" ? (
            <UserMessage
              editable={isLatestUserTurn}
              flashed={message.id === flashedId}
              fresh={isFresh(message.id)}
              key={message.id}
              message={message}
              onEditResend={(newText) => onEditResend(message.id, newText)}
              onRemoveAttachment={(attachmentId) => onRemoveAttachment(message.id, attachmentId)}
            />
          ) : (
            <AssistantMessage
              fallbackProvider={provider}
              flashed={message.id === flashedId}
              fresh={isFresh(message.id)}
              isLast={isLast}
              key={message.id}
              message={message}
              onImageVariation={onImageVariation}
              onRegenerate={() => onRegenerate(message.id)}
              onRegenerateImage={onRegenerateImage}
              onSelectVersion={(versionId) => onSelectVersion(message.id, versionId)}
              onToggleSpeech={() => {
                if (speech.speakingId === message.id) {
                  speech.stop();
                  return;
                }
                const lang = detectSpeechLang(message.content);
                speech.speak(
                  message.id,
                  markdownToSpeechText(message.content),
                  lang,
                  speechVoiceId,
                  speechRate,
                  speechVoiceGender,
                );
              }}
              speaking={speech.speakingId === message.id}
              speechError={speech.errorId === message.id}
              speechSupported={speech.supported}
              streaming={streaming && isLast && message.state === "streaming"}
            />
          );
        })}

        {/* Mounted for the whole stream, not only until the first token. Once
            the answer exists the slot plays its collapse-and-fade exit, so by
            the time streaming ends and React unmounts it, it is already
            invisible and zero-height -- the beads never simply vanish, and no
            timer or extra state is needed to hold them on screen. */}
        {streaming ? (
          <div
            className={`typing-slot ${
              messages.at(-1)?.role === "user" ? "" : "typing-exit"
            }`}
          >
            <div>
              {/* F5: the request actually in flight, not the (possibly since
                  changed) selector -- though while streaming the selector is
                  locked anyway, so the two only ever differ once Retry can
                  re-target a provider other than what is now selected. */}
              <TypingIndicator provider={requestProvider} />
            </div>
          </div>
        ) : null}

        {error && !needsSetup ? (
          <ErrorRow
            code={error}
            info={errorInfo}
            onRetry={onRetry}
            // F5: the provider that actually produced this error, which may
            // no longer be the one selected -- Retry still targets it too.
            provider={requestProvider}
          />
        ) : null}

        <div ref={endRef} />
        </div>
      </div>

      {!atBottom && messages.length > 0 ? (
        <button
          aria-label="Jump to latest message"
          className="glass-btn focus-glass absolute bottom-2 left-1/2 z-20 flex min-h-11 -translate-x-1/2 items-center gap-1.5 rounded-full px-3 text-[11px] font-medium glass-text-dark"
          onClick={jumpToLatest}
          type="button"
        >
          <ArrowDownIcon className="h-3 w-3" />
          Jump to latest
        </button>
      ) : null}
    </div>
  );
}
