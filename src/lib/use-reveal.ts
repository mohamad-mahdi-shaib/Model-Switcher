"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseMarkdown } from "@/lib/markdown";
import { nextBoundary, pace, textLength } from "@/lib/reveal";

/**
 * Paces how much of an answer is on screen, without ever altering the answer.
 *
 * Mounted per assistant message. MessageList is keyed by conversation id, so
 * switching conversations unmounts it and the cleanup clears the timer --
 * queued text from one conversation can never surface in another. Everything
 * returned here is derived: the canonical content remains the single source of
 * truth for persistence, provider context and Copy.
 */

/** Backlog beyond which returning to a hidden tab jumps straight to the end. */
const CATCH_UP_CHARS = 200;

type Options = {
  content: string;
  /** Provider is still sending. */
  streaming: boolean;
  /** False for restored history: show everything at once, with no runs. */
  paced: boolean;
};

export type RevealState = {
  /** The prefix to parse and render. */
  text: string;
  /** Text-space cut positions; empty when nothing is being paced. */
  cuts: readonly number[];
  /** Received characters not yet on screen. */
  pending: number;
  /** Reveal everything received so far and stop pacing this answer. */
  showAll: () => void;
};

const NO_CUTS: readonly number[] = [];

/**
 * Read once, at mount. Reduced motion has to bypass the pacing itself, not
 * merely the fade: queuing text and releasing it on a timer is exactly the
 * "artificial" motion the preference asks us to drop, so chunks are shown as
 * they arrive instead.
 */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useReveal({ content, streaming, paced }: Options): RevealState {
  // Decided once, at mount: an answer restored from storage, one that had
  // already finished before this component existed, or a session that has
  // asked for reduced motion, is never paced.
  const [pacedRun] = useState(() => paced && !prefersReducedMotion());

  const [revealed, setRevealed] = useState(() => (pacedRun ? 0 : content.length));
  const [cuts, setCuts] = useState<number[]>([]);
  const [done, setDone] = useState(!pacedRun);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef(content);
  const streamingRef = useRef(streaming);
  const doneRef = useRef(done);
  const revealedRef = useRef(revealed);

  // Mirrors are synced in an effect, never during render: the scheduler runs
  // from a timer, so it only ever needs values as of the last committed render.
  useEffect(() => {
    contentRef.current = content;
    streamingRef.current = streaming;
    doneRef.current = done;
    revealedRef.current = revealed;
  });

  const clear = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  /** Show everything received and stop pacing. Used by Stop, catch-up, button. */
  const finish = useCallback(() => {
    clear();
    doneRef.current = true;
    setDone(true);
    setRevealed(contentRef.current.length);
  }, [clear]);

  // Named so it can reschedule itself without a ref; identity stays stable.
  const step = useCallback(
    function tick() {
      timer.current = null;
      if (doneRef.current) return;

      const text = contentRef.current;
      const from = revealedRef.current;
      const complete = !streamingRef.current;
      const pending = text.length - from;

      if (pending <= 0) {
        // Drained. If the provider has finished too, this answer is settled.
        if (complete) {
          doneRef.current = true;
          setDone(true);
        }
        return;
      }

      const { words, interval } = pace(pending);
      const next = nextBoundary(text, from, words, complete);

      if (next <= from) {
        // Only a partial trailing word is available. Wait for more -- unless
        // the stream ended, in which case flush whatever is left.
        if (complete) {
          finish();
          return;
        }
        timer.current = setTimeout(tick, interval);
        return;
      }

      // Recorded in TEXT space, which is the unit the renderer counts in.
      const rendered = textLength(parseMarkdown(text.slice(0, next)));
      setCuts((prev) =>
        prev.length && prev[prev.length - 1] >= rendered ? prev : [...prev, rendered],
      );
      revealedRef.current = next;
      setRevealed(next);

      if (next >= text.length && complete) {
        doneRef.current = true;
        setDone(true);
        return;
      }
      timer.current = setTimeout(tick, interval);
    },
    [finish],
  );

  // Keep the chain alive whenever there is something left to show. Depends on
  // content and streaming only, so a tick does not tear the effect down.
  useEffect(() => {
    if (done || timer.current) return;
    if (content.length <= revealed && !streaming) return;
    timer.current = setTimeout(step, pace(content.length - revealed).interval);
  }, [content, streaming, done, revealed, step]);

  // Unmount or conversation switch: drop the timer; nothing schedules after it.
  useEffect(() => clear, [clear]);

  /* ------------------------------------------------------- tab visibility */

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (doneRef.current) return;
      // Timers are throttled while hidden, so a long answer piles up a backlog
      // in the background. Replaying it slowly on return is a pointless wait.
      if (contentRef.current.length - revealedRef.current > CATCH_UP_CHARS) finish();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [finish]);

  /* ------------------------------------------------------------------ output */

  const text = done ? content : content.slice(0, revealed);

  // Cuts are deliberately NOT cleared once the answer settles. Dropping them
  // would replace every run span with a single text node, which would destroy
  // an in-progress selection for no visual gain -- the spans are inert once
  // their one animation has run, and pace() widens groups as the backlog grows
  // so their count stays proportionate to the answer rather than unbounded.
  return {
    text,
    cuts: pacedRun ? cuts : NO_CUTS,
    pending: content.length - text.length,
    showAll: finish,
  };
}
