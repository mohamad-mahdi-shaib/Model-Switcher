import { BotIcon } from "@/components/icons";
import { MESSAGES, type AssistantMessage, type UserMessage } from "@/lib/sample-data";

function UserBubble({ message }: { message: UserMessage }) {
  return (
    <div className="flex justify-end pt-2">
      <div className="glass-btn max-w-md rounded-[22px] border border-white/80 px-5 py-2.5 text-[13px] leading-snug font-medium tracking-tight glass-text-dark">
        {message.text}
      </div>
    </div>
  );
}

function AssistantAnswer({ message }: { message: AssistantMessage }) {
  return (
    <div className="flex items-start gap-3.5 pt-1">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/70 bg-white/15 shadow-sm backdrop-blur-md">
        <BotIcon className="h-3.5 w-3.5 glass-text-dark" />
      </span>

      <div className="max-w-[680px] space-y-3.5 text-[12.5px] leading-relaxed">
        <div>
          <h3 className="text-[14px] font-semibold tracking-tight glass-text-dark">
            {message.heading}
          </h3>
          <p className="mt-1 glass-text-muted">{message.intro}</p>
        </div>

        <ol className="space-y-3 pl-1">
          {message.points.map((point, index) => (
            <li className="flex items-start gap-1.5" key={point.heading}>
              <span className="shrink-0 font-bold glass-text-dark">
                {index + 1}.
              </span>
              <div>
                <span className="font-semibold glass-text-dark">
                  {point.heading}
                </span>
                <p className="mt-0.5 text-[12px] leading-normal glass-text-subtle">
                  {point.body}
                </p>
              </div>
            </li>
          ))}
        </ol>

        <p className="pt-1 text-[12px] glass-text-muted">{message.closing}</p>
      </div>
    </div>
  );
}

export function MessageList() {
  return (
    <div className="relative z-10 my-4 min-h-0 flex-1">
      {/* Blurs the background behind the message column. The text sits above
          it at full sharpness and full opacity. */}
      <div
        aria-hidden="true"
        className="diffusion-scrim absolute -inset-x-2 -inset-y-1 rounded-[22px]"
      />
      <div
        aria-label="Conversation"
        className="glass-scroll relative h-full space-y-6 overflow-y-auto pr-2"
        role="log"
      >
        {MESSAGES.map((message) =>
          message.role === "user" ? (
            <UserBubble key={message.id} message={message} />
          ) : (
            <AssistantAnswer key={message.id} message={message} />
          ),
        )}
      </div>
    </div>
  );
}
