"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import { AssistantComposer } from "./AssistantComposer";
import { useAssistant } from "./AssistantContext";
import { AssistantHeader } from "./AssistantHeader";
import { AssistantMessageList } from "./AssistantMessageList";
import { useAssistantBodyLock } from "./useAssistantBodyLock";
import { useAssistantViewport } from "./useAssistantViewport";

const AssistantFixtureControls = dynamic(
  () =>
    import("./AssistantFixtureControls").then((module) => module.AssistantFixtureControls),
  { ssr: false }
);

export function AssistantDialog() {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const {
    previewMode,
    draft,
    messages,
    requestState,
    announcement,
    previewScenario,
    closeAssistant,
    setDraft,
    setPreviewScenario,
    submitMessage,
    stopMessage,
    retryMessage,
    confirmAction,
    cancelAction,
  } = useAssistant();

  useAssistantBodyLock();
  useAssistantViewport(dialogRef);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (!dialog.open) dialog.showModal();

    const firstFrame = window.requestAnimationFrame(() => {
      const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
      if (finePointer) composerRef.current?.focus({ preventScroll: true });
      else dialog.focus({ preventScroll: true });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (dialog.open) dialog.close();
    };
  }, []);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeAssistant();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [closeAssistant]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="assistant-dialog-title"
      tabIndex={-1}
      className="assistant-dialog"
      onCancel={(event) => {
        event.preventDefault();
        closeAssistant();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeAssistant();
      }}
    >
      <section className="assistant-panel flex h-full min-h-0 flex-col overflow-hidden bg-[#090f1c] text-white">
        <AssistantHeader
          previewMode={previewMode}
          requestState={requestState}
          onClose={closeAssistant}
        />

        {previewMode ? (
          <AssistantFixtureControls
            value={previewScenario}
            onChange={setPreviewScenario}
          />
        ) : null}

        <AssistantMessageList
          messages={messages}
          requestState={requestState}
          onPromptSelect={(prompt) => {
            setDraft(prompt);
            composerRef.current?.focus();
          }}
          onRetry={retryMessage}
          onConfirmAction={confirmAction}
          onCancelAction={cancelAction}
        />
        <AssistantComposer
          ref={composerRef}
          draft={draft}
          previewMode={previewMode}
          requestState={requestState}
          onDraftChange={setDraft}
          onSubmit={submitMessage}
          onStop={stopMessage}
        />
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>
      </section>
    </dialog>
  );
}
