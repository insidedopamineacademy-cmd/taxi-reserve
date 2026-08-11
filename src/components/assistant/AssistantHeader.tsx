"use client";

import { AssistantAvatar } from "./AssistantAvatar";
import type { AssistantRequestState } from "./types";

type Props = {
  previewMode: boolean;
  requestState: AssistantRequestState;
  onClose: () => void;
};

const requestStateLabels: Record<AssistantRequestState, string> = {
  idle: "Read-only reservation assistant",
  submitting: "Submitting request",
  generating: "Generating response",
  failed: "Last request failed",
};

export function AssistantHeader({ previewMode, requestState, onClose }: Props) {
  return (
    <header className="assistant-header flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-3">
      <AssistantAvatar size="medium" />
      <div className="min-w-0 flex-1">
        <h2 id="assistant-dialog-title" className="truncate text-sm font-semibold text-white">
          Taxi Reserve Assistant
        </h2>
        <p className="truncate text-xs text-slate-400">
          {previewMode ? "Development fixture preview" : requestStateLabels[requestState]}
        </p>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-2xl leading-none text-slate-300 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
        aria-label="Close Taxi Reserve Assistant"
      >
        <span aria-hidden="true">×</span>
      </button>
    </header>
  );
}
