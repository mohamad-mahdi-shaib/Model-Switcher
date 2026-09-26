"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChatHeader } from "@/components/workspace/ChatHeader";
import { ConversationSidebar } from "@/components/workspace/ConversationSidebar";
import {
  MessageComposer,
  type ComposerHandle,
} from "@/components/workspace/MessageComposer";
import { MessageList } from "@/components/workspace/MessageList";
import { SettingsOverlay } from "@/components/workspace/SettingsPanel";
import {
  AMBIENT_ORBS,
  backgroundTone,
  DEFAULT_BACKGROUND,
  DEFAULT_GLASS,
  type BackgroundId,
  type GlassStyleId,
} from "@/lib/backgrounds";
import { defaultAppSettings, loadAppSettings, saveAppSettings } from "@/lib/app-settings-storage";
import { providerKeyName } from "@/lib/chat";
import { hasOversizedMessage, MAX_MESSAGES } from "@/lib/limits";
import type { Preferences } from "@/lib/preferences";
import {
  DEFAULT_PROVIDER,
  isProviderUsable,
  type AvailabilityMap,
} from "@/lib/providers";
import type { TextSizeId } from "@/lib/text-size";
import { useEdgeGlint } from "@/lib/use-edge-glint";
import { useConversations } from "@/lib/use-conversations";
import { useMediaQuery } from "@/lib/use-media-query";
import { useVoiceOptions } from "@/lib/use-speech";

/**
 * Every overlay this workspace can show -- the composer's provider menu,
 * Settings, and (below `lg`) the sidebar's own closed-by-default drawer --
 * shares this one value rather than three independent booleans,
 * specifically so opening any one of them always closes whichever other
 * one was open. This is also what satisfies "close the sidebar drawer
 * before opening Settings, avoiding overlapping modal layers" structurally:
 * switching this single slot from "sidebar" to "settings" can never leave
 * both mounted at once.
 *
 * Settings itself is now rendered ONCE, here, as `SettingsOverlay` --
 * decoupled from the sidebar/drawer's own mount lifecycle (see
 * `SettingsPanel.tsx`'s own comment for the real bug this fixes: the
 * previous two Settings surfaces were nested inside the sidebar's own
 * `SidebarBody`, so closing the drawer to open Settings could leave
 * NEITHER visible).
 */
type ActiveOverlay = "provider" | "settings" | "sidebar" | null;

export function WorkspaceLayout() {
  const [background, setBackground] = useState<BackgroundId>(DEFAULT_BACKGROUND);
  const [glass, setGlass] = useState<GlassStyleId>(DEFAULT_GLASS);
  const [textSize, setTextSize] = useState<TextSizeId>(defaultAppSettings(DEFAULT_BACKGROUND, DEFAULT_GLASS).textSize);
  const [preferences, setPreferences] = useState<Preferences>(
    defaultAppSettings(DEFAULT_BACKGROUND, DEFAULT_GLASS).preferences,
  );
  const [speechVoiceId, setSpeechVoiceId] = useState(
    defaultAppSettings(DEFAULT_BACKGROUND, DEFAULT_GLASS).speechVoiceId,
  );
  const [speechRate, setSpeechRate] = useState(defaultAppSettings(DEFAULT_BACKGROUND, DEFAULT_GLASS).speechRate);
  const [speechVoiceGender, setSpeechVoiceGender] = useState(
    defaultAppSettings(DEFAULT_BACKGROUND, DEFAULT_GLASS).speechVoiceGender,
  );
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  const [activeOverlay, setActiveOverlay] = useState<ActiveOverlay>(null);
  const [availability, setAvailability] = useState<AvailabilityMap | null>(null);
  const composerRef = useRef<ComposerHandle>(null);
  // Interaction refinement: local sidebar search. Lifted here, like every
  // other piece of sidebar state, so there is one query regardless of
  // which shell (full sidebar or drawer) is currently rendering it.
  const [searchQuery, setSearchQuery] = useState("");
  // Set by a search-result click, consumed (and reset to null) by
  // MessageList once it has scrolled to and flashed the target message --
  // reset back to null rather than left set, so clicking the SAME result
  // again still re-triggers the effect (a value that does not change would
  // not re-fire a `useEffect` watching it).
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);
  // Finding U5 (independent follow-up review): the switch-confirmation
  // dialog's modal backdrop needs a portal target with no backdrop-filter/
  // transform ancestor of its own, or `position:fixed` on the backdrop is
  // contained by whichever glass panel it happens to render inside instead
  // of covering the real viewport -- see ChatHeader.tsx's SwitchDialog.
  // `<main>` is the lowest common ancestor of the sidebar and the chat
  // panel (both of which independently set `backdrop-filter`) and has no
  // such property itself. State, set via a ref callback, rather than a raw
  // ref read during render (React's own rule against reading `.current`
  // outside an effect/handler -- a value genuinely needed for what THIS
  // component renders belongs in state, not a ref).
  const [mainEl, setMainEl] = useState<HTMLElement | null>(null);
  // Interaction refinement: the desktop sidebar's own open/collapsed state,
  // independent of the drawer's `activeOverlay==="sidebar"` (which only
  // ever applies below `isCompactSidebar`). Plain `useState(false)`, not
  // derived from a media query, so there is no hydration-mismatch risk --
  // its default agrees with the server render, and it only ever changes
  // from a later user click on the header's toggle.
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false);

  // Settings pass: Appearance/Personalizations/Read-aloud preferences are
  // read from localStorage exactly once, after mount -- never during the
  // initial render, which runs identically on the server and would
  // otherwise mismatch the instant a real saved (non-default) value
  // exists. Same justified exception as `use-conversations.ts`'s own
  // hydration read: a brief flash of defaults, then the real saved values
  // apply, is the accepted tradeoff, not a bug.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const loaded = loadAppSettings(DEFAULT_BACKGROUND, DEFAULT_GLASS);
    setBackground(loaded.background);
    setGlass(loaded.glass);
    setTextSize(loaded.textSize);
    setPreferences(loaded.preferences);
    setSpeechVoiceId(loaded.speechVoiceId);
    setSpeechRate(loaded.speechRate);
    setSpeechVoiceGender(loaded.speechVoiceGender);
    setSettingsHydrated(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Persisted on every subsequent change -- but never before the read
  // above has actually run, or this would overwrite a real saved value
  // with the defaults every render starts from.
  useEffect(() => {
    if (!settingsHydrated) return;
    saveAppSettings({ background, glass, textSize, preferences, speechVoiceId, speechRate, speechVoiceGender });
  }, [settingsHydrated, background, glass, textSize, preferences, speechVoiceId, speechRate, speechVoiceGender]);

  const { supported: speechSupported, voices: speechVoices } = useVoiceOptions();

  // Interaction refinement: the sidebar is closed-by-default below `lg`
  // (1024px -- mobile AND narrow tablet) again, reverting the previous
  // pass's always-visible compact rail. If the viewport grows past that
  // threshold while the drawer happens to still be open (e.g. a phone
  // rotated to a wide split-screen, or a live resize during a test), the
  // full sidebar is now on screen doing the same job, so the drawer stops
  // counting as open -- avoiding two redundant "Conversations" surfaces (and
  // their two Settings triggers) ever being visible at once. Derived at
  // render time rather than synced back into state via an effect, per this
  // project's own `react-hooks/set-state-in-effect` rule: `activeOverlay`
  // itself is untouched, so the drawer reopens normally the next time the
  // viewport narrows again.
  const isCompactSidebar = useMediaQuery("(max-width: 1023px)");
  const overlay: ActiveOverlay =
    !isCompactSidebar && activeOverlay === "sidebar" ? null : activeOverlay;

  // One toggle button (ChatHeader) serves both roles: below `lg` it opens/
  // closes the portaled drawer; at `>=lg` it collapses/expands the inline
  // sidebar. `sidebarVisible` drives the button's own label/aria-expanded
  // state so it always describes what it currently controls.
  const sidebarVisible = isCompactSidebar ? overlay === "sidebar" : !desktopSidebarCollapsed;
  const toggleSidebar = () => {
    if (isCompactSidebar) {
      setActiveOverlay((prev) => (prev === "sidebar" ? null : "sidebar"));
    } else {
      setDesktopSidebarCollapsed((prev) => !prev);
    }
  };

  const {
    saved,
    active,
    activeId,
    hydrated,
    storageStatus,
    messages,
    status,
    error,
    errorInfo,
    requestProviderId,
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
  } = useConversations(preferences);

  // Interaction refinement: selecting a search result switches to its
  // conversation (reusing the existing action -- no parallel selection
  // path), queues the target message to be scrolled to and briefly
  // highlighted, and reverts the sidebar to its normal list view.
  const selectSearchResult = (conversationId: string, messageId: string | null) => {
    selectConversation(conversationId);
    setSearchQuery("");
    if (messageId) setHighlightMessageId(messageId);
  };

  /**
   * Stable identity, not an inline arrow at the `MessageList` call site
   * below: `MessageList`'s own highlight effect calls this synchronously
   * from inside itself and has it in its effect dependency array. An
   * inline closure here is a NEW function every render, which retriggers
   * that effect the instant this callback runs -- its cleanup then clears
   * the flash's own 2s timer before it ever fires, and the re-entered
   * effect bails out immediately (`highlightMessageId` is already null by
   * then), so `flashedId` was never reset and the flash never expired.
   * `useCallback` with an empty dependency array (this only ever calls
   * `setHighlightMessageId`, whose own identity React guarantees stable)
   * is what breaks that loop.
   */
  const handleHighlightHandled = useCallback(() => setHighlightMessageId(null), []);

  const isUltra = glass === "ultra";
  const { hostRef, glintRef } = useEdgeGlint<HTMLElement>(isUltra);

  // Ask the server which providers are actually configured. Only booleans and
  // model names come back — never a key.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/chat")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setAvailability((data?.providers as AvailabilityMap) ?? {});
      })
      .catch(() => {
        if (!cancelled) setAvailability({});
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const provider = active?.providerId ?? DEFAULT_PROVIDER;
  // Readiness follows the *active* provider rather than a hardcoded one. With
  // two providers, gating the composer on Gemini would lock out a perfectly
  // working GPT conversation whenever Gemini's own key happened to be missing.
  const providerReady = availability === null || isProviderUsable(provider, availability);
  const notConfigured = availability !== null && !providerReady;
  const title = active?.title ?? "New conversation";
  // F3: the conversation cap, checked here rather than duplicated per
  // consumer -- both MessageComposer's disabled/notice state and its own
  // internal validateDraft() call (inside send()) must agree with this exact
  // number.
  const conversationFull = (active?.messages.length ?? 0) >= MAX_MESSAGES;
  // U1: same idea, for the other reason a conversation can become permanently
  // unsendable -- a message already in it (never a fresh draft, which
  // validateDraft() itself refuses) is over the per-message limit.
  const hasOversizedHistoryMessage = hasOversizedMessage(active?.messages ?? []);

  return (
    <div
      // Responsive UI refinement: tighter edge margin below `sm` so the
      // approved panel keeps as much of a 360px-wide viewport as possible
      // rather than losing a fixed 32px to padding regardless of screen
      // size; `lg:p-6` upward is exactly the desktop value this already had.
      // The four `env(safe-area-inset-*)` overrides keep the panel clear of
      // a device notch or home indicator in either orientation (needs
      // `viewport-fit: cover` in layout.tsx's own viewport export, or these
      // resolve to 0 and this is a no-op on top of the plain padding above).
      className="workspace-root relative flex h-dvh w-full items-center justify-center overflow-hidden p-2 pt-[max(0.5rem,env(safe-area-inset-top))] pr-[max(0.5rem,env(safe-area-inset-right))] pb-[max(0.5rem,env(safe-area-inset-bottom))] pl-[max(0.5rem,env(safe-area-inset-left))] sm:p-4 lg:p-6"
      data-glass={glass}
      data-preset={background}
      data-provider={provider}
      data-text-size={textSize}
      data-tone={backgroundTone(background)}
    >
      <div
        aria-hidden="true"
        className="ambient-orbs pointer-events-none absolute inset-0 overflow-hidden"
      >
        {AMBIENT_ORBS[background].map((orb, index) => (
          <div
            className={`absolute rounded-full ${orb.className}`}
            key={index}
            style={{ backgroundColor: orb.color, filter: `blur(${orb.blur})` }}
          />
        ))}
      </div>

      <main
        className="relative z-10 flex h-full max-h-[720px] w-full max-w-[1360px] items-stretch justify-center gap-4 lg:gap-5"
        ref={setMainEl}
      >
        <ConversationSidebar
          activeId={activeId}
          conversations={saved}
          desktopSidebarCollapsed={desktopSidebarCollapsed}
          mobileOpen={overlay === "sidebar"}
          onDelete={deleteConversation}
          onMobileClose={() => setActiveOverlay(null)}
          onNew={newConversation}
          onRename={renameConversation}
          onSelect={selectConversation}
          onSettingsOpenChange={(open) => setActiveOverlay(open ? "settings" : null)}
          onSearchQueryChange={setSearchQuery}
          onSelectSearchResult={selectSearchResult}
          portalContainer={mainEl}
          searchQuery={searchQuery}
          settingsOpen={overlay === "settings"}
          storageStatus={storageStatus}
        />

        <section
          // Responsive UI refinement: `p-3` below `sm` for the same reason
          // as `workspace-root`'s own padding above -- `lg:p-7` upward is
          // unchanged from before.
          className="optical-glass relative flex min-w-0 flex-1 flex-col rounded-[32px] p-3 sm:p-5 lg:p-7"
          ref={hostRef}
        >
          {isUltra ? (
            <div aria-hidden="true" className="edge-glint" ref={glintRef} />
          ) : null}

          <ChatHeader onToggleSidebar={toggleSidebar} sidebarVisible={sidebarVisible} title={title} />

          <MessageList
            // Keyed by conversation so the entrance-animation baseline is
            // rebuilt on switch instead of animating the whole transcript.
            key={activeId ?? "none"}
            error={notConfigured && !error ? "MISSING_KEY" : error}
            errorInfo={errorInfo}
            highlightMessageId={highlightMessageId}
            messages={messages}
            onEditResend={editAndResend}
            onHighlightHandled={handleHighlightHandled}
            onRegenerate={regenerate}
            onRemoveAttachment={(messageId, attachmentId) => {
              if (activeId) removeAttachment(activeId, messageId, attachmentId);
            }}
            onRetry={retry}
            onSelectVersion={(messageId, versionId) => {
              if (activeId) selectMessageVersion(activeId, messageId, versionId);
            }}
            onUsePrompt={(text) => composerRef.current?.setText(text)}
            provider={provider}
            // F5: the provider the failed/in-flight request actually
            // targeted, not necessarily the one now selected.
            requestProvider={requestProviderId ?? provider}
            speechRate={speechRate}
            speechVoiceGender={speechVoiceGender}
            speechVoiceId={speechVoiceId}
            status={status}
          />

          <MessageComposer
            availability={availability}
            conversationFull={conversationFull}
            conversationStarted={messages.length > 0}
            hasOversizedHistoryMessage={hasOversizedHistoryMessage}
            disabled={!hydrated || !providerReady}
            disabledReason={
              !providerReady
                ? `Add ${providerKeyName(provider)} to .env.local to start chatting.`
                : undefined
            }
            handleRef={composerRef}
            onProviderMenuOpenChange={(open) => setActiveOverlay(open ? "provider" : null)}
            onSelectProvider={(id) => {
              if (activeId) setConversationProvider(activeId, id);
            }}
            onSend={send}
            onStartNewConversation={newConversation}
            onStop={stop}
            portalContainer={mainEl}
            provider={provider}
            providerMenuOpen={overlay === "provider"}
            status={status}
          />
        </section>
      </main>

      <SettingsOverlay
        background={background}
        glass={glass}
        onChangeSpeechRate={setSpeechRate}
        onChangeSpeechVoice={setSpeechVoiceId}
        onClose={() => setActiveOverlay(null)}
        onDeleteAllConversations={deleteAllConversations}
        onExportConversations={exportConversations}
        exportableConversations={saved}
        onChangeSpeechVoiceGender={setSpeechVoiceGender}
        onSavePreferences={setPreferences}
        onSelectBackground={setBackground}
        onSelectGlass={setGlass}
        onSelectTextSize={setTextSize}
        open={overlay === "settings"}
        portalContainer={mainEl}
        preferences={preferences}
        speechRate={speechRate}
        speechSupported={speechSupported}
        speechVoiceGender={speechVoiceGender}
        speechVoiceId={speechVoiceId}
        textSize={textSize}
        voices={speechVoices}
      />
    </div>
  );
}
