"use client";

import { useState } from "react";
import { ChatHeader } from "@/components/workspace/ChatHeader";
import { ConversationSidebar } from "@/components/workspace/ConversationSidebar";
import { MessageComposer } from "@/components/workspace/MessageComposer";
import { MessageList } from "@/components/workspace/MessageList";
import {
  AMBIENT_ORBS,
  DEFAULT_BACKGROUND,
  type BackgroundId,
} from "@/lib/backgrounds";

export function WorkspaceLayout() {
  const [background, setBackground] = useState<BackgroundId>(DEFAULT_BACKGROUND);
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div
      className="workspace-root relative flex h-dvh w-full items-center justify-center overflow-hidden p-4 lg:p-6"
      data-preset={background}
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
        <ConversationSidebar />

        <section className="optical-glass relative flex min-w-0 flex-1 flex-col rounded-[32px] p-5 lg:p-7">
          <ChatHeader
            activeBackground={background}
            onPickerOpenChange={setPickerOpen}
            onSelectBackground={setBackground}
            pickerOpen={pickerOpen}
          />
          <MessageList />
          <MessageComposer />
        </section>
      </main>
    </div>
  );
}
