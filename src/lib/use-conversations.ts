"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  newId,
  toWire,
  type AttachmentMeta,
  type ChatErrorCode,
  type ChatErrorInfo,
  type ChatMessage,
  type MessageOutcome,
  type MessageState,
  type MessageVersion,
  type StreamEvent,
  type StreamOutcome,
} from "@/lib/chat";
import { hasOversizedMessage, validateDraft, type DraftRejection } from "@/lib/limits";
import { hasPreferences, type Preferences } from "@/lib/preferences";
import { DEFAULT_PROVIDER, isProviderEnabled, type ProviderId } from "@/lib/providers";
import { deriveTitle, savedOnly } from "@/lib/conversations";
import { buildExportPayload } from "@/lib/conversation-export";
import { buildConversationsPdf, exportPdfFileName } from "@/lib/conversation-pdf";
import { buildWireAttachments } from "@/lib/attachments";
import { deleteAttachmentsBytes } from "@/lib/attachment-storage";
import {
  canAutoPersist,
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

/**
 * The exact save the hook's `flush()` performs, pulled out as a plain
 * function so it can be exercised directly in a regression test (F1)
 * without mounting a React tree. Not a parallel reimplementation --
 * `flush()` below calls this and nothing else to decide what to write.
 *
 * `blocked` must be the answer `canAutoPersist()` gave right after the
 * session's initial hydration load, held by the caller for as long as the
 * session runs (see `autoPersistBlockedRef`). When true, this makes no
 * storage call of any kind -- not even a read -- and returns the sentinel
 * `"blocked"` instead of a `StorageStatus`, so a caller can never mistake a
 * deliberately skipped save for one that ran and produced a real status.
 */
export function persistIfAllowed(
  blocked: boolean,
  conversations: readonly Conversation[],
  activeId: string | null,
): StorageStatus | "blocked" {
  if (blocked) return "blocked";
  const saved = savedOnly(conversations);
  const activeSaved = saved.some((c) => c.id === activeId) ? activeId : null;
  return saveConversations(saved, activeSaved);
}

/** How one turn's request ended, as the hook's `run()` closure observes it. */
export type RunEnding =
  | { kind: "loopEnded"; doneOutcome: StreamOutcome | null; doneReason?: string }
  | { kind: "streamError"; code: ChatErrorCode; info?: ChatErrorInfo }
  | { kind: "aborted" };

/** The settled patch (or lack of one) `run()` must apply once a turn ends. */
export type RunSettlement =
  | { kind: "complete" }
  | {
      kind: "interrupted";
      outcome: MessageOutcome;
      reason?: string;
      /**
       * Set only when `outcome` is "failed": a mid-stream error that arrived
       * after some text had already streamed in. Before F2, every mid-stream
       * error -- regardless of whether text had arrived -- surfaced the
       * top-level error banner with Retry; F2 must not regress that, only
       * fix the message being left stuck at state:"streaming". Carrying the
       * code/info here (rather than only marking the message) is what lets
       * `applySettlement()` show both: the per-message notice explaining
       * THIS answer, and the actionable banner offering Retry.
       */
      code?: ChatErrorCode;
      info?: ChatErrorInfo;
    }
  /** The loop ended (the HTTP body closed) with zero text ever received. */
  | { kind: "emptyReply" }
  /** Aborted before any text arrived -- nothing to patch; the message row
   * was never created. */
  | { kind: "noop" }
  /** A mid-stream `error` event arrived with zero text ever received. */
  | { kind: "fail"; code: ChatErrorCode; info?: ChatErrorInfo };

/**
 * Pure decision at the heart of Finding F2, pulled out of `run()` so it can
 * be exercised directly in a regression test without mounting a React tree
 * -- exactly the pattern `persistIfAllowed()` above established for F1.
 * `run()` calls this and nothing else to decide how a turn settles; it is
 * not a parallel reimplementation.
 *
 * `opened` is whether a message row was ever created for this turn (the
 * first `delta` creates it). The three `RunEnding` kinds mirror `run()`'s
 * three actual exit paths: the NDJSON read loop ending normally, a
 * mid-stream `{type:"error"}` event, and the fetch throwing `AbortError`
 * (Stop, a conversation switch, or unmount).
 *
 * The one rule every branch below exists to enforce: only a `loopEnded`
 * ending whose `doneOutcome` is the server's confirmed `"complete"` may ever
 * produce `{kind:"complete"}`. A `doneOutcome` of `null` means the read loop
 * ended (the connection closed) without this turn ever having received a
 * `done` event at all -- indistinguishable, on purpose, from the server's own
 * `"unknown"` fallback: both mean "we cannot confirm this finished
 * normally," and both settle the same way.
 */
export function settleRun(opened: boolean, ending: RunEnding): RunSettlement {
  if (ending.kind === "aborted") {
    return opened ? { kind: "interrupted", outcome: "stopped" } : { kind: "noop" };
  }
  if (ending.kind === "streamError") {
    return opened
      ? { kind: "interrupted", outcome: "failed", code: ending.code, info: ending.info }
      : { kind: "fail", code: ending.code, info: ending.info };
  }
  // loopEnded.
  if (!opened) return { kind: "emptyReply" };
  const outcome: MessageOutcome = ending.doneOutcome ?? "unknown";
  if (outcome === "complete") return { kind: "complete" };
  return {
    kind: "interrupted",
    outcome,
    reason: outcome === "truncated" ? ending.doneReason : undefined,
  };
}

/**
 * The fields of an assistant message that can change across a turn --
 * everything except its stable `id`. Used two ways in Regenerate: as the
 * snapshot `regenerate()` takes before starting (to restore on failure/
 * Stop), and as the shape each entry in `versions` carries alongside its
 * own `id`.
 */
type MessageSnapshot = {
  content: string;
  state?: MessageState;
  outcome?: MessageOutcome;
  outcomeReason?: string;
  provider?: ProviderId;
};

/**
 * What `run()` needs to behave as a regeneration instead of a normal send:
 * reuse the target message's own id (so the new answer streams live IN
 * PLACE of the old one, rather than appending a sibling) and carry enough
 * to either commit the result as a new kept version or roll back to
 * exactly what was there before, depending how the turn ends -- see
 * `applySettlement()`'s and `fail()`'s own handling below.
 */
type RegenerateContext = {
  replyId: string;
  rollback: MessageSnapshot;
  /** The versions array to build on -- the target's own existing
   * `versions`, or (the first time it is regenerated) a single entry
   * capturing what it already was. */
  priorVersions: MessageVersion[];
};

/**
 * Turns a just-settled message into one with its new content committed as
 * a version, selected. Pure and separately testable, the same shape as
 * `settleRun()` above -- `applySettlement()` calls this and nothing else
 * to decide the committed shape when regenerating.
 */
function commitAsVersion(settled: ChatMessage, regenerate: RegenerateContext): ChatMessage {
  const newVersion: MessageVersion = {
    id: newId("v"),
    content: settled.content,
    state: settled.state,
    outcome: settled.outcome,
    outcomeReason: settled.outcomeReason,
    provider: settled.provider,
  };
  return {
    ...settled,
    versions: [...regenerate.priorVersions, newVersion],
    selectedVersionId: newVersion.id,
  };
}

/**
 * What `send()` decided about a draft (Finding F3). Distinct from the
 * `DraftRejection` reasons `validateDraft()` itself can produce -- "busy",
 * "noConversation" and "providerDisabled" are guards `send()` applies before
 * it even reaches `validateDraft()`, and none of them need their own
 * composer-visible copy: the composer already disables sending while any of
 * those is true, so a caller only ever needs to react to the draft-specific
 * reasons in practice.
 */
export type SendResult =
  | { ok: true }
  | DraftRejection
  | { ok: false; reason: "busy" | "noConversation" | "providerDisabled" };

/**
 * `preferences` is read at REQUEST time via a ref (below), not captured once
 * -- a Settings change must apply to the very next request, whether that is
 * a fresh send, Retry, Regenerate, or Edit-and-resend, all four of which
 * call `run()` the same way. There is deliberately no "preferences as they
 * were when this turn was first sent" concept: every request always uses
 * whatever is currently saved.
 */
export function useConversations(preferences: Preferences) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [storageStatus, setStorageStatus] = useState<StorageStatus>("ok");

  const [status, setStatus] = useState<ChatStatus>("idle");
  const [error, setError] = useState<ChatErrorCode | null>(null);
  const [errorInfo, setErrorInfo] = useState<ChatErrorInfo | null>(null);
  /**
   * The provider the most recent (or current, in-flight) request actually
   * targeted (Finding F5). `active.providerId` is the SELECTED provider, and
   * the user is free to change it the moment a request is no longer
   * in-flight -- including right after a failure, before clicking Retry.
   * Without this, `ErrorRow`'s banner and `TypingIndicator`'s label both fell
   * back to `active.providerId` and could name a provider that did not
   * actually produce (or is not actually producing) the thing they describe.
   * Retry itself was never broken -- it already pinned to
   * `failedProviderRef.current` -- only the DISPLAY silently drifted. Null
   * only before the first request of the session; every consumer that reads
   * it only ever renders once a request has actually happened.
   */
  const [requestProviderId, setRequestProviderId] = useState<ProviderId | null>(null);

  // Every in-flight stream is tagged with both ids. A chunk that arrives after
  // an abort, or for a conversation the user has since left, is dropped rather
  // than leaking text into whatever is on screen now.
  const runRef = useRef<{ requestId: string; conversationId: string } | null>(null);
  /** Provider of the most recent turn, so Retry re-sends to the same one. */
  const failedProviderRef = useRef<ProviderId | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(false);
  /**
   * Set only while the CURRENT run is a regeneration -- what `abortActiveRun()`
   * needs to roll a Stop/conversation-switch/unmount back to the previous
   * answer instead of leaving it live-replaced with a partial one. `run()`'s
   * own catch/`applySettlement()` path (a Stop that resolves as an
   * `AbortError` INSIDE `run()`'s own try/catch) handles this on its own; this
   * ref exists because `abortActiveRun()` is a SEPARATE, external path that
   * nulls `runRef` synchronously -- before that rejection is ever observed --
   * so `run()`'s own regenerate-aware settlement code never actually runs for
   * that path (see `abortActiveRun()`'s own comment).
   */
  const regenerateRollbackRef = useRef<{ replyId: string; rollback: MessageSnapshot } | null>(null);

  // Mirrors of state for use inside callbacks and unload handlers.
  const conversationsRef = useRef<Conversation[]>([]);
  const activeIdRef = useRef<string | null>(null);
  const hydratedRef = useRef(false);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Set once, from the hydration load's own status, and never cleared again
   * for the rest of the session (F1). A `corrupt` or `unavailable` load means
   * we do not reliably know what is really in storage; every automatic save
   * -- the throttled one below, and the visibilitychange/pagehide/unmount
   * flushes -- must refuse to run for as long as that stays true, because an
   * automatic save is exactly what used to overwrite the very data a corrupt
   * or blocked read had just correctly refused to touch. There is currently
   * no UI action anywhere in this app that clears this flag: clearing it
   * would mean deliberately discarding whatever is actually in storage, and
   * nothing should do that without the user explicitly asking for it.
   */
  const autoPersistBlockedRef = useRef(false);

  conversationsRef.current = conversations;
  activeIdRef.current = activeId;
  hydratedRef.current = hydrated;
  const preferencesRef = useRef<Preferences>(preferences);
  preferencesRef.current = preferences;

  /* ---------------------------------------------------------------- hydrate */

  // Hydration read. The setState-in-effect rule is suppressed for this block
  // only: localStorage cannot be read during SSR or from a lazy initialiser
  // without a hydration mismatch, and this runs exactly once on mount.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const { state, status: loadStatus } = loadConversations();
    setStorageStatus(loadStatus);
    // Decided once, here, from the load this session actually got -- not
    // re-derived later from whatever `storageStatus` happens to display at
    // the time, which a since-succeeded save could otherwise have moved on
    // from `corrupt` to something that looks safe.
    autoPersistBlockedRef.current = !canAutoPersist(loadStatus);
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
    const result = persistIfAllowed(
      autoPersistBlockedRef.current,
      conversationsRef.current,
      activeIdRef.current,
    );
    // "blocked" means persistIfAllowed made no storage call at all -- the
    // displayed status must stay exactly what hydration reported, which is
    // already sitting in state from that first setStorageStatus call, so
    // there is nothing to update. Only a save that actually ran gets to
    // change what is shown.
    if (result !== "blocked") setStorageStatus(result);
  }, []);

  const schedulePersist = useCallback(() => {
    if (!hydratedRef.current) return;
    if (autoPersistBlockedRef.current) return;
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

  /**
   * Ends any in-flight stream. Normally marks its partial reply interrupted;
   * if the in-flight stream was a regeneration, rolls the message back to
   * what it was before instead (see `regenerateRollbackRef`'s own comment
   * for why this path, not `run()`'s own catch block, is what actually runs
   * for a Stop/conversation-switch/unmount during a regeneration).
   */
  const abortActiveRun = useCallback(() => {
    const run = runRef.current;
    const rollback = regenerateRollbackRef.current;
    abortRef.current?.abort();
    abortRef.current = null;
    inFlightRef.current = false;
    runRef.current = null;
    regenerateRollbackRef.current = null;
    if (run) {
      patch(run.conversationId, (c) => ({
        ...c,
        messages: c.messages.map((m) => {
          if (m.state !== "streaming") return m;
          if (rollback && m.id === rollback.replyId) return { ...m, ...rollback.rollback };
          return { ...m, state: "interrupted" };
        }),
      }));
    }
    setStatus("idle");
  }, [patch]);

  /* ---------------------------------------------------------------- streaming */

  const run = useCallback(
    async (
      conversationId: string,
      history: ChatMessage[],
      providerId: ProviderId,
      regenerate?: RegenerateContext,
    ) => {
      const requestId = newId("r");
      failedProviderRef.current = providerId;
      setRequestProviderId(providerId);
      const controller = new AbortController();
      abortRef.current = controller;
      runRef.current = { requestId, conversationId };
      regenerateRollbackRef.current = regenerate
        ? { replyId: regenerate.replyId, rollback: regenerate.rollback }
        : null;
      inFlightRef.current = true;
      setStatus("streaming");
      setError(null);
      setErrorInfo(null);

      // True only while this exact request still owns the stream.
      const current = () =>
        runRef.current?.requestId === requestId &&
        runRef.current?.conversationId === conversationId;

      // Regenerating reuses the TARGET message's own id, so the new answer
      // streams live in place of the old one instead of appending a
      // sibling -- see the first-delta branch below, and RegenerateContext's
      // own comment.
      const replyId = regenerate?.replyId ?? newId("a");
      let opened = false;
      // Set only by a "done" event actually being seen on the wire (F2). null
      // means the read loop ended without one -- settleRun() treats that
      // identically to the server's own "unknown" outcome: never complete.
      let doneOutcome: StreamOutcome | null = null;
      let doneReason: string | undefined;

      const fail = (code: ChatErrorCode, info?: ChatErrorInfo) => {
        if (!current()) return;
        setError(code);
        setErrorInfo(info ?? null);
        setStatus("error");
        patch(conversationId, (c) => ({
          ...c,
          // Reached with `opened` true only if some future call site stops
          // honouring the invariant that every opened+failed case routes
          // through applySettlement()'s "interrupted" branch instead of here
          // -- kept as a safety net rather than assumed away.
          //
          // Finding U2 (independent follow-up review): an earlier version of
          // this also deleted the user's own just-sent message from history
          // on a BAD_REQUEST with no text received -- meant as a defensive
          // backstop for the (now separately prevented, see `send()`/
          // `retry()`'s own history checks) case of an oversized message
          // slipping through. In practice it silently discarded the user's
          // actual question: since the composer had already cleared its own
          // input on accepting the send, deleting the message from history
          // too meant the text existed nowhere at all, and `retry()` -- which
          // resends the LAST user message in history -- would then resend
          // the previous, already-answered question instead of the one that
          // had just failed. A failed send must never delete what the user
          // asked; it is left in history exactly like any other message,
          // visible, with the error banner and Retry below it targeting it
          // correctly because it is genuinely still the last user message.
          //
          // Regenerating: nothing was ever appended (the target message
          // already existed), so there is nothing to filter out when
          // `!opened`; and when `opened`, the message was live-replaced with
          // partial new content that must be rolled back to what it was
          // before, not left half-finished or marked failed.
          messages: regenerate
            ? opened
              ? c.messages.map((m) => (m.id === replyId ? { ...m, ...regenerate.rollback } : m))
              : c.messages
            : opened
              ? c.messages.map((m) =>
                  m.id === replyId
                    ? { ...m, state: "interrupted", outcome: "failed" }
                    : m,
                )
              : c.messages.filter((m) => !(m.id === replyId && m.content === "")),
        }));
      };

      /** Turns a RunSettlement into the actual state/message mutation. */
      const applySettlement = (settlement: RunSettlement) => {
        if (!current()) return;
        switch (settlement.kind) {
          case "complete":
            patch(conversationId, (c) => ({
              ...c,
              updatedAt: Date.now(),
              messages: c.messages.map((m) => {
                if (m.id !== replyId) return m;
                const settled: ChatMessage = { ...m, state: "complete", outcome: "complete" };
                // Regenerating: a genuinely complete answer always becomes a
                // new, selected version -- never a silent overwrite of what
                // was there before.
                return regenerate ? commitAsVersion(settled, regenerate) : settled;
              }),
            }));
            setStatus("idle");
            return;
          case "interrupted": {
            // Regenerating: only a provider-reported truncation or an
            // unconfirmed ("unknown") ending are real, if imperfect, answers
            // worth keeping as a version. A user Stop or a mid-stream
            // failure roll back to the previous answer instead of leaving a
            // half-finished one in its place -- "preserve the previous
            // answer if regeneration fails" applies to a Stop during one
            // too, not only an outright error.
            const rollbackInstead =
              regenerate && settlement.outcome !== "truncated" && settlement.outcome !== "unknown";
            patch(conversationId, (c) => ({
              ...c,
              updatedAt: Date.now(),
              messages: c.messages.map((m) => {
                if (m.id !== replyId) return m;
                if (rollbackInstead) return { ...m, ...regenerate!.rollback };
                const settled: ChatMessage = {
                  ...m,
                  state: "interrupted",
                  outcome: settlement.outcome,
                  outcomeReason: settlement.reason,
                };
                return regenerate ? commitAsVersion(settled, regenerate) : settled;
              }),
            }));
            // A mid-stream error that arrived after text was already
            // delivered (outcome:"failed") still surfaces the actionable
            // error banner with Retry, exactly as it did before F2 -- the
            // per-message notice explains THIS answer; the banner is what
            // lets the user act. Every other interrupted outcome (Stop, a
            // provider-reported truncation, or an unconfirmed ending) is not
            // an error condition and settles quietly instead.
            if (settlement.code) {
              setError(settlement.code);
              setErrorInfo(settlement.info ?? null);
              setStatus("error");
            } else {
              setStatus("idle");
            }
            return;
          }
          case "emptyReply":
            fail("EMPTY_REPLY");
            return;
          case "fail":
            fail(settlement.code, settlement.info);
            return;
          case "noop":
            setStatus("idle");
            return;
        }
      };

      try {
        // Interaction refinement: attachments are resolved (read back from
        // IndexedDB, base64/text-encoded) and included ONLY for the newest
        // message in this request's own history -- never every earlier
        // attachment-bearing turn the conversation happens to carry. This
        // app already re-sends the whole text history on every turn (no
        // server-side session), so re-including EVERY past attachment on
        // EVERY later turn would grow requests unboundedly and risk
        // Vercel's fixed 4.5MB body ceiling on a long conversation. A file
        // therefore stays part of the model's context for the turn it was
        // attached to (and whatever the assistant said about it, which
        // persists as ordinary text); a much later follow-up no longer
        // re-attaches the original bytes -- a disclosed, deliberate limit,
        // not an oversight (see docs/interaction-refinement.md).
        const wireMessages = toWire(history);
        const lastMessage = history[history.length - 1];
        if (lastMessage?.attachments?.length) {
          const attachments = await buildWireAttachments(lastMessage.attachments);
          if (attachments.length > 0) {
            wireMessages[wireMessages.length - 1] = {
              ...wireMessages[wireMessages.length - 1],
              attachments,
            };
          }
        }
        if (!current()) return;

        // Personalizations: included only when something is actually saved
        // (`hasPreferences`), so a request with nothing saved is the exact
        // same body as before this field existed -- never an empty
        // `preferences: {}` sent unconditionally.
        const currentPreferences = preferencesRef.current;
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: providerId,
            messages: wireMessages,
            ...(hasPreferences(currentPreferences) ? { preferences: currentPreferences } : {}),
          }),
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
                  // Regenerating: the target message already exists --
                  // live-replace its content/state in place (clearing any
                  // outcome from what it was before) rather than appending a
                  // sibling, so the new answer streams visibly where the old
                  // one was. A normal send has no existing message with this
                  // id yet, so it appends one, as always.
                  messages: regenerate
                    ? c.messages.map((m) =>
                        m.id === replyId
                          ? {
                              ...m,
                              content: event.text,
                              state: "streaming",
                              outcome: undefined,
                              outcomeReason: undefined,
                              provider: providerId,
                            }
                          : m,
                      )
                    : [
                        ...c.messages,
                        {
                          id: replyId,
                          role: "assistant",
                          content: event.text,
                          state: "streaming",
                          // Stamped at creation so the answer keeps this identity
                          // even if the conversation is switched afterwards.
                          provider: providerId,
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
              // F2: an explicit mid-stream failure. settleRun() decides
              // whether that means "mark the partial answer interrupted" (if
              // any text had already arrived) or "there is nothing to keep,
              // report the failure outright" (if not) -- never silently left
              // stuck at state:"streaming" either way.
              applySettlement(
                settleRun(opened, {
                  kind: "streamError",
                  code: event.code,
                  info: event.info,
                }),
              );
              return;
            } else if (event.type === "done") {
              // Captured, not applied yet: more lines could in principle
              // follow in the same chunk, and the loop's own natural end
              // (the read below returning done:true) is what actually
              // settles the turn, via the same settleRun() call every other
              // exit path uses.
              doneOutcome = event.outcome;
              doneReason = event.reason;
            }
          }
        }

        if (!current()) return;
        // F2: the read loop ended (the HTTP body closed) without throwing.
        // Only ever settles "complete" when a "done" event actually reported
        // outcome:"complete" -- a missing done event (doneOutcome stays
        // null here) settles exactly like the server's own "unknown"
        // fallback, never as success.
        applySettlement(
          settleRun(opened, { kind: "loopEnded", doneOutcome, doneReason }),
        );
      } catch (err) {
        if ((err as Error)?.name === "AbortError") {
          // Stop, a conversation switch, or unmount: keep whatever streamed
          // and mark it interrupted with an accurate "the user stopped this"
          // outcome, distinct from a failure or a provider-reported cutoff.
          applySettlement(settleRun(opened, { kind: "aborted" }));
          return;
        }
        fail("NETWORK");
      } finally {
        if (runRef.current?.requestId === requestId) {
          runRef.current = null;
          abortRef.current = null;
          inFlightRef.current = false;
          regenerateRollbackRef.current = null;
        }
        flush();
      }
    },
    [patch, schedulePersist, flush],
  );

  /* ------------------------------------------------------------------ actions */

  const send = useCallback(
    (text: string, attachments?: AttachmentMeta[]): SendResult => {
      if (inFlightRef.current) return { ok: false, reason: "busy" };

      const conv = conversationsRef.current.find(
        (c) => c.id === activeIdRef.current,
      );
      if (!conv) return { ok: false, reason: "noConversation" };
      if (!isProviderEnabled(conv.providerId)) {
        return { ok: false, reason: "providerDisabled" };
      }

      // F3/U1: shared with the server's own limits (src/lib/limits.ts) and
      // with MessageComposer's own pre-check. Refused here too, defensively
      // -- and this is the one check that actually matters for a non-UI
      // caller -- BEFORE the draft ever becomes a ChatMessage or touches
      // history. Passing the real message array (not just its length) is
      // what lets this also catch an oversized message already sitting in
      // history (Finding U1) and refuse to send further at all, rather than
      // silently shortening it on the wire the way an earlier fix used to.
      const validation = validateDraft(text, conv.messages);
      if (!validation.ok) return validation;

      const content = text.trim();
      const userMessage: ChatMessage = {
        id: newId("u"),
        role: "user",
        content,
        state: "complete",
        // Interaction refinement: metadata only -- the raw bytes are
        // already in IndexedDB by the time this runs (staged, in the
        // composer, before Send was even clickable; see
        // `@/lib/attachments.ts`'s `stageAttachment`), keyed by each
        // entry's own `id`.
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
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
      return { ok: true };
    },
    [patch, run],
  );

  /**
   * Edits the conversation's LATEST user question in place and resends it.
   * A near-literal sibling of `send()` above -- same validation, same
   * streaming/error/provider-switch behavior, reused directly rather than
   * reimplemented -- that starts from history truncated to BEFORE the
   * edited message instead of the full history, so the old answer (and the
   * old question) never coexist with the new ones. Only offered on the
   * latest user turn (the UI never calls this otherwise); the extra check
   * here is defensive, not the actual gate.
   */
  const editAndResend = useCallback(
    (messageId: string, newText: string): SendResult => {
      if (inFlightRef.current) return { ok: false, reason: "busy" };
      const conv = conversationsRef.current.find((c) => c.id === activeIdRef.current);
      if (!conv) return { ok: false, reason: "noConversation" };
      const idx = conv.messages.findIndex((m) => m.id === messageId);
      const isLatestUserTurn =
        idx !== -1 &&
        conv.messages[idx].role === "user" &&
        (idx === conv.messages.length - 1 || idx === conv.messages.length - 2);
      if (!isLatestUserTurn) return { ok: false, reason: "noConversation" };
      if (!isProviderEnabled(conv.providerId)) {
        return { ok: false, reason: "providerDisabled" };
      }

      const historyBefore = conv.messages.slice(0, idx);
      // Validated against the history BEFORE the edited message, exactly
      // like a fresh send -- and nothing is mutated until this passes, so
      // an invalid edit leaves the original turn (and its old reply, if
      // any) completely untouched.
      const validation = validateDraft(newText, historyBefore);
      if (!validation.ok) return validation;

      const content = newText.trim();
      const editedMessage: ChatMessage = {
        id: newId("u"),
        role: "user",
        content,
        state: "complete",
      };
      // Drops the old question AND whatever answered it -- the whole point
      // of resending is that the old answer no longer applies.
      const history = [...historyBefore, editedMessage];
      const isFirst = historyBefore.length === 0;

      patch(conv.id, (c) => ({
        ...c,
        title: isFirst ? deriveTitle(content) : c.title,
        updatedAt: Date.now(),
        messages: history,
      }));

      // The currently-selected provider, exactly like a fresh send -- not
      // pinned to whatever answered the original question, since editing
      // and resending is "send a new message," not "regenerate."
      void run(conv.id, history, conv.providerId);
      return { ok: true };
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
    // U1: the same dead end send() already refuses to enter -- if this
    // conversation carries a message over the per-message limit, it cannot
    // be sent further at all (see validateDraft()), and Retry must not
    // attempt it either. The composer's own persistent notice already
    // explains why and offers a new conversation; this is a silent no-op
    // here, consistent with the other early returns above.
    if (hasOversizedMessage(upto)) return;
    patch(conv.id, (c) => ({ ...c, messages: upto }));
    setError(null);
    setErrorInfo(null);
    // Retry the turn with the provider it was actually sent to, not whatever
    // is selected now. Re-running a failed turn somewhere else would change
    // which model answered without the user asking for that.
    void run(conv.id, upto, failedProviderRef.current ?? conv.providerId);
  }, [patch, run]);

  /**
   * Generates a fresh alternate for the conversation's LATEST assistant
   * answer, keeping the previous one as a selectable version rather than
   * discarding it. Only ever offered on the latest message -- see
   * `selectMessageVersion()`'s own comment for why switching versions is
   * restricted the same way, and why that restriction is deliberate rather
   * than a missing feature.
   */
  const regenerate = useCallback(
    (messageId: string) => {
      if (inFlightRef.current) return;
      const conv = conversationsRef.current.find((c) => c.id === activeIdRef.current);
      if (!conv) return;
      const idx = conv.messages.findIndex((m) => m.id === messageId);
      if (idx === -1 || idx !== conv.messages.length - 1) return;
      const target = conv.messages[idx];
      if (target.role !== "assistant" || target.state === "streaming") return;

      const lastUserIndex = conv.messages
        .slice(0, idx)
        .map((m) => m.role)
        .lastIndexOf("user");
      if (lastUserIndex < 0) return;
      // Excludes the answer being regenerated -- exactly the same slice
      // shape retry() uses, just stopping one message earlier (before the
      // existing answer, not after removing a failed one).
      const upto = conv.messages.slice(0, lastUserIndex + 1);
      if (hasOversizedMessage(upto)) return;

      const rollback: MessageSnapshot = {
        content: target.content,
        state: target.state,
        outcome: target.outcome,
        outcomeReason: target.outcomeReason,
        provider: target.provider,
      };
      const priorVersions: MessageVersion[] =
        target.versions ?? [{ id: newId("v"), ...rollback }];

      setError(null);
      setErrorInfo(null);
      // The provider that produced THIS answer, never silently the
      // currently-selected one -- the one explicit way Regenerate differs
      // from an ordinary send.
      void run(conv.id, upto, target.provider ?? conv.providerId, {
        replyId: target.id,
        rollback,
        priorVersions,
      });
    },
    [run],
  );

  /**
   * Switches which regenerated alternate is "the" answer -- purely local,
   * never a request, since every version's text already exists. Only the
   * conversation's LATEST message may change version: an earlier one may
   * already have later turns built on whichever version was selected when
   * they were sent, and switching it out from under them would silently
   * change what the conversation "actually" contains without a real
   * branching model to represent both histories -- deliberately not
   * implemented here, so this is disabled instead, per the task's own
   * explicit fallback for exactly this case.
   */
  const selectMessageVersion = useCallback(
    (conversationId: string, messageId: string, versionId: string) => {
      patch(conversationId, (c) => {
        const idx = c.messages.findIndex((m) => m.id === messageId);
        if (idx === -1 || idx !== c.messages.length - 1) return c;
        const target = c.messages[idx];
        const version = target.versions?.find((v) => v.id === versionId);
        if (!version) return c;
        return {
          ...c,
          messages: c.messages.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  content: version.content,
                  state: version.state,
                  outcome: version.outcome,
                  outcomeReason: version.outcomeReason,
                  provider: version.provider,
                  selectedVersionId: version.id,
                }
              : m,
          ),
        };
      });
    },
    [patch],
  );

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
      // Interaction refinement: attachment bytes live in IndexedDB, keyed
      // by attachment id, entirely separate from the conversation this
      // patch removes from localStorage -- deleting the conversation alone
      // would otherwise leave them orphaned there indefinitely.
      const deleted = conversationsRef.current.find((c) => c.id === id);
      const attachmentIds = deleted?.messages.flatMap((m) => m.attachments?.map((a) => a.id) ?? []) ?? [];
      if (attachmentIds.length > 0) void deleteAttachmentsBytes(attachmentIds);
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

  /**
   * Drops one dead attachment reference from an already-sent message
   * (Interaction refinement). Used only when that attachment's bytes are
   * confirmed missing from IndexedDB (storage pressure, selective
   * clearing) -- there is no "reattach" counterpart here, deliberately:
   * the message was already sent, so there is no draft to add a file back
   * into, and silently re-sending a *different* file under the old
   * attachment's identity would misrepresent what the model actually saw.
   * Removing the dead reference is the one honest action left.
   */
  const removeAttachment = useCallback(
    (conversationId: string, messageId: string, attachmentId: string) => {
      void deleteAttachmentsBytes([attachmentId]);
      patch(conversationId, (c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === messageId && m.attachments
            ? { ...m, attachments: m.attachments.filter((a) => a.id !== attachmentId) }
            : m,
        ),
      }));
    },
    [patch],
  );

  /**
   * Settings > Conversations > Export. Downloads just the SELECTED saved
   * (non-draft) conversations -- `conversationIds` lets the user narrow
   * this down instead of always exporting everything -- as one readable
   * PDF: each question and its answer, nothing else. Rendered client-side
   * (`conversation-pdf.ts`, via the browser's own text layout so Arabic and
   * other non-Latin text renders correctly, not jsPDF's built-in
   * Latin-only fonts). No import path exists for this file; it is a
   * readable record, not a restorable backup.
   */
  const exportConversations = useCallback(async (conversationIds: readonly string[]) => {
    const idSet = new Set(conversationIds);
    const selected = savedOnly(conversationsRef.current).filter((c) => idSet.has(c.id));
    const payload = buildExportPayload(selected);
    const doc = await buildConversationsPdf(payload);
    doc.save(exportPdfFileName());
  }, []);

  /**
   * Settings > Conversations > Delete all conversations. The UI is
   * responsible for the explicit confirmation (Settings itself never
   * calls this without one); this action IS the confirmed delete.
   *
   * Stops any in-flight request first, deletes every conversation's
   * attachment bytes from IndexedDB (never left orphaned), and replaces
   * the whole list with one fresh empty draft -- the welcome state.
   * Switching `activeId` to that new draft remounts `MessageList` (it is
   * keyed by conversation id in `WorkspaceLayout.tsx`), which is also what
   * stops any in-progress reveal pacing and cancels any active Read Aloud
   * speech: both live in that component's own state/effects, torn down by
   * the same remount rather than needing a separate signal from here.
   * Appearance and Personalization preferences are untouched -- neither is
   * conversation state, and neither is read or written by this function.
   */
  const deleteAllConversations = useCallback(() => {
    abortActiveRun();
    const attachmentIds = conversationsRef.current.flatMap(
      (c) => c.messages.flatMap((m) => m.attachments?.map((a) => a.id) ?? []),
    );
    if (attachmentIds.length > 0) void deleteAttachmentsBytes(attachmentIds);
    const draft = emptyConversation(DEFAULT_PROVIDER);
    setConversations([draft]);
    setActiveId(draft.id);
    setError(null);
    setErrorInfo(null);
  }, [abortActiveRun]);

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
    // F5: the provider the most recent/in-flight request actually targeted,
    // for ErrorRow/TypingIndicator -- never the currently-selected provider,
    // which the user may have since changed.
    requestProviderId,
    streamingConversationId: runRef.current?.conversationId ?? null,
    // actions
    send,
    stop,
    retry,
    regenerate,
    selectMessageVersion,
    editAndResend,
    selectConversation,
    newConversation,
    renameConversation,
    deleteConversation,
    setConversationProvider,
    removeAttachment,
    exportConversations,
    deleteAllConversations,
  };
}
