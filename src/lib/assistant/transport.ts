import {
  AssistantTransportError,
  getAssistantErrorDefinition,
  type AssistantErrorCode,
} from "./errors.ts";
import {
  ASSISTANT_STREAM_CONTENT_TYPE,
  encodeAssistantStreamEvent,
  type AssistantStreamEvent,
} from "./stream-protocol.ts";
import type {
  AssistantConversationEntry,
  AssistantModelUsage,
} from "./tool-loop.ts";
import type {
  AssistantAdmissionDecision,
  AssistantAdmissionLease,
} from "./admission-core.ts";
import {
  DEFAULT_ASSISTANT_MAX_INPUT_CHARS,
  MAX_ASSISTANT_MAX_INPUT_CHARS,
} from "./config.ts";
import type { ReservationAccessContext } from "../reservations/assistant-read-core.ts";

export const ASSISTANT_MAX_MESSAGE_LENGTH = DEFAULT_ASSISTANT_MAX_INPUT_CHARS;
export const ASSISTANT_MAX_CONTEXT_ENTRIES = 6;
export const ASSISTANT_MAX_CONTEXT_ENTRY_LENGTH = 1_000;
export const ASSISTANT_MAX_CONTEXT_CHARACTERS = 4_000;
// JSON may escape one UTF-16 code unit into six ASCII bytes. Size the hard byte
// ceiling from the bounded message and context contracts, with fixed overhead.
export const ASSISTANT_MAX_REQUEST_BYTES =
  (MAX_ASSISTANT_MAX_INPUT_CHARS + ASSISTANT_MAX_CONTEXT_CHARACTERS) * 6 + 8 * 1_024;

type AssistantTransportRunResult = {
  upstreamResponseId?: string;
};

export type AssistantTransportLog = {
  requestId: string;
  userId?: string;
  role?: ReservationAccessContext["role"];
  startedAt: string;
  endedAt: string;
  durationMs: number;
  outcome: "success" | "failure";
  code?: AssistantErrorCode;
  model?: string;
  toolNames: string[];
  toolCallCount: number;
  resultCounts: Record<string, number>;
  tokenUsage?: AssistantModelUsage;
  upstreamResponseId?: string;
};

export type AssistantTransportDependencies = {
  isEnabled(): boolean;
  isAllowed?(context: ReservationAccessContext): boolean;
  getAuthContext(): Promise<ReservationAccessContext | null>;
  admit?(
    context: ReservationAccessContext,
    nowMs: number,
  ): AssistantAdmissionDecision;
  run(input: {
    message: string;
    context: AssistantConversationEntry[];
    authContext: ReservationAccessContext;
    signal: AbortSignal;
    emit(event: AssistantStreamEvent): void;
    observeToolCall?(toolName: string): void;
    observeToolResult?(toolName: string, resultCount: number): void;
    observeModelUsage?(usage: AssistantModelUsage): void;
  }): Promise<AssistantTransportRunResult>;
  getTimeoutMs(): number;
  getMaxInputChars?(): number;
  getModelName?(): string;
  createRequestId(): string;
  now?(): number;
  log?(event: AssistantTransportLog): void;
};

function json(body: unknown, status: number, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      pragma: "no-cache",
      vary: "Cookie",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

function errorResponse(
  code: AssistantErrorCode,
  requestId: string,
  retryAfterSeconds?: number,
) {
  const definition = getAssistantErrorDefinition(code);
  return json(
    {
      error: {
        code,
        message: definition.message,
        retryable: definition.retryable,
        requestId,
        ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
      },
    },
    definition.status,
    retryAfterSeconds
      ? { "retry-after": String(retryAfterSeconds) }
      : undefined,
  );
}

function parseContext(value: unknown): AssistantConversationEntry[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > ASSISTANT_MAX_CONTEXT_ENTRIES) {
    throw new AssistantTransportError("INVALID_REQUEST");
  }

  let totalCharacters = 0;
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new AssistantTransportError("INVALID_REQUEST");
    }
    const item = entry as Record<string, unknown>;
    if (
      Object.keys(item).length !== 2 ||
      !(item.role === "user" || item.role === "assistant") ||
      typeof item.content !== "string"
    ) {
      throw new AssistantTransportError("INVALID_REQUEST");
    }
    const content = item.content.trim();
    totalCharacters += content.length;
    if (
      !content ||
      content.length > ASSISTANT_MAX_CONTEXT_ENTRY_LENGTH ||
      totalCharacters > ASSISTANT_MAX_CONTEXT_CHARACTERS
    ) {
      throw new AssistantTransportError("INVALID_REQUEST");
    }
    return { role: item.role, content };
  });
}

export async function parseAssistantRequest(
  request: Request,
  maxMessageLength = ASSISTANT_MAX_MESSAGE_LENGTH,
) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > ASSISTANT_MAX_REQUEST_BYTES) {
    throw new AssistantTransportError("INVALID_REQUEST");
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > ASSISTANT_MAX_REQUEST_BYTES) {
    throw new AssistantTransportError("INVALID_REQUEST");
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new AssistantTransportError("INVALID_REQUEST");
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AssistantTransportError("INVALID_REQUEST");
  }

  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => key !== "message" && key !== "context")) {
    throw new AssistantTransportError("INVALID_REQUEST");
  }
  if (typeof input.message !== "string") {
    throw new AssistantTransportError("INVALID_REQUEST");
  }

  const message = input.message.trim();
  if (!message || message.length > maxMessageLength) {
    throw new AssistantTransportError("INVALID_REQUEST");
  }

  return { message, context: parseContext(input.context) };
}

export async function handleAssistantChatRequest(
  request: Request,
  dependencies: AssistantTransportDependencies,
) {
  const requestId = dependencies.createRequestId();
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  let context: ReservationAccessContext | null = null;
  let lease: AssistantAdmissionLease | null = null;
  let model: string | undefined;
  const toolNames = new Set<string>();
  let toolCallCount = 0;
  const resultCounts: Record<string, number> = {};
  let tokenUsage: AssistantModelUsage | undefined;

  const log = (
    outcome: "success" | "failure",
    details: { code?: AssistantErrorCode; upstreamResponseId?: string } = {},
  ) => {
    const endedAt = now();
    dependencies.log?.({
      requestId,
      userId: context?.userId,
      role: context?.role,
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      durationMs: Math.max(0, endedAt - startedAt),
      outcome,
      model,
      toolNames: [...toolNames],
      toolCallCount,
      resultCounts: { ...resultCounts },
      tokenUsage,
      ...details,
    });
  };

  try {
    if (request.signal.aborted) {
      log("failure", { code: "REQUEST_ABORTED" });
      return errorResponse("REQUEST_ABORTED", requestId);
    }

    context = await dependencies.getAuthContext();
    if (!context) {
      log("failure", { code: "UNAUTHENTICATED" });
      return errorResponse("UNAUTHENTICATED", requestId);
    }
    if (!dependencies.isEnabled()) {
      log("failure", { code: "ASSISTANT_DISABLED" });
      return errorResponse("ASSISTANT_DISABLED", requestId);
    }
    if (dependencies.isAllowed && !dependencies.isAllowed(context)) {
      log("failure", { code: "ASSISTANT_DISABLED" });
      return errorResponse("ASSISTANT_DISABLED", requestId);
    }

    const parsed = await parseAssistantRequest(
      request,
      dependencies.getMaxInputChars?.() ?? ASSISTANT_MAX_MESSAGE_LENGTH,
    );
    const admission = dependencies.admit?.(context, now());
    if (admission && !admission.allowed) {
      log("failure", { code: "RATE_LIMITED" });
      return errorResponse("RATE_LIMITED", requestId, admission.retryAfterSeconds);
    }
    lease = admission ?? null;
    try {
      model = dependencies.getModelName?.();
    } catch {
      // Model validation remains authoritative inside the provider adapter. Logging
      // must never make a request fail earlier or disclose configuration details.
    }
    const timeoutMs = dependencies.getTimeoutMs();
    const controller = new AbortController();
    const encoder = new TextEncoder();
    let timedOut = false;
    let closed = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const abortFromRequest = () => controller.abort(request.signal.reason);
    request.signal.addEventListener("abort", abortFromRequest, { once: true });
    if (request.signal.aborted) abortFromRequest();

    const body = new ReadableStream<Uint8Array>({
      start(streamController) {
        const emit = (event: AssistantStreamEvent) => {
          if (closed || (controller.signal.aborted && !timedOut)) return;
          streamController.enqueue(encoder.encode(encodeAssistantStreamEvent(event)));
        };

        timeout = setTimeout(() => {
          timedOut = true;
          controller.abort(new DOMException("Assistant request timed out", "TimeoutError"));
        }, timeoutMs);

        void (async () => {
          try {
            const result = await dependencies.run({
              message: parsed.message,
              context: parsed.context,
              authContext: context as ReservationAccessContext,
              signal: controller.signal,
              emit,
              observeToolCall(toolName) {
                toolCallCount += 1;
                toolNames.add(toolName);
              },
              observeToolResult(toolName, resultCount) {
                resultCounts[toolName] =
                  (resultCounts[toolName] ?? 0) + Math.max(0, resultCount);
              },
              observeModelUsage(usage) {
                tokenUsage = {
                  inputTokens: (tokenUsage?.inputTokens ?? 0) + usage.inputTokens,
                  outputTokens: (tokenUsage?.outputTokens ?? 0) + usage.outputTokens,
                  totalTokens: (tokenUsage?.totalTokens ?? 0) + usage.totalTokens,
                };
              },
            });
            if (controller.signal.aborted) throw controller.signal.reason;
            emit({ type: "assistant.complete", requestId });
            log("success", { upstreamResponseId: result.upstreamResponseId });
          } catch (error) {
            const code: AssistantErrorCode = timedOut
              ? "REQUEST_TIMEOUT"
              : request.signal.aborted || controller.signal.aborted
                ? "REQUEST_ABORTED"
                : error instanceof AssistantTransportError
                  ? error.code
                  : "INTERNAL_ERROR";
            if (code !== "REQUEST_ABORTED") {
              const definition = getAssistantErrorDefinition(code);
              emit({
                type: "assistant.error",
                error: {
                  code,
                  message: definition.message,
                  retryable: definition.retryable,
                  requestId,
                },
              });
            }
            log("failure", { code });
          } finally {
            if (timeout) clearTimeout(timeout);
            lease?.release();
            lease = null;
            request.signal.removeEventListener("abort", abortFromRequest);
            if (!closed) {
              closed = true;
              streamController.close();
            }
          }
        })();
      },
      cancel(reason) {
        closed = true;
        controller.abort(reason);
        if (timeout) clearTimeout(timeout);
        lease?.release();
        lease = null;
        request.signal.removeEventListener("abort", abortFromRequest);
      },
    });

    return new Response(body, {
      status: 200,
      headers: {
        "content-type": ASSISTANT_STREAM_CONTENT_TYPE,
        "cache-control": "no-store, no-transform",
        pragma: "no-cache",
        vary: "Cookie",
        "x-accel-buffering": "no",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    lease?.release();
    lease = null;
    const code: AssistantErrorCode = request.signal.aborted
      ? "REQUEST_ABORTED"
      : error instanceof AssistantTransportError
        ? error.code
        : "INTERNAL_ERROR";
    log("failure", { code });
    return errorResponse(code, requestId);
  }
}
