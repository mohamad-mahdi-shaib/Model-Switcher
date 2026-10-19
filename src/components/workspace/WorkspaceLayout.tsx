"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AppHeader } from "@/components/workspace/AppHeader";
import { AppShell } from "@/components/workspace/AppShell";
import { ConversationSidebar } from "@/components/workspace/ConversationSidebar";
import {
  MessageComposer,
  type ComposerHandle,
} from "@/components/workspace/MessageComposer";
import { MessageList } from "@/components/workspace/MessageList";
import { SettingsOverlay, type SettingsSection } from "@/components/workspace/SettingsPanel";
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
import type { GeneratedImageRef } from "@/lib/chat";
import type { Preferences } from "@/lib/preferences";
import {
  DEFAULT_PROVIDER,
  isProviderUsable,
  type AvailabilityMap,
} from "@/lib/providers";
import type { TextSizeId } from "@/lib/text-size";
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
 * Settings itself is rendered ONCE, here, as `SettingsOverlay` -- decoupled
 * from the sidebar/drawer's own mount lifecycle (see `SettingsPanel.tsx`'s
 * own comment for the real bug this fixes: the previous two Settings
 * surfaces were nested inside the sidebar's own `SidebarBody`, so closing
 * the drawer to open Settings could leave NEITHER visible). Its TRIGGER now
 * lives in the global header (`AppHeader.tsx`) rather than the sidebar
 * footer, so it is reachable at every width and in every sidebar state.
 */
type ActiveOverlay = "provider" | "settings" | "sidebar" | null;

/**
 * State container and composition root. The layout itself -- header,
 * sidebar, main, footer -- is `AppShell`; this component owns the state all
 * four regions read, and nothing about how they are arranged.
 */
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
  // Which Settings tab is showing. Owned here rather than inside
  // `SettingsOverlay` so the panel stays presentational -- it is rendered
  // (and returns null) on every render, so state kept inside it would
  // persist across opens by accident rather than by decision.
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("appearance");
  /** Project 3: a failure from an explicit Regenerate / Make-a-variation. */
  const [imageError, setImageError] = useState<string | null>(null);
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
  // Finding U5 (independent follow-up review): every portaled overlay --
  // the sidebar drawer, Settings, and the switch-confirmation dialog --
  // needs a portal target with no backdrop-filter/transform ancestor of its
  // own, or `position: fixed` on a backdrop is contained by whichever glass
  // panel it happens to render inside instead of covering the real
  // viewport. `AppShell` hands back its own outermost element for exactly
  // that: it wraps all four regions, carries no filter of its own, and is
  // `relative` (which the switch dialog's measured placement resolves
  // against). It replaces the previous `<main>` target, which could not
  // cover the new header and footer at all -- they are its siblings, not
  // its descendants. State, set via a ref callback, rather than a raw ref
  // read during render (React's own rule against reading `.current` outside
  // an effect/handler -- a value genuinely needed for what THIS component
  // renders belongs in state, not a ref).
  const [shellEl, setShellEl] = useState<HTMLElement | null>(null);
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
  // counting as open -- avoiding two redundant "Conversations" surfaces
  // ever being visible at once. Derived at render time rather than synced
  // back into state via an effect, per this project's own
  // `react-hooks/set-state-in-effect` rule: `activeOverlay` itself is
  // untouched, so the drawer reopens normally the next time the viewport
  // narrows again.
  const isCompactSidebar = useMediaQuery("(max-width: 1023px)");
  const overlay: ActiveOverlay =
    !isCompactSidebar && activeOverlay === "sidebar" ? null : activeOverlay;

  // One toggle button (the global header) serves both roles: below `lg` it
  // opens/closes the portaled drawer; at `>=lg` it collapses/expands the
  // inline sidebar. `sidebarVisible` drives the button's own label/
  // aria-expanded state so it always describes what it currently controls.
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
    appendGeneratedImages,
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

  /**
   * Project 3: the two explicit generated-image follow-ups.
   *
   * These call `/api/images` directly rather than going through the model's
   * tool call, and that is the correct split: the user has already decided
   * what they want, so there is nothing for a model to choose. The
   * model-selected path (Phase 4) is the one in `@/server/images/tool.ts`,
   * reached by simply asking for an image in the conversation.
   *
   * A variation re-sends the ACTUAL source image, not just its prompt, so it
   * is a variation of that image rather than an unrelated second render of
   * the same words.
   */
  const [imageActionBusy, setImageActionBusy] = useState(false);

  const runImageAction = useCallback(
    async (image: GeneratedImageRef, operation: "generate" | "variation") => {
      if (imageActionBusy) return; // guards against a double click
      setImageActionBusy(true);
      try {
        let images: { mimeType: string; data: string }[] = [];
        if (operation === "variation") {
          // Fetch the source bytes back. Works for both a stored https URL
          // and an inline data URL.
          const response = await fetch(image.url);
          if (!response.ok) throw new Error("source unavailable");
          const buffer = await response.arrayBuffer();
          let binary = "";
          const bytes = new Uint8Array(buffer);
          for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
          images = [{ mimeType: image.mediaType, data: btoa(binary) }];
        }

        const response = await fetch("/api/images", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt: image.prompt, operation, images }),
        });
        const payload = (await response.json()) as {
          images?: { url: string; mediaType: string; persisted: boolean }[];
          code?: string;
        };
        if (!response.ok || !payload.images || payload.images.length === 0) {
          setImageError(
            operation === "variation"
              ? "Could not create a variation of that image."
              : "Could not regenerate that image.",
          );
          return;
        }
        setImageError(null);
        appendGeneratedImages(
          payload.images.map((generated) => ({
            url: generated.url,
            mediaType: generated.mediaType,
            prompt: image.prompt,
            model: image.model,
            operation: operation === "variation" ? ("variation" as const) : ("generate" as const),
            persisted: generated.persisted,
          })),
          operation === "variation" ? "Here is a variation." : "Here it is again.",
        );
      } catch {
        setImageError(
          operation === "variation"
            ? "Could not create a variation of that image."
            : "Could not regenerate that image.",
        );
      } finally {
        setImageActionBusy(false);
      }
    },
    [appendGeneratedImages, imageActionBusy],
  );

  const handleRegenerateImage = useCallback(
    (image: GeneratedImageRef) => void runImageAction(image, "generate"),
    [runImageAction],
  );
  const handleImageVariation = useCallback(
    (image: GeneratedImageRef) => void runImageAction(image, "variation"),
    [runImageAction],
  );

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
  const messageCount = active?.messages.length ?? 0;
  const conversationFull = messageCount >= MAX_MESSAGES;
  // U1: same idea, for the other reason a conversation can become permanently
  // unsendable -- a message already in it (never a fresh draft, which
  // validateDraft() itself refuses) is over the per-message limit.
  const hasOversizedHistoryMessage = hasOversizedMessage(active?.messages ?? []);

  return (
    <div
      // The outer gutter, and the only margin the workspace has. Full-width
      // pass: `lg:p-6` (24px a side) is down to `lg:p-3` (12px) -- the glass
      // panels are rounded cards and still need a few pixels of ground to
      // sit on, but not the 48px of combined horizontal inset they used to
      // take before the shell's own max-width even applied. The four
      // `env(safe-area-inset-*)` overrides keep the panels clear of a device
      // notch or home indicator in either orientation (needs
      // `viewport-fit: cover` in layout.tsx's own viewport export, or these
      // resolve to 0 and this is a no-op on top of the plain padding above).
      className="workspace-root relative flex h-dvh w-full items-stretch justify-center overflow-hidden p-2 pt-[max(0.5rem,env(safe-area-inset-top))] pr-[max(0.5rem,env(safe-area-inset-right))] pb-[max(0.5rem,env(safe-area-inset-bottom))] pl-[max(0.5rem,env(safe-area-inset-left))] sm:p-2.5 lg:p-3"
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

      <AppShell
        header={
          <AppHeader
            onToggleSettings={() =>
              setActiveOverlay((prev) => (prev === "settings" ? null : "settings"))
            }
            onToggleSidebar={toggleSidebar}
            settingsOpen={overlay === "settings"}
            sidebarVisible={sidebarVisible}
            title={title}
          />
        }
        overlays={
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
            onSectionChange={setSettingsSection}
            onSelectBackground={setBackground}
            onSelectGlass={setGlass}
            onSelectTextSize={setTextSize}
            open={overlay === "settings"}
            portalContainer={shellEl}
            preferences={preferences}
            section={settingsSection}
            speechRate={speechRate}
            speechSupported={speechSupported}
            speechVoiceGender={speechVoiceGender}
            speechVoiceId={speechVoiceId}
            textSize={textSize}
            voices={speechVoices}
          />
        }
        shellRef={setShellEl}
        sidebar={
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
            onSearchQueryChange={setSearchQuery}
            onSelectSearchResult={selectSearchResult}
            portalContainer={shellEl}
            searchQuery={searchQuery}
            storageStatus={storageStatus}
          />
        }
      >
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
          onImageVariation={handleImageVariation}
          onRegenerate={regenerate}
          onRegenerateImage={handleRegenerateImage}
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

        {imageError ? (
          <p
            className="mx-auto mt-1 w-full max-w-[var(--content-column)] rounded-lg border border-white/25 bg-white/10 px-3 py-1.5 text-[11px] glass-text-subtle"
            role="alert"
          >
            {imageError}
          </p>
        ) : null}

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
          portalContainer={shellEl}
          provider={provider}
          providerMenuOpen={overlay === "provider"}
          status={status}
        />
      </AppShell>
    </div>
  );
}
