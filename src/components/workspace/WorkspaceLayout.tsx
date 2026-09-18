"use client";

import { useEffect, useState } from "react";
import { ChatHeader } from "@/components/workspace/ChatHeader";
import { ConversationSidebar } from "@/components/workspace/ConversationSidebar";
import { MessageComposer } from "@/components/workspace/MessageComposer";
import { MessageList } from "@/components/workspace/MessageList";
import {
  AMBIENT_ORBS,
  backgroundTone,
  DEFAULT_BACKGROUND,
  DEFAULT_GLASS,
  type BackgroundId,
  type GlassStyleId,
} from "@/lib/backgrounds";
import { DEFAULT_PROVIDER, type ProviderId } from "@/lib/providers";
import { useEdgeGlint } from "@/lib/use-edge-glint";
import { useChat } from "@/lib/use-chat";

const NEW_CONVERSATION_TITLE = "New conversation";

export function WorkspaceLayout() {
  const [background, setBackground] = useState<BackgroundId>(DEFAULT_BACKGROUND);
  const [glass, setGlass] = useState<GlassStyleId>(DEFAULT_GLASS);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [provider, setProvider] = useState<ProviderId>(DEFAULT_PROVIDER);
  const [configured, setConfigured] = useState<boolean | null>(null);

  const { messages, status, error, errorInfo, send, stop, retry, reset } =
    useChat();

  const isUltra = glass === "ultra";
  const { hostRef, glintRef } = useEdgeGlint<HTMLElement>(isUltra);

  // Probe configuration once so the setup state shows on load rather than
  // after a failed send.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/chat")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setConfigured(Boolean(data?.configured));
      })
      .catch(() => {
        if (!cancelled) setConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const notConfigured = configured === false;
  // The first user message becomes the conversation title.
  const title =
    messages.find((m) => m.role === "user")?.content.slice(0, 48) ??
    NEW_CONVERSATION_TITLE;

  return (
    <div
      className="workspace-root relative flex h-dvh w-full items-center justify-center overflow-hidden p-4 lg:p-6"
      data-glass={glass}
      data-preset={background}
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
          currentTitle={title}
          hasMessages={messages.length > 0}
          onNewConversation={reset}
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
            onPickerOpenChange={setPickerOpen}
            onSelectBackground={setBackground}
            onSelectGlass={setGlass}
            onSelectProvider={setProvider}
            pickerOpen={pickerOpen}
            provider={provider}
            title={title}
          />

          <MessageList
            error={notConfigured && !error ? "MISSING_KEY" : error}
            errorInfo={errorInfo}
            messages={messages}
            onRetry={() => retry(provider)}
            status={status}
          />

          <MessageComposer
            disabled={notConfigured}
            disabledReason={
              notConfigured
                ? "Add GEMINI_API_KEY to .env.local to start chatting."
                : undefined
            }
            onSend={(text) => send(text, provider)}
            onStop={stop}
            status={status}
          />
        </section>
      </main>
    </div>
  );
}
