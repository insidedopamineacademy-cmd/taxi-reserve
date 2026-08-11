"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  canSubmitAssistantDraft,
  getAssistantTextareaSizing,
  isAssistantBusy,
  shouldSubmitAssistantKey,
} from "./assistantMobile";
import type { AssistantRequestState } from "./types";

type Props = {
  draft: string;
  previewMode: boolean;
  requestState: AssistantRequestState;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
};

export const AssistantComposer = forwardRef<HTMLTextAreaElement, Props>(
  function AssistantComposer(
    { draft, previewMode, requestState, onDraftChange, onSubmit, onStop },
    textareaRef
  ) {
    const [unsupportedNotice, setUnsupportedNotice] = useState("");
    const compositionRef = useRef(false);

    const resizeTextarea = useCallback(() => {
      const textarea =
        typeof textareaRef === "function" ? null : textareaRef?.current ?? null;
      if (!textarea) return;
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      textarea.style.height = "0px";
      const sizing = getAssistantTextareaSizing(textarea.scrollHeight, viewportHeight);
      textarea.style.maxHeight = `${sizing.maxHeight}px`;
      textarea.style.height = `${sizing.height}px`;
      textarea.style.overflowY = sizing.shouldScroll ? "auto" : "hidden";
    }, [textareaRef]);

    useLayoutEffect(() => {
      resizeTextarea();
    }, [draft, resizeTextarea]);

    useEffect(() => {
      const viewport = window.visualViewport;
      let frame = 0;
      const scheduleResize = () => {
        if (frame) return;
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          resizeTextarea();
        });
      };
      viewport?.addEventListener("resize", scheduleResize);
      window.addEventListener("resize", scheduleResize);
      window.addEventListener("orientationchange", scheduleResize);
      return () => {
        if (frame) window.cancelAnimationFrame(frame);
        viewport?.removeEventListener("resize", scheduleResize);
        window.removeEventListener("resize", scheduleResize);
        window.removeEventListener("orientationchange", scheduleResize);
      };
    }, [resizeTextarea]);

    const canSubmit = canSubmitAssistantDraft(draft, requestState, true);
    const isBusy = isAssistantBusy(requestState);

    return (
      <form
        className="assistant-composer shrink-0 border-t border-white/10 bg-[#0b1220] px-3 pt-3"
        aria-busy={isBusy}
        data-request-state={requestState}
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) onSubmit();
        }}
      >
        {unsupportedNotice ? (
          <p id="assistant-attachment-notice" className="mb-2 text-xs text-amber-200">
            {unsupportedNotice}
          </p>
        ) : null}

        <div className="flex items-end gap-2 rounded-2xl border border-white/10 bg-[#111827] p-2 focus-within:border-amber-300/50">
          <textarea
            ref={textareaRef}
            rows={1}
            value={draft}
            onChange={(event) => {
              onDraftChange(event.target.value);
              if (unsupportedNotice) setUnsupportedNotice("");
            }}
            onKeyDown={(event) => {
              const nativeEvent = event.nativeEvent;
              const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
              if (shouldSubmitAssistantKey({
                key: event.key,
                shiftKey: event.shiftKey,
                isComposing: nativeEvent.isComposing || compositionRef.current,
                keyCode: nativeEvent.keyCode,
                coarsePointer,
              }) && canSubmit) {
                event.preventDefault();
                onSubmit();
              }
            }}
            onCompositionStart={() => {
              compositionRef.current = true;
            }}
            onCompositionEnd={() => {
              compositionRef.current = false;
            }}
            onPaste={(event) => {
              const hasFile = Array.from(event.clipboardData.items).some(
                (item) => item.kind === "file"
              );
              if (!hasFile) return;
              setUnsupportedNotice("Images aren’t supported yet.");
              if (!event.clipboardData.getData("text/plain")) event.preventDefault();
            }}
            onDragOver={(event) => {
              if (Array.from(event.dataTransfer.items).some((item) => item.kind === "file")) {
                event.preventDefault();
              }
            }}
            onDrop={(event) => {
              if (event.dataTransfer.files.length === 0) return;
              event.preventDefault();
              setUnsupportedNotice("Images aren’t supported yet.");
            }}
            placeholder="Ask the assistant…"
            inputMode="text"
            enterKeyHint="enter"
            autoCapitalize="sentences"
            autoCorrect="on"
            spellCheck
            aria-label="Message Taxi Reserve Assistant"
            aria-describedby={
              unsupportedNotice
                ? "assistant-composer-note assistant-attachment-notice"
                : "assistant-composer-note"
            }
            className="min-h-0 min-w-0 flex-1 resize-none bg-transparent px-2 py-2.5 text-[16px] leading-6 text-white outline-none placeholder:text-slate-500"
          />

          {isBusy ? (
            <button
              type="button"
              onClick={onStop}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-white text-sm font-semibold text-[#101827] hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
              aria-label="Stop response"
            >
              <span aria-hidden="true" className="size-3 rounded-sm bg-[#101827]" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-amber-300 text-[#101827] transition hover:bg-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
              aria-label="Send message"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m5 12 7-7 7 7M12 5v14" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>

        <p id="assistant-composer-note" className="px-1 pb-2 pt-2 text-center text-[11px] leading-4 text-slate-500">
          {previewMode
            ? "Development fixtures only — no live data or actions"
            : "Taxi Reserve Assistant — changes require confirmation"}
        </p>
      </form>
    );
  }
);
