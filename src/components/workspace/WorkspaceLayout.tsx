"use client";

import { useEffect, useRef, useState } from "react";
import { ChatHeader } from "@/components/workspace/ChatHeader";
import { ConversationSidebar } from "@/components/workspace/ConversationSidebar";
import {
  MessageComposer,
  type ComposerHandle,
} from "@/components/workspace/MessageComposer";
import { MessageList } from "@/components/workspace/MessageList";
import {
  AMBIENT_ORBS,
  backgroundTone,
  DEFAULT_BACKGROUND,
  DEFAULT_GLASS,
  type BackgroundId,
  type GlassStyleId,
} from "@/lib/backgrounds";
import {
  DEFAULT_PROVIDER,
  isProviderUsable,
  type AvailabilityMap,
} from "@/lib/providers";
import { useEdgeGlint } from "@/lib/use-edge-glint";
import { useConversations } from "@/lib/use-conversations";

export function WorkspaceLayout() {
  const [background, setBackground] = useState<BackgroundId>(DEFAULT_BACKGROUND);
  const [glass, setGlass] = useState<GlassStyleId>(DEFAULT_GLASS);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [availability, setAvailability] = useState<AvailabilityMap | null>(null);
  const composerRef = useRef<ComposerHandle>(null);

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
    send,
    stop,
    retry,
    selectConversation,
    newConversation,
    renameConversation,
    deleteConversation,
    setConversationProvider,
  } = useConversations();

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
  const geminiReady = availability === null || isProviderUsable("gemini", availability);
  const notConfigured = availability !== null && !isProviderUsable(provider, availability);
  const title = active?.title ?? "New conversation";

  return (
    <div
      className="workspace-root relative flex h-dvh w-full items-center justify-center overflow-hidden p-4 lg:p-6"
      data-glass={glass}
      data-preset={background}
      data-provider={provider}
      data-tone={backgroundTone(background)}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        {AMBIENT_ORBS[background].map((orb, index) => (
          <div
            className={`absolute rounded-full ${orb.className}`}
            key={index}
            style={{ backgroundColor: orb.color, filter: `blur(${orb.blur})` }}
          />
        ))}
      </div>

      <main className="relative z-10 flex h-full max-h-[720px] w-full max-w-[1360px] items-stretch justify-center gap-4 lg:gap-5">
        <ConversationSidebar
          activeId={activeId}
          conversations={saved}
          onDelete={deleteConversation}
          onNew={newConversation}
          onRename={renameConversation}
          onSelect={selectConversation}
          storageStatus={storageStatus}
        />

        <section
          className="optical-glass relative flex min-w-0 flex-1 flex-col rounded-[32px] p-5 lg:p-7"
          ref={hostRef}
        >
          {isUltra ? (
            <div aria-hidden="true" className="edge-glint" ref={glintRef} />
          ) : null}

          <ChatHeader
            activeBackground={background}
            activeGlass={glass}
            availability={availability}
            conversationStarted={messages.length > 0}
            onPickerOpenChange={setPickerOpen}
            onSelectBackground={setBackground}
            onSelectGlass={setGlass}
            onSelectProvider={(id) => {
              if (activeId) setConversationProvider(activeId, id);
            }}
            pickerOpen={pickerOpen}
            provider={provider}
            title={title}
          />

          <MessageList
            // Keyed by conversation so the entrance-animation baseline is
            // rebuilt on switch instead of animating the whole transcript.
            key={activeId ?? "none"}
            error={notConfigured && !error ? "MISSING_KEY" : error}
            errorInfo={errorInfo}
            messages={messages}
            onRetry={retry}
            onUsePrompt={(text) => composerRef.current?.setText(text)}
            provider={provider}
            status={status}
          />

          <MessageComposer
            disabled={!hydrated || !geminiReady}
            disabledReason={
              !geminiReady
                ? "Add GEMINI_API_KEY to .env.local to start chatting."
                : undefined
            }
            handleRef={composerRef}
            onSend={send}
            onStop={stop}
            status={status}
          />
        </section>
      </main>
    </div>
  );
}
