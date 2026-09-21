"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertIcon,
  ArrowDownIcon,
  BotIcon,
  CheckIcon,
  CopyIcon,
  RefreshIcon,
  SparklesIcon,
} from "@/components/icons";
import { Markdown } from "@/components/workspace/Markdown";
import {
  ERROR_COPY,
  timeFromId,
  type ChatErrorCode,
  type ChatErrorInfo,
  type ChatMessage,
} from "@/lib/chat";
import { getProviderMeta, type ProviderId } from "@/lib/providers";
import type { ChatStatus } from "@/lib/use-conversations";
import { useReveal } from "@/lib/use-reveal";

type MessageListProps = {
  messages: readonly ChatMessage[];
  status: ChatStatus;
  error: ChatErrorCode | null;
  errorInfo: ChatErrorInfo | null;
  provider: ProviderId;
  onRetry: () => void;
  onUsePrompt: (text: string) => void;
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

/**
 * No container: the user message reads directly on the main glass panel. It
 * previously carried `glass-btn` plus its own radius and border, which stacked
 * a second glass box on top of the approved one. Identity now comes from
 * alignment, a capped measure, a heavier weight and the sent row beneath.
 */
function UserMessage({ message, fresh }: { message: ChatMessage; fresh: boolean }) {
  const sentAt = timeFromId(message.id);
  return (
    <div className="flex justify-end pt-3">
      {/* The row holds its final size from the first frame -- the entrance
          animates opacity and a few pixels of transform only, so nothing below
          reflows as the message appears. `relative` is only a containing block
          for the streak; the min-width is invisible (there is no box) and just
          keeps the streak a sensible length behind a very short message. */}
      <div className="relative min-w-[160px] max-w-[min(58ch,520px)]">
        <div className={fresh ? "user-enter" : ""}>
          {/* whitespace-pre-wrap renders newlines without dangerouslySetInnerHTML. */}
          <p className="text-right text-[13.5px] leading-relaxed font-semibold tracking-tight break-words whitespace-pre-wrap glass-text-dark">
            {message.content}
          </p>
          <p className="mt-1 flex items-center justify-end gap-1 text-[10px] tracking-tight glass-text-subtle">
            {sentAt ? (
              <time dateTime={sentAt.toISOString()}>{formatClock(sentAt)}</time>
            ) : null}
            <span className="sr-only">Sent</span>
            <CheckIcon aria-hidden="true" className="h-2.5 w-2.5" />
          </p>
        </div>
        {/* Newly sent messages only -- a restored conversation renders without
            this element at all, so there is nothing that could replay. Sibling
            of the animated block, so the approved entrance is unaffected. */}
        {fresh ? <span aria-hidden="true" className="gold-streak" /> : null}
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
    <button
      aria-label={copied ? "Response copied" : "Copy response"}
      className="focus-glass mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] glass-text-subtle opacity-0 transition-opacity group-hover/msg:opacity-100 hover:bg-white/12 hover:glass-text-dark focus-visible:opacity-100"
      onClick={copy}
      type="button"
    >
      {copied ? <CheckIcon className="h-2.5 w-2.5" /> : <CopyIcon className="h-2.5 w-2.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function AssistantMessage({
  message,
  streaming,
  fresh,
}: {
  message: ChatMessage;
  streaming: boolean;
  fresh: boolean;
}) {
  const interrupted = message.state === "interrupted";
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
      }`}
    >
      <span className="provider-avatar mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/70 bg-white/15 shadow-sm backdrop-blur-md">
        <BotIcon className="h-3.5 w-3.5 glass-text-dark" />
      </span>
      <div className="min-w-0 max-w-[680px]">
        <div className="assistant-surface text-[12.5px] leading-relaxed">
          {/* aria-busy while text is still being paced, so assistive tech is
              not asked to announce each revealed group as its own update. */}
          <div aria-busy={streaming || pending > 0} className="assistant-content">
            {/* Model output goes through the Markdown AST renderer: React
                elements only, never an HTML string. `copySource` is the whole
                received answer, so a code block's Copy never yields only the
                part that happens to be on screen. */}
            <Markdown copySource={message.content} cuts={cuts} text={text} />
            {streaming ? <span aria-hidden="true" className="stream-caret" /> : null}
            {interrupted ? (
              <p className="mt-1 text-[10.5px] glass-text-subtle">Response interrupted.</p>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Canonical content, never the revealed prefix. */}
          {!streaming && message.content ? <CopyResponse text={message.content} /> : null}
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
              className="glass-btn focus-glass w-full rounded-xl px-3.5 py-2 text-left text-[11.5px] leading-snug glass-text-dark"
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

function SetupState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2.5 px-6 text-center">
      <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/60 bg-white/15 backdrop-blur-md">
        <AlertIcon className="h-4 w-4 glass-text-dark" />
      </span>
      <p className="text-[13px] font-medium glass-text-dark">
        Gemini is not configured
      </p>
      <div className="max-w-[420px] space-y-1.5 text-[11.5px] glass-text-subtle">
        <p>
          Create <code className="font-mono">.env.local</code> in the project
          root and add your key:
        </p>
        <pre className="glass-scroll overflow-x-auto rounded-lg border border-white/25 bg-white/10 px-3 py-2 text-left font-mono text-[10.5px] glass-text-muted">
GEMINI_API_KEY=your-key-here
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
  onRetry,
}: {
  code: ChatErrorCode;
  info: ChatErrorInfo | null;
  onRetry: () => void;
}) {
  return (
    <div className="flex items-start gap-3.5 pt-1" role="alert">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/60 bg-white/15 backdrop-blur-md">
        <AlertIcon className="h-3.5 w-3.5 glass-text-dark" />
      </span>
      <div className="min-w-0">
        <p className="text-[12.5px] glass-text-dark">{ERROR_COPY[code]}</p>
        {info ? (
          <QuotaDetail
            info={info}
            key={`${info.quotaId ?? ""}-${info.retryAfterSeconds ?? 0}`}
          />
        ) : null}
        <button
          className="glass-btn focus-glass mt-2 inline-flex h-[26px] items-center gap-1.5 rounded-full px-3 text-[11px] font-medium glass-text-dark"
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
  onRetry,
  onUsePrompt,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const streaming = status === "streaming";

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

  const jumpToLatest = () => {
    setAtBottom(true);
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  };

  const needsSetup = error === "MISSING_KEY" && messages.length === 0;
  const isEmpty = messages.length === 0 && !error;

  return (
    <div className="relative z-10 my-4 min-h-0 flex-1">
      <div
        aria-hidden="true"
        className="diffusion-scrim absolute -inset-x-2 -inset-y-1 rounded-[22px]"
      />
      <div
        aria-busy={streaming}
        aria-label="Conversation"
        className="glass-scroll relative h-full space-y-6 overflow-y-auto pr-2"
        onScroll={onScroll}
        ref={scrollRef}
        role="log"
      >
        {needsSetup ? <SetupState /> : null}
        {isEmpty ? <WelcomeState onUsePrompt={onUsePrompt} /> : null}

        {messages.map((message, index) => {
          const isLast = index === messages.length - 1;
          return message.role === "user" ? (
            <UserMessage
              fresh={isFresh(message.id)}
              key={message.id}
              message={message}
            />
          ) : (
            <AssistantMessage
              fresh={isFresh(message.id)}
              key={message.id}
              message={message}
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
              <TypingIndicator provider={provider} />
            </div>
          </div>
        ) : null}

        {error && !needsSetup ? (
          <ErrorRow code={error} info={errorInfo} onRetry={onRetry} />
        ) : null}

        <div ref={endRef} />
      </div>

      {!atBottom && messages.length > 0 ? (
        <button
          aria-label="Jump to latest message"
          className="glass-btn focus-glass absolute bottom-2 left-1/2 z-20 flex h-[28px] -translate-x-1/2 items-center gap-1.5 rounded-full px-3 text-[11px] font-medium glass-text-dark"
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
