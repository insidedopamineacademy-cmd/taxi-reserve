"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AssistantContext, type AssistantContextValue } from "./AssistantContext";
import {
  canAcceptAssistantSubmission,
  isAssistantBusy,
} from "./assistantMobile";
import {
  applyAssistantStreamEvent,
  buildAssistantConversationContext,
  createAssistantMalformedStreamError,
  createAssistantNetworkError,
  createPendingAssistantMessage,
  disablePreviousRetries,
  markAssistantMessageFailed,
  markAssistantMessageStopped,
  type AssistantFailedTurn,
} from "./assistantStreaming";
import {
  ASSISTANT_STREAM_CONTENT_TYPE,
  AssistantSseDecoder,
  type AssistantStreamEvent,
} from "../../lib/assistant/stream-protocol";
import type {
  AssistantMessage,
  AssistantMessagePart,
  AssistantPreviewScenario,
  AssistantRequestState,
} from "./types";

const AssistantDialog = dynamic(
  () => import("./AssistantDialog").then((module) => module.AssistantDialog),
  { ssr: false },
);

type Props = {
  children: React.ReactNode;
  previewMode: boolean;
};

type ActiveRequest = AssistantFailedTurn & {
  controller: AbortController;
  stopped: boolean;
};

class AssistantHttpError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "AssistantHttpError";
  }
}

let localMessageSequence = 0;

function nextMessageId(prefix: string) {
  localMessageSequence += 1;
  return `${prefix}-${localMessageSequence}`;
}

function isAssistantStreamResponse(response: Response) {
  return response.headers
    .get("content-type")
    ?.toLowerCase()
    .startsWith(ASSISTANT_STREAM_CONTENT_TYPE.split(";")[0]);
}

async function readAssistantHttpError(response: Response) {
  try {
    const body = (await response.json()) as {
      error?: {
        code?: unknown;
        message?: unknown;
        retryable?: unknown;
        retryAfterSeconds?: unknown;
      };
    };
    if (
      typeof body.error?.code === "string" &&
      typeof body.error.message === "string" &&
      typeof body.error.retryable === "boolean"
    ) {
      return new AssistantHttpError(
        body.error.code,
        body.error.message,
        body.error.retryable,
        typeof body.error.retryAfterSeconds === "number" &&
          Number.isInteger(body.error.retryAfterSeconds) &&
          body.error.retryAfterSeconds > 0 &&
          body.error.retryAfterSeconds <= 3_600
          ? body.error.retryAfterSeconds
          : undefined,
      );
    }
  } catch {
    // Fall through to a safe response-derived error.
  }
  return new AssistantHttpError(
    response.status === 401 ? "UNAUTHENTICATED" : "UPSTREAM_UNAVAILABLE",
    response.status === 401
      ? "Sign in to use the assistant."
      : "The assistant is temporarily unavailable.",
    response.status !== 401,
  );
}

export function AssistantProvider({ children, previewMode }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [requestState, setRequestState] = useState<AssistantRequestState>("idle");
  const [announcement, setAnnouncement] = useState("");
  const [previewScenario, setPreviewScenarioState] =
    useState<AssistantPreviewScenario>("empty");
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const requestStateRef = useRef<AssistantRequestState>("idle");
  const submissionLockRef = useRef(false);
  const lastAcceptedDraftRef = useRef<string | null>(null);
  const fixtureRequestRef = useRef(0);
  const activeRequestRef = useRef<ActiveRequest | null>(null);
  const lastFailedTurnRef = useRef<AssistantFailedTurn | null>(null);
  const textBufferRef = useRef<{ assistantMessageId: string; text: string } | null>(null);
  const textFrameRef = useRef<number | null>(null);

  const updateRequestState = useCallback((state: AssistantRequestState) => {
    requestStateRef.current = state;
    setRequestState(state);
  }, []);

  const updateDraft = useCallback((value: string) => {
    if (value.trim() !== lastAcceptedDraftRef.current) {
      lastAcceptedDraftRef.current = null;
    }
    setDraft(value);
  }, []);

  const updateAssistantMessage = useCallback(
    (assistantMessageId: string, update: (message: AssistantMessage) => AssistantMessage) => {
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessageId ? update(message) : message,
        ),
      );
    },
    [],
  );

  const flushTextBuffer = useCallback(
    (assistantMessageId?: string) => {
      if (textFrameRef.current !== null) {
        window.cancelAnimationFrame(textFrameRef.current);
        textFrameRef.current = null;
      }
      const buffered = textBufferRef.current;
      if (!buffered || (assistantMessageId && buffered.assistantMessageId !== assistantMessageId)) {
        return;
      }
      textBufferRef.current = null;
      updateAssistantMessage(buffered.assistantMessageId, (message) =>
        applyAssistantStreamEvent(message, {
          type: "assistant.text.delta",
          delta: buffered.text,
        }),
      );
    },
    [updateAssistantMessage],
  );

  const queueTextDelta = useCallback(
    (assistantMessageId: string, delta: string) => {
      if (!delta) return;
      if (
        textBufferRef.current &&
        textBufferRef.current.assistantMessageId !== assistantMessageId
      ) {
        flushTextBuffer();
      }
      if (textBufferRef.current) textBufferRef.current.text += delta;
      else textBufferRef.current = { assistantMessageId, text: delta };

      if (textFrameRef.current === null) {
        textFrameRef.current = window.requestAnimationFrame(() => {
          textFrameRef.current = null;
          const buffered = textBufferRef.current;
          if (!buffered) return;
          textBufferRef.current = null;
          updateAssistantMessage(buffered.assistantMessageId, (message) =>
            applyAssistantStreamEvent(message, {
              type: "assistant.text.delta",
              delta: buffered.text,
            }),
          );
        });
      }
    },
    [flushTextBuffer, updateAssistantMessage],
  );

  const settleTurn = useCallback(
    (assistantMessageId: string, state: AssistantRequestState) => {
      if (activeRequestRef.current?.assistantMessageId === assistantMessageId) {
        activeRequestRef.current = null;
      }
      submissionLockRef.current = false;
      lastAcceptedDraftRef.current = null;
      updateRequestState(state);
    },
    [updateRequestState],
  );

  const failTurn = useCallback(
    (
      turn: AssistantFailedTurn,
      error: Extract<AssistantMessagePart, { type: "error" }>,
    ) => {
      flushTextBuffer(turn.assistantMessageId);
      setMessages((current) =>
        disablePreviousRetries(current).map((message) =>
          message.id === turn.assistantMessageId
            ? markAssistantMessageFailed(message, error)
            : message,
        ),
      );
      lastFailedTurnRef.current = error.retryable ? turn : null;
      settleTurn(turn.assistantMessageId, "failed");
      setAnnouncement(error.title);
    },
    [flushTextBuffer, settleTurn],
  );

  const processStreamEvent = useCallback(
    (turn: AssistantFailedTurn, event: AssistantStreamEvent) => {
      if (event.type === "assistant.text.delta") {
        queueTextDelta(turn.assistantMessageId, event.delta);
        return event.type;
      }

      flushTextBuffer(turn.assistantMessageId);
      updateAssistantMessage(turn.assistantMessageId, (message) =>
        applyAssistantStreamEvent(message, event),
      );

      if (event.type === "assistant.status") {
        updateRequestState("generating");
        setAnnouncement(event.label);
      } else if (event.type === "assistant.reservation_result") {
        setAnnouncement("Reservation result available");
      } else if (event.type === "assistant.complete") {
        lastFailedTurnRef.current = null;
        settleTurn(turn.assistantMessageId, "idle");
        setAnnouncement("Assistant response complete");
      } else if (event.type === "assistant.error") {
        lastFailedTurnRef.current = event.error.retryable ? turn : null;
        settleTurn(turn.assistantMessageId, "failed");
        setAnnouncement("Assistant request failed");
      }
      return event.type;
    },
    [flushTextBuffer, queueTextDelta, settleTurn, updateAssistantMessage, updateRequestState],
  );

  const runLiveTurn = useCallback(
    async (turn: AssistantFailedTurn, appendUser: boolean) => {
      const controller = new AbortController();
      const active: ActiveRequest = { ...turn, controller, stopped: false };
      activeRequestRef.current = active;
      lastFailedTurnRef.current = null;

      if (appendUser) {
        setMessages((current) => [
          ...disablePreviousRetries(current),
          {
            id: turn.userMessageId,
            role: "user",
            parts: [{ type: "text", text: turn.text }],
          },
          createPendingAssistantMessage(turn.assistantMessageId),
        ]);
      } else {
        setMessages((current) =>
          disablePreviousRetries(current).map((message) =>
            message.id === turn.assistantMessageId
              ? createPendingAssistantMessage(turn.assistantMessageId)
              : message,
          ),
        );
      }

      updateRequestState("submitting");
      setAnnouncement("Assistant request submitted");

      let sawTerminalEvent = false;
      try {
        const response = await fetch("/api/assistant/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: turn.text, context: turn.context }),
          signal: controller.signal,
        });
        if (!response.ok) throw await readAssistantHttpError(response);
        if (!isAssistantStreamResponse(response) || !response.body) {
          throw new Error("Malformed assistant stream");
        }

        updateRequestState("generating");
        const decoder = new AssistantSseDecoder();
        const textDecoder = new TextDecoder();
        const reader = response.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            for (const event of decoder.push(textDecoder.decode(value, { stream: true }))) {
              if (controller.signal.aborted) return;
              const type = processStreamEvent(turn, event);
              if (type === "assistant.complete" || type === "assistant.error") {
                sawTerminalEvent = true;
              }
            }
            if (sawTerminalEvent) break;
          }
          const finalChunk = textDecoder.decode();
          if (finalChunk) {
            for (const event of decoder.push(finalChunk)) {
              const type = processStreamEvent(turn, event);
              if (type === "assistant.complete" || type === "assistant.error") {
                sawTerminalEvent = true;
              }
            }
          }
          decoder.finish();
        } finally {
          reader.releaseLock();
        }

        if (!sawTerminalEvent && !controller.signal.aborted) {
          throw new Error("Assistant stream ended without a terminal event");
        }
      } catch (error) {
        if (controller.signal.aborted || active.stopped) return;
        if (error instanceof AssistantHttpError) {
          failTurn(turn, {
            type: "error",
            kind:
              error.code === "UNAUTHENTICATED"
                ? "unauthorized"
                : error.code === "REQUEST_TIMEOUT"
                  ? "timeout"
                  : error.code === "RATE_LIMITED"
                    ? "rate-limited"
                  : "generic",
            title:
              error.code === "UNAUTHENTICATED"
                ? "Sign in required"
                : error.code === "REQUEST_TIMEOUT"
                  ? "Request timed out"
                  : error.code === "RATE_LIMITED"
                    ? "Please wait"
                  : "Couldn’t complete that request",
            message:
              error.code === "RATE_LIMITED" && error.retryAfterSeconds
                ? `Try again in ${error.retryAfterSeconds} seconds.`
                : error.message,
            retryable: error.retryable,
          });
        } else if (error instanceof TypeError) {
          failTurn(
            turn,
            createAssistantNetworkError(
              "The network connection was interrupted. Your partial response was preserved.",
            ),
          );
        } else {
          failTurn(turn, createAssistantMalformedStreamError());
        }
      }
    },
    [failTurn, processStreamEvent, updateRequestState],
  );

  useEffect(
    () => () => {
      activeRequestRef.current?.controller.abort();
      if (textFrameRef.current !== null) {
        window.cancelAnimationFrame(textFrameRef.current);
      }
    },
    [],
  );

  const openAssistant = useCallback((opener: HTMLButtonElement) => {
    openerRef.current = opener;
    setHasOpened(true);
    setIsOpen(true);
  }, []);

  const closeAssistant = useCallback(() => {
    setIsOpen(false);
    window.requestAnimationFrame(() => {
      const opener = openerRef.current;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    });
  }, []);

  const setPreviewScenario = useCallback(
    async (scenario: AssistantPreviewScenario) => {
      if (!previewMode) return;
      const requestId = fixtureRequestRef.current + 1;
      fixtureRequestRef.current = requestId;
      const { assistantFixtureScenarios } = await import("./fixtures");
      if (requestId !== fixtureRequestRef.current) return;
      const fixture = assistantFixtureScenarios[scenario];
      setPreviewScenarioState(scenario);
      setMessages(fixture.messages);
      submissionLockRef.current = false;
      lastAcceptedDraftRef.current = null;
      updateRequestState(fixture.requestState ?? "idle");
      setAnnouncement(fixture.announcement ?? "");
    },
    [previewMode, updateRequestState],
  );

  const submitMessage = useCallback(() => {
    const text = draft.trim();
    if (
      !canAcceptAssistantSubmission({
        draft: text,
        state: requestStateRef.current,
        transportEnabled: true,
        submissionLocked: submissionLockRef.current,
        lastAcceptedDraft: lastAcceptedDraftRef.current,
      })
    ) {
      return;
    }

    submissionLockRef.current = true;
    lastAcceptedDraftRef.current = text;
    setDraft("");

    if (previewMode) {
      updateRequestState("submitting");
      setMessages((current) => [
        ...current,
        { id: nextMessageId("preview-user"), role: "user", parts: [{ type: "text", text }] },
        {
          id: nextMessageId("preview-assistant"),
          role: "assistant",
          parts: [
            {
              type: "text",
              text: "Development fixture response only. No live Taxi Reserve data was searched or changed.",
            },
          ],
        },
      ]);
      setAnnouncement("Fixture response complete");
      updateRequestState("idle");
      queueMicrotask(() => {
        submissionLockRef.current = false;
        lastAcceptedDraftRef.current = null;
      });
      return;
    }

    const turn: AssistantFailedTurn = {
      userMessageId: nextMessageId("user"),
      assistantMessageId: nextMessageId("assistant"),
      text,
      context: buildAssistantConversationContext(messages),
    };
    void runLiveTurn(turn, true);
  }, [draft, messages, previewMode, runLiveTurn, updateRequestState]);

  const stopMessage = useCallback(() => {
    const active = activeRequestRef.current;
    if (!active || !isAssistantBusy(requestStateRef.current)) return;
    active.stopped = true;
    active.controller.abort(new DOMException("Response stopped", "AbortError"));
    flushTextBuffer(active.assistantMessageId);
    updateAssistantMessage(active.assistantMessageId, markAssistantMessageStopped);
    lastFailedTurnRef.current = null;
    settleTurn(active.assistantMessageId, "idle");
    setAnnouncement("Assistant response stopped");
  }, [flushTextBuffer, settleTurn, updateAssistantMessage]);

  const retryMessage = useCallback(() => {
    if (submissionLockRef.current || isAssistantBusy(requestStateRef.current)) return;

    if (previewMode) {
      submissionLockRef.current = true;
      updateRequestState("submitting");
      setMessages((current) => [
        ...disablePreviousRetries(current),
        {
          id: nextMessageId("preview-retry"),
          role: "assistant",
          parts: [{ type: "text", text: "Development retry fixture complete." }],
        },
      ]);
      setAnnouncement("Fixture retry complete");
      updateRequestState("idle");
      queueMicrotask(() => {
        submissionLockRef.current = false;
      });
      return;
    }

    const turn = lastFailedTurnRef.current;
    if (!turn) return;
    submissionLockRef.current = true;
    void runLiveTurn(turn, false);
  }, [previewMode, runLiveTurn, updateRequestState]);

  const value = useMemo<AssistantContextValue>(
    () => ({
      isOpen,
      previewMode,
      draft,
      messages,
      requestState,
      announcement,
      previewScenario,
      openAssistant,
      closeAssistant,
      setDraft: updateDraft,
      setPreviewScenario,
      submitMessage,
      stopMessage,
      retryMessage,
    }),
    [
      announcement,
      closeAssistant,
      draft,
      requestState,
      isOpen,
      messages,
      openAssistant,
      previewMode,
      previewScenario,
      retryMessage,
      setPreviewScenario,
      stopMessage,
      submitMessage,
      updateDraft,
    ],
  );

  return (
    <AssistantContext.Provider value={value}>
      {children}
      {hasOpened && isOpen ? <AssistantDialog /> : null}
    </AssistantContext.Provider>
  );
}
