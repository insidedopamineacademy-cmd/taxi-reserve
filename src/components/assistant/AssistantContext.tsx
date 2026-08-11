"use client";

import { createContext, useContext } from "react";
import type {
  AssistantMessage,
  AssistantPreviewScenario,
  AssistantRequestState,
} from "./types";

export type AssistantContextValue = {
  isOpen: boolean;
  previewMode: boolean;
  draft: string;
  messages: AssistantMessage[];
  requestState: AssistantRequestState;
  announcement: string;
  previewScenario: AssistantPreviewScenario;
  openAssistant: (opener: HTMLButtonElement) => void;
  closeAssistant: () => void;
  setDraft: (draft: string) => void;
  setPreviewScenario: (scenario: AssistantPreviewScenario) => void;
  submitMessage: () => void;
  stopMessage: () => void;
  retryMessage: () => void;
};

export const AssistantContext = createContext<AssistantContextValue | null>(null);

export function useAssistant() {
  const value = useContext(AssistantContext);
  if (!value) {
    throw new Error("Assistant components must be rendered within AssistantProvider");
  }
  return value;
}
