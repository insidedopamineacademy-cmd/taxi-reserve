"use client";

import { AssistantMessage } from "./AssistantMessage";
import { isAssistantBusy } from "./assistantMobile";
import { useAssistantScroll } from "./useAssistantScroll";
import type {
  AssistantMessage as AssistantMessageType,
  AssistantRequestState,
} from "./types";

const starterPrompts = [
  "Tomorrow’s reservations",
  "Unassigned jobs",
  "Airport jobs this morning",
  "Find a reservation",
];

type Props = {
  messages: AssistantMessageType[];
  requestState: AssistantRequestState;
  onPromptSelect: (prompt: string) => void;
  onRetry: () => void;
  onConfirmAction: (actionId: string) => void;
  onCancelAction: (actionId: string) => void;
};

export function AssistantMessageList({
  messages,
  requestState,
  onPromptSelect,
  onRetry,
  onConfirmAction,
  onCancelAction,
}: Props) {
  const { scrollRef, contentRef, isNearBottom, measure, scrollToLatest } =
    useAssistantScroll(messages);
  let assistantAvatarShown = false;

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={measure}
        className="assistant-transcript absolute inset-0 overflow-y-auto overscroll-contain px-4 py-4"
        tabIndex={0}
        aria-label="Assistant conversation"
        aria-busy={isAssistantBusy(requestState)}
      >
        <div ref={contentRef} className="min-h-full">
          {messages.length === 0 ? (
            <div className="flex min-h-full flex-col items-center justify-center py-8 text-center">
              <div className="max-w-[310px]">
                <p className="text-lg font-semibold text-white">How can I help with operations?</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Ask about your Taxi Reserve reservations. Searches are read-only and permission-scoped.
                </p>
              </div>
              <div className="mt-5 flex max-w-sm flex-wrap justify-center gap-2">
                {starterPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => onPromptSelect(prompt)}
                    className="min-h-11 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-200 transition hover:border-amber-300/50 hover:bg-amber-300/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-5 pb-2">
              {messages.map((message) => {
                const showAssistantAvatar = message.role === "assistant" && !assistantAvatarShown;
                if (showAssistantAvatar) assistantAvatarShown = true;
                return (
                  <AssistantMessage
                    key={message.id}
                    message={message}
                    showAssistantAvatar={showAssistantAvatar}
                    onRetry={onRetry}
                    onConfirmAction={onConfirmAction}
                    onCancelAction={onCancelAction}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>

      {!isNearBottom ? (
        <button
          type="button"
          onClick={() => scrollToLatest()}
          className="absolute bottom-3 left-1/2 z-10 min-h-11 -translate-x-1/2 rounded-full border border-white/15 bg-[#172033] px-4 text-sm font-medium text-white shadow-lg hover:bg-[#202b42] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
        >
          Jump to latest
        </button>
      ) : null}
    </div>
  );
}
