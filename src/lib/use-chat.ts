"use client";

import { useCallback, useRef, useState } from "react";
import {
  newId,
  toWire,
  type ChatErrorCode,
  type ChatMessage,
  type StreamEvent,
} from "@/lib/chat";
import { isProviderEnabled } from "@/lib/providers";

export type ChatStatus = "idle" | "streaming" | "error";

export function useChat(initial: readonly ChatMessage[] = []) {
  const [messages, setMessages] = useState<ChatMessage[]>([...initial]);
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [error, setError] = useState<ChatErrorCode | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  // Guards against a double submit landing two requests before React re-renders.
  const inFlightRef = useRef(false);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    inFlightRef.current = false;
    setStatus("idle");
  }, []);

  /**
   * Streams an answer for `history`, which must already end with the user turn.
   * Kept separate from send() so retry can reuse the exact same history without
   * appending the user's message a second time.
   */
  const run = useCallback(async (history: ChatMessage[], provider: string) => {
    const controller = new AbortController();
    abortRef.current = controller;
    inFlightRef.current = true;
    setStatus("streaming");
    setError(null);

    const replyId = newId("a");
    let opened = false;

    const fail = (code: ChatErrorCode) => {
      setError(code);
      setStatus("error");
      // Drop an empty placeholder so a failed turn leaves no blank bubble.
      setMessages((prev) =>
        prev.filter((m) => !(m.id === replyId && m.content === "")),
      );
    };

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, messages: toWire(history) }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        fail((payload?.code as ChatErrorCode) ?? "UPSTREAM");
        return;
      }
      if (!response.body) {
        fail("NETWORK");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // NDJSON: parse whole lines, keep any partial tail for the next chunk.
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          let event: StreamEvent;
          try {
            event = JSON.parse(line) as StreamEvent;
          } catch {
            continue;
          }

          if (event.type === "delta") {
            if (!opened) {
              opened = true;
              setMessages((prev) => [
                ...prev,
                { id: replyId, role: "assistant", content: event.text },
              ]);
            } else {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === replyId
                    ? { ...m, content: m.content + event.text }
                    : m,
                ),
              );
            }
          } else if (event.type === "error") {
            fail(event.code);
            return;
          }
        }
      }

      // A stream can finish having produced no text at all (a turn the model
      // declines, or one spent entirely on internal reasoning). Without this
      // the UI would simply go quiet, leaving no message and no explanation.
      if (!opened) {
        fail("EMPTY_REPLY");
        return;
      }
      setStatus("idle");
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        // Stop pressed: keep whatever streamed in, return to idle quietly.
        setStatus("idle");
        return;
      }
      fail("NETWORK");
    } finally {
      abortRef.current = null;
      inFlightRef.current = false;
    }
  }, []);

  const send = useCallback(
    (text: string, provider: string) => {
      const content = text.trim();
      if (!content) return false;
      if (inFlightRef.current) return false;
      // Third enforcement point: a disabled provider never reaches the network.
      if (!isProviderEnabled(provider)) return false;

      const userMessage: ChatMessage = {
        id: newId("u"),
        role: "user",
        content,
      };
      const history = [...messages, userMessage];
      setMessages(history);
      void run(history, provider);
      return true;
    },
    [messages, run],
  );

  /** Re-runs the last user turn. Never re-appends it. */
  const retry = useCallback(
    (provider: string) => {
      if (inFlightRef.current) return;
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      if (!lastUser) return;
      const upto = messages.slice(0, messages.indexOf(lastUser) + 1);
      setMessages(upto);
      void run(upto, provider);
    },
    [messages, run],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    inFlightRef.current = false;
    setMessages([]);
    setStatus("idle");
    setError(null);
  }, []);

  return { messages, status, error, send, stop, retry, reset };
}
