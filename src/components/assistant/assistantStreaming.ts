import type {
  AssistantConversationEntry,
} from "../../lib/assistant/tool-loop.ts";
import type { AssistantStreamEvent } from "../../lib/assistant/stream-protocol.ts";
import type {
  AssistantErrorKind,
  AssistantMessage,
  AssistantMessagePart,
} from "./types.ts";

export const ASSISTANT_CLIENT_CONTEXT_ENTRIES = 6;
export const ASSISTANT_CLIENT_CONTEXT_ENTRY_LENGTH = 1_000;
export const ASSISTANT_CLIENT_CONTEXT_CHARACTERS = 4_000;

export type AssistantFailedTurn = {
  userMessageId: string;
  assistantMessageId: string;
  text: string;
  context: AssistantConversationEntry[];
};

export function createPendingAssistantMessage(id: string): AssistantMessage {
  return {
    id,
    role: "assistant",
    parts: [{ type: "status", status: "thinking", label: "Thinking…" }],
  };
}

function withoutStatus(parts: AssistantMessagePart[]) {
  return parts.filter((part) => part.type !== "status");
}

function appendTextDelta(parts: AssistantMessagePart[], delta: string) {
  const next = withoutStatus(parts);
  if (!delta) return next;
  const textIndex = next.findIndex((part) => part.type === "text");
  if (textIndex >= 0) {
    return next.map((part, index) =>
      index === textIndex && part.type === "text"
        ? { ...part, text: part.text + delta }
        : part,
    );
  }

  const structuredIndex = next.findIndex((part) =>
    part.type === "reservation" ||
    part.type === "driver" ||
    part.type === "driver-financial-summary" ||
    part.type === "driver-transactions",
  );
  const insertAt = structuredIndex >= 0 ? structuredIndex : next.length;
  return [
    ...next.slice(0, insertAt),
    { type: "text" as const, text: delta },
    ...next.slice(insertAt),
  ];
}

function errorKind(code: string): AssistantErrorKind {
  if (code === "UNAUTHENTICATED") return "unauthorized";
  if (code === "REQUEST_TIMEOUT") return "timeout";
  if (code === "RATE_LIMITED") return "rate-limited";
  if (code === "INVALID_REQUEST" || code === "TOOL_VALIDATION_FAILED") {
    return "malformed";
  }
  return "generic";
}

export function createAssistantErrorPart(input: {
  code: string;
  message: string;
  retryable: boolean;
}): Extract<AssistantMessagePart, { type: "error" }> {
  const kind = errorKind(input.code);
  return {
    type: "error",
    kind,
    title:
      kind === "unauthorized"
        ? "Sign in required"
        : kind === "timeout"
          ? "Request timed out"
          : kind === "rate-limited"
            ? "Please wait"
          : kind === "malformed"
            ? "Couldn’t validate that request"
            : "Couldn’t complete that request",
    message: input.message,
    retryable: input.retryable,
  };
}

export function createAssistantNetworkError(message: string) {
  return {
    type: "error" as const,
    kind: "network" as const,
    title: "Connection lost",
    message,
    retryable: true,
  };
}

export function createAssistantMalformedStreamError() {
  return {
    type: "error" as const,
    kind: "malformed" as const,
    title: "Couldn’t complete that request",
    message: "The assistant response stream was invalid. Your partial response was preserved.",
    retryable: true,
  };
}

export function applyAssistantStreamEvent(
  message: AssistantMessage,
  event: AssistantStreamEvent,
): AssistantMessage {
  if (message.role !== "assistant") return message;

  if (event.type === "assistant.status") {
    return {
      ...message,
      parts: [
        ...withoutStatus(message.parts),
        { type: "status", status: event.status, label: event.label },
      ],
    };
  }
  if (event.type === "assistant.text.delta") {
    return { ...message, parts: appendTextDelta(message.parts, event.delta) };
  }
  if (event.type === "assistant.reservation_result") {
    const alreadyPresent = message.parts.some(
      (part) =>
        part.type === "reservation" && part.reservation.id === event.reservation.id,
    );
    return alreadyPresent
      ? message
      : {
          ...message,
          parts: [
            ...message.parts,
            { type: "reservation", reservation: event.reservation },
          ],
        };
  }
  if (event.type === "assistant.driver_result") {
    const alreadyPresent = message.parts.some(
      (part) => part.type === "driver" && part.driver.id === event.driver.id,
    );
    return alreadyPresent
      ? message
      : { ...message, parts: [...message.parts, { type: "driver", driver: event.driver }] };
  }
  if (event.type === "assistant.driver_financial_summary") {
    const alreadyPresent = message.parts.some(
      (part) => part.type === "driver-financial-summary" && part.summary.driver.id === event.summary.driver.id,
    );
    return alreadyPresent
      ? message
      : { ...message, parts: [...message.parts, { type: "driver-financial-summary", summary: event.summary }] };
  }
  if (event.type === "assistant.driver_transactions") {
    const key = [
      event.transactions.driver.id,
      event.transactions.transactionType,
      event.transactions.period.from,
      event.transactions.period.to,
      event.transactions.pageCursor,
    ].join(":");
    const alreadyPresent = message.parts.some((part) =>
      part.type === "driver-transactions" && [
        part.transactions.driver.id,
        part.transactions.transactionType,
        part.transactions.period.from,
        part.transactions.period.to,
        part.transactions.pageCursor,
      ].join(":") === key,
    );
    return alreadyPresent
      ? message
      : { ...message, parts: [...message.parts, { type: "driver-transactions", transactions: event.transactions }] };
  }
  if (event.type === "assistant.complete") {
    return { ...message, parts: withoutStatus(message.parts) };
  }
  return {
    ...message,
    parts: [
      ...withoutStatus(message.parts).filter((part) => part.type !== "error"),
      createAssistantErrorPart(event.error),
    ],
  };
}

export function markAssistantMessageStopped(message: AssistantMessage) {
  return {
    ...message,
    parts: [
      ...withoutStatus(message.parts).filter((part) => part.type !== "error"),
      { type: "interrupted" as const, message: "Response stopped" },
    ],
  };
}

export function markAssistantMessageFailed(
  message: AssistantMessage,
  error: Extract<AssistantMessagePart, { type: "error" }>,
) {
  return {
    ...message,
    parts: [
      ...withoutStatus(message.parts).filter((part) => part.type !== "error"),
      error,
    ],
  };
}

export function buildAssistantConversationContext(
  messages: AssistantMessage[],
): AssistantConversationEntry[] {
  const candidates = messages
    .map((message) => ({
      role: message.role,
      content: message.parts
        .filter((part): part is Extract<AssistantMessagePart, { type: "text" }> =>
          part.type === "text",
        )
        .map((part) => part.text)
        .join("\n")
        .trim(),
    }))
    .filter((entry) => entry.content.length > 0)
    .slice(-ASSISTANT_CLIENT_CONTEXT_ENTRIES);

  const accepted: AssistantConversationEntry[] = [];
  let total = 0;
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    const content = candidate.content.slice(0, ASSISTANT_CLIENT_CONTEXT_ENTRY_LENGTH);
    if (total + content.length > ASSISTANT_CLIENT_CONTEXT_CHARACTERS) continue;
    accepted.unshift({ role: candidate.role, content });
    total += content.length;
  }
  return accepted;
}

export function disablePreviousRetries(messages: AssistantMessage[]) {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) =>
      part.type === "error" ? { ...part, retryable: false } : part,
    ),
  }));
}
