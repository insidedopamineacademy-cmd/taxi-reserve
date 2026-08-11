export type AssistantErrorCode =
  | "UNAUTHENTICATED"
  | "ASSISTANT_DISABLED"
  | "INVALID_REQUEST"
  | "RATE_LIMITED"
  | "REQUEST_TIMEOUT"
  | "REQUEST_ABORTED"
  | "UNKNOWN_TOOL"
  | "TOOL_VALIDATION_FAILED"
  | "TOOL_LIMIT_EXCEEDED"
  | "UPSTREAM_UNAVAILABLE"
  | "INTERNAL_ERROR";

const assistantErrorDefinitions: Record<
  AssistantErrorCode,
  { status: number; message: string; retryable: boolean }
> = {
  UNAUTHENTICATED: {
    status: 401,
    message: "Sign in to use the assistant.",
    retryable: false,
  },
  ASSISTANT_DISABLED: {
    status: 404,
    message: "The assistant is not available.",
    retryable: false,
  },
  INVALID_REQUEST: {
    status: 400,
    message: "The assistant request is invalid.",
    retryable: false,
  },
  RATE_LIMITED: {
    status: 429,
    message: "The assistant is temporarily busy. Try again shortly.",
    retryable: true,
  },
  REQUEST_TIMEOUT: {
    status: 504,
    message: "The assistant request timed out.",
    retryable: true,
  },
  REQUEST_ABORTED: {
    status: 499,
    message: "The assistant request was stopped.",
    retryable: false,
  },
  UNKNOWN_TOOL: {
    status: 502,
    message: "The assistant requested an unsupported operation.",
    retryable: true,
  },
  TOOL_VALIDATION_FAILED: {
    status: 502,
    message: "The assistant could not safely validate that operation.",
    retryable: true,
  },
  TOOL_LIMIT_EXCEEDED: {
    status: 502,
    message: "The assistant reached the lookup limit for this turn.",
    retryable: true,
  },
  UPSTREAM_UNAVAILABLE: {
    status: 503,
    message: "The assistant is temporarily unavailable.",
    retryable: true,
  },
  INTERNAL_ERROR: {
    status: 500,
    message: "The assistant could not complete the request.",
    retryable: true,
  },
};

export class AssistantTransportError extends Error {
  constructor(
    readonly code: AssistantErrorCode,
    options?: ErrorOptions,
  ) {
    super(assistantErrorDefinitions[code].message, options);
    this.name = "AssistantTransportError";
  }
}

export function getAssistantErrorDefinition(code: AssistantErrorCode) {
  return assistantErrorDefinitions[code];
}
