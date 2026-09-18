"use client";

import { useEffect, useRef, useState } from "react";
import { AlertIcon, BotIcon, RefreshIcon, SparklesIcon } from "@/components/icons";
import {
  ERROR_COPY,
  type ChatErrorCode,
  type ChatErrorInfo,
  type ChatMessage,
} from "@/lib/chat";
import type { ChatStatus } from "@/lib/use-chat";

type MessageListProps = {
  messages: readonly ChatMessage[];
  status: ChatStatus;
  error: ChatErrorCode | null;
  errorInfo: ChatErrorInfo | null;
  onRetry: () => void;
};

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end pt-2">
      {/* whitespace-pre-wrap renders newlines without dangerouslySetInnerHTML. */}
      <div className="glass-btn max-w-md rounded-[22px] border border-white/80 px-5 py-2.5 text-[13px] leading-snug font-medium tracking-tight break-words whitespace-pre-wrap glass-text-dark">
        {content}
      </div>
    </div>
  );
}

function AssistantMessage({
  content,
  streaming,
}: {
  content: string;
  streaming: boolean;
}) {
  return (
    <div className="flex items-start gap-3.5 pt-1">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/70 bg-white/15 shadow-sm backdrop-blur-md">
        <BotIcon className="h-3.5 w-3.5 glass-text-dark" />
      </span>
      <div className="min-w-0 max-w-[680px] text-[12.5px] leading-relaxed">
        {/* Model output is rendered as plain text, never as HTML or markdown,
            so nothing the model returns can inject markup. */}
        <p className="break-words whitespace-pre-wrap glass-text-muted">
          {content}
          {streaming ? (
            <span
              aria-hidden="true"
              className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-[2px] bg-[color:var(--ink)] opacity-70"
            />
          ) : null}
        </p>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/60 bg-white/15 backdrop-blur-md">
        <SparklesIcon className="h-4 w-4 glass-text-dark" />
      </span>
      <p className="text-[13px] font-medium glass-text-dark">
        Start a conversation
      </p>
      <p className="max-w-[320px] text-[11.5px] glass-text-subtle">
        Ask Gemini anything. Follow-up questions keep the context of this
        conversation.
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

/**
 * Counts down Google's retryDelay so the wait is concrete, not guesswork.
 * Reset happens by remounting (see the key on QuotaDetail) rather than by
 * setting state inside the effect.
 */
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
          Limit: <strong className="font-semibold">{info.quotaValue}</strong>{" "}
          requests
          {perDay ? " per day" : perMinute ? " per minute" : ""}
          {info.quotaModel ? ` for ${info.quotaModel}` : ""} on the free tier.
        </p>
      ) : null}

      {info.retryAfterSeconds ? (
        <p>
          Google asks to retry in{" "}
          <strong className="font-semibold">
            {left > 0 ? `${left}s` : "now"}
          </strong>
          .
          {perDay ? (
            <>
              {" "}
              That delay only paces requests — a{" "}
              <strong className="font-semibold">daily</strong> cap will not
              clear until the quota resets.
            </>
          ) : null}
        </p>
      ) : null}

      {info.quotaScope === "zero" ? (
        <p>This model has no free-tier quota on this project.</p>
      ) : null}

      <p>
        Current usage:{" "}
        <span className="font-mono">https://ai.dev/rate-limit</span>
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

export function MessageList({
  messages,
  status,
  error,
  errorInfo,
  onRetry,
}: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const streaming = status === "streaming";

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, status]);

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
        role="log"
      >
        {needsSetup ? <SetupState /> : null}
        {isEmpty ? <EmptyState /> : null}

        {messages.map((message, index) => {
          const isLast = index === messages.length - 1;
          return message.role === "user" ? (
            <UserBubble content={message.content} key={message.id} />
          ) : (
            <AssistantMessage
              content={message.content}
              key={message.id}
              streaming={streaming && isLast}
            />
          );
        })}

        {/* Thinking state: streaming has begun but no token has arrived yet. */}
        {streaming && messages.at(-1)?.role === "user" ? (
          <div className="flex items-center gap-3.5 pt-1">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/70 bg-white/15 backdrop-blur-md">
              <BotIcon className="h-3.5 w-3.5 glass-text-dark" />
            </span>
            <span className="text-[12.5px] glass-text-subtle">Thinking…</span>
          </div>
        ) : null}

        {error && !needsSetup ? (
          <ErrorRow code={error} info={errorInfo} onRetry={onRetry} />
        ) : null}

        <div ref={endRef} />
      </div>
    </div>
  );
}
