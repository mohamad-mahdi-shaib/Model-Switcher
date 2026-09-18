"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  newId,
  toWire,
  type ChatErrorCode,
  type ChatErrorInfo,
  type ChatMessage,
  type StreamEvent,
} from "@/lib/chat";
import { DEFAULT_PROVIDER, isProviderEnabled, type ProviderId } from "@/lib/providers";
import { deriveTitle, savedOnly } from "@/lib/conversations";
import {
  loadConversations,
  saveConversations,
  type Conversation,
  type StorageStatus,
} from "@/lib/storage";

export type ChatStatus = "idle" | "streaming" | "error";

/** How often partial replies may hit localStorage while tokens stream. */
const PERSIST_THROTTLE_MS = 700;

function emptyConversation(providerId: ProviderId): Conversation {
  const now = Date.now();
  return {
    id: newId("c"),
    title: "New conversation",
    providerId,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [storageStatus, setStorageStatus] = useState<StorageStatus>("ok");

  const [status, setStatus] = useState<ChatStatus>("idle");
  const [error, setError] = useState<ChatErrorCode | null>(null);
  const [errorInfo, setErrorInfo] = useState<ChatErrorInfo | null>(null);

  // Every in-flight stream is tagged with both ids. A chunk that arrives after
  // an abort, or for a conversation the user has since left, is dropped rather
  // than leaking text into whatever is on screen now.
  const runRef = useRef<{ requestId: string; conversationId: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(false);

  // Mirrors of state for use inside callbacks and unload handlers.
  const conversationsRef = useRef<Conversation[]>([]);
  const activeIdRef = useRef<string | null>(null);
  const hydratedRef = useRef(false);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  conversationsRef.current = conversations;
  activeIdRef.current = activeId;
  hydratedRef.current = hydrated;

  /* ---------------------------------------------------------------- hydrate */

  // Hydration read. The setState-in-effect rule is suppressed for this block
  // only: localStorage cannot be read during SSR or from a lazy initialiser
  // without a hydration mismatch, and this runs exactly once on mount.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const { state, status: loadStatus } = loadConversations();
    setStorageStatus(loadStatus);
    if (state && state.conversations.length > 0) {
      setConversations(state.conversations);
      setActiveId(state.activeId ?? state.conversations[0].id);
    } else {
      const draft = emptyConversation(DEFAULT_PROVIDER);
      setConversations([draft]);
      setActiveId(draft.id);
    }
    setHydrated(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  /* ------------------------------------------------------------- persistence */

  const flush = useCallback(() => {
    // Never write before hydration: doing so would stamp the initial empty
    // React state over real saved conversations.
    if (!hydratedRef.current) return;
    if (persistTimer.current) {
      clearTimeout(persistTimer.current);
      persistTimer.current = null;
    }
    const saved = savedOnly(conversationsRef.current);
    const active = activeIdRef.current;
    const activeSaved = saved.some((c) => c.id === active) ? active : null;
    const result = saveConversations(saved, activeSaved);
    setStorageStatus((prev) => (prev === "corrupt" ? prev : result));
  }, []);

  const schedulePersist = useCallback(() => {
    if (!hydratedRef.current) return;
    if (persistTimer.current) return; // already queued within this window
    persistTimer.current = setTimeout(() => {
      persistTimer.current = null;
      flush();
    }, PERSIST_THROTTLE_MS);
  }, [flush]);

  // Persist on any settled change, and on page lifecycle events.
  useEffect(() => {
    if (!hydrated) return;
    schedulePersist();
  }, [conversations, activeId, hydrated, schedulePersist]);

  useEffect(() => {
    const onHide = () => flush();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
      flush();
    };
  }, [flush]);

  /* ------------------------------------------------------------------ helpers */

  const patch = useCallback(
    (id: string, fn: (c: Conversation) => Conversation) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? fn(c) : c)),
      );
    },
    [],
  );

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );

  /** Ends any in-flight stream, marking its partial reply as interrupted. */
  const abortActiveRun = useCallback(() => {
    const run = runRef.current;
    abortRef.current?.abort();
    abortRef.current = null;
    inFlightRef.current = false;
    runRef.current = null;
    if (run) {
      patch(run.conversationId, (c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.state === "streaming" ? { ...m, state: "interrupted" } : m,
        ),
      }));
    }
    setStatus("idle");
  }, [patch]);

  /* ---------------------------------------------------------------- streaming */

  const run = useCallback(
    async (conversationId: string, history: ChatMessage[], providerId: ProviderId) => {
      const requestId = newId("r");
      const controller = new AbortController();
      abortRef.current = controller;
      runRef.current = { requestId, conversationId };
      inFlightRef.current = true;
      setStatus("streaming");
      setError(null);
      setErrorInfo(null);

      // True only while this exact request still owns the stream.
      const current = () =>
        runRef.current?.requestId === requestId &&
        runRef.current?.conversationId === conversationId;

      const replyId = newId("a");
      let opened = false;

      const fail = (code: ChatErrorCode, info?: ChatErrorInfo) => {
        if (!current()) return;
        setError(code);
        setErrorInfo(info ?? null);
        setStatus("error");
        patch(conversationId, (c) => ({
          ...c,
          messages: c.messages.filter(
            (m) => !(m.id === replyId && m.content === ""),
          ),
        }));
      };

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: providerId, messages: toWire(history) }),
          signal: controller.signal,
        });

        if (!current()) return;
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          fail(
            (payload?.code as ChatErrorCode) ?? "UPSTREAM",
            payload?.info as ChatErrorInfo | undefined,
          );
          return;
        }
        if (!response.body) {
          fail("NETWORK");
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          // Late chunk after abort or conversation change: drop it.
          if (!current()) return;

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
                patch(conversationId, (c) => ({
                  ...c,
                  updatedAt: Date.now(),
                  messages: [
                    ...c.messages,
                    {
                      id: replyId,
                      role: "assistant",
                      content: event.text,
                      state: "streaming",
                    },
                  ],
                }));
              } else {
                patch(conversationId, (c) => ({
                  ...c,
                  updatedAt: Date.now(),
                  messages: c.messages.map((m) =>
                    m.id === replyId
                      ? { ...m, content: m.content + event.text }
                      : m,
                  ),
                }));
              }
              schedulePersist();
            } else if (event.type === "error") {
              fail(event.code, event.info);
              return;
            }
          }
        }

        if (!current()) return;
        if (!opened) {
          fail("EMPTY_REPLY");
          return;
        }
        patch(conversationId, (c) => ({
          ...c,
          updatedAt: Date.now(),
          messages: c.messages.map((m) =>
            m.id === replyId ? { ...m, state: "complete" } : m,
          ),
        }));
        setStatus("idle");
      } catch (err) {
        if ((err as Error)?.name === "AbortError") {
          // Stop or a switch: keep whatever streamed, mark it interrupted.
          patch(conversationId, (c) => ({
            ...c,
            messages: c.messages.map((m) =>
              m.id === replyId ? { ...m, state: "interrupted" } : m,
            ),
          }));
          if (current()) setStatus("idle");
          return;
        }
        fail("NETWORK");
      } finally {
        if (runRef.current?.requestId === requestId) {
          runRef.current = null;
          abortRef.current = null;
          inFlightRef.current = false;
        }
        flush();
      }
    },
    [patch, schedulePersist, flush],
  );

  /* ------------------------------------------------------------------ actions */

  const send = useCallback(
    (text: string) => {
      const content = text.trim();
      if (!content) return false;
      if (inFlightRef.current) return false;

      const conv = conversationsRef.current.find(
        (c) => c.id === activeIdRef.current,
      );
      if (!conv) return false;
      if (!isProviderEnabled(conv.providerId)) return false;

      const userMessage: ChatMessage = {
        id: newId("u"),
        role: "user",
        content,
        state: "complete",
      };
      const history = [...conv.messages, userMessage];
      const isFirst = conv.messages.length === 0;

      patch(conv.id, (c) => ({
        ...c,
        // The first user message names the conversation, locally.
        title: isFirst ? deriveTitle(content) : c.title,
        updatedAt: Date.now(),
        messages: history,
      }));

      void run(conv.id, history, conv.providerId);
      return true;
    },
    [patch, run],
  );

  const stop = useCallback(() => {
    abortActiveRun();
    flush();
  }, [abortActiveRun, flush]);

  /** Re-runs the last user turn of the ACTIVE conversation only. */
  const retry = useCallback(() => {
    if (inFlightRef.current) return;
    const conv = conversationsRef.current.find(
      (c) => c.id === activeIdRef.current,
    );
    if (!conv) return;
    const lastUserIndex = conv.messages.map((m) => m.role).lastIndexOf("user");
    if (lastUserIndex < 0) return;

    const upto = conv.messages.slice(0, lastUserIndex + 1);
    patch(conv.id, (c) => ({ ...c, messages: upto }));
    setError(null);
    setErrorInfo(null);
    void run(conv.id, upto, conv.providerId);
  }, [patch, run]);

  const selectConversation = useCallback(
    (id: string) => {
      if (id === activeIdRef.current) return;
      abortActiveRun();
      setActiveId(id);
      setError(null);
      setErrorInfo(null);
      flush();
    },
    [abortActiveRun, flush],
  );

  const newConversation = useCallback(() => {
    const list = conversationsRef.current;
    // Repeated clicks must not pile up identical empty drafts.
    const existingDraft = list.find((c) => c.messages.length === 0);
    if (existingDraft) {
      if (existingDraft.id !== activeIdRef.current) {
        abortActiveRun();
        setActiveId(existingDraft.id);
        setError(null);
        setErrorInfo(null);
      }
      return;
    }
    abortActiveRun();
    const activeProvider =
      list.find((c) => c.id === activeIdRef.current)?.providerId ??
      DEFAULT_PROVIDER;
    const draft = emptyConversation(
      isProviderEnabled(activeProvider) ? activeProvider : DEFAULT_PROVIDER,
    );
    setConversations((prev) => [draft, ...prev]);
    setActiveId(draft.id);
    setError(null);
    setErrorInfo(null);
  }, [abortActiveRun]);

  const renameConversation = useCallback(
    (id: string, title: string) => {
      const clean = title.replace(/\s+/g, " ").trim().slice(0, 80);
      if (!clean) return;
      patch(id, (c) => ({ ...c, title: clean }));
    },
    [patch],
  );

  const deleteConversation = useCallback(
    (id: string) => {
      if (runRef.current?.conversationId === id) abortActiveRun();
      setConversations((prev) => {
        const next = prev.filter((c) => c.id !== id);
        if (activeIdRef.current === id) {
          // Move somewhere safe rather than leaving nothing selected.
          const fallback = next[0] ?? emptyConversation(DEFAULT_PROVIDER);
          if (!next.includes(fallback)) next.unshift(fallback);
          setActiveId(fallback.id);
          setError(null);
          setErrorInfo(null);
        }
        if (next.length === 0) {
          const draft = emptyConversation(DEFAULT_PROVIDER);
          setActiveId(draft.id);
          return [draft];
        }
        return next;
      });
    },
    [abortActiveRun],
  );

  const setConversationProvider = useCallback(
    (id: string, providerId: ProviderId) => {
      patch(id, (c) => ({ ...c, providerId }));
    },
    [patch],
  );

  return {
    // data
    conversations,
    saved: savedOnly(conversations),
    active,
    activeId,
    hydrated,
    storageStatus,
    // chat state
    messages: active?.messages ?? [],
    status,
    error,
    errorInfo,
    streamingConversationId: runRef.current?.conversationId ?? null,
    // actions
    send,
    stop,
    retry,
    selectConversation,
    newConversation,
    renameConversation,
    deleteConversation,
    setConversationProvider,
  };
}
