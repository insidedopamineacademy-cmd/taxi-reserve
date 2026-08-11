"use client";

import { AssistantAvatar } from "./AssistantAvatar";
import { useAssistant } from "./AssistantContext";

type Props = {
  variant: "desktop" | "mobile";
  onBeforeOpen?: () => void;
};

export function AssistantLauncher({ variant, onBeforeOpen }: Props) {
  const { isOpen, openAssistant } = useAssistant();

  return (
    <button
      type="button"
      aria-label="Open Taxi Reserve Assistant"
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      onClick={(event) => {
        onBeforeOpen?.();
        openAssistant(event.currentTarget);
      }}
      className={
        variant === "desktop"
          ? "assistant-launcher assistant-launcher-desktop fixed bottom-4 right-4 z-[60] size-14 items-center justify-center rounded-full border border-amber-200/70 bg-black p-0.5 shadow-[0_14px_38px_rgba(0,0,0,0.48)] transition hover:scale-[1.03] hover:border-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b1324]"
          : "assistant-launcher assistant-launcher-mobile inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-amber-200/70 bg-black p-0.5 shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b1324]"
      }
    >
      <AssistantAvatar size="launcher" />
    </button>
  );
}
