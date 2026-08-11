import "server-only";

export const DEFAULT_ASSISTANT_REQUEST_TIMEOUT_MS = 30_000;
export const MIN_ASSISTANT_REQUEST_TIMEOUT_MS = 1_000;
export const MAX_ASSISTANT_REQUEST_TIMEOUT_MS = 120_000;
export const DEFAULT_ASSISTANT_MAX_REQUESTS_PER_MINUTE = 6;
export const MIN_ASSISTANT_MAX_REQUESTS_PER_MINUTE = 1;
export const MAX_ASSISTANT_MAX_REQUESTS_PER_MINUTE = 60;
export const DEFAULT_ASSISTANT_MAX_INPUT_CHARS = 2_000;
export const MIN_ASSISTANT_MAX_INPUT_CHARS = 100;
export const MAX_ASSISTANT_MAX_INPUT_CHARS = 4_000;
export const DEFAULT_ASSISTANT_MAX_OUTPUT_TOKENS = 1_200;
export const MIN_ASSISTANT_MAX_OUTPUT_TOKENS = 100;
export const MAX_ASSISTANT_MAX_OUTPUT_TOKENS = 4_000;
export const MAX_ASSISTANT_ALLOWED_EMAILS = 100;

export class AssistantConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssistantConfigurationError";
  }
}

function isTrue(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

function boundedInteger(
  name: string,
  raw: string | undefined,
  defaultValue: number,
  minimum: number,
  maximum: number,
) {
  if (!raw?.trim()) return defaultValue;

  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new AssistantConfigurationError(
      `${name} must be an integer from ${minimum} to ${maximum}.`,
    );
  }
  return value;
}

export function isAssistantEnabled() {
  return isTrue(process.env.AI_ASSISTANT_ENABLED);
}

export function isAssistantPreviewEnabled() {
  return process.env.NODE_ENV !== "production" && isTrue(process.env.AI_ASSISTANT_PREVIEW);
}

export function getAssistantRequestTimeoutMs() {
  return boundedInteger(
    "AI_ASSISTANT_REQUEST_TIMEOUT_MS",
    process.env.AI_ASSISTANT_REQUEST_TIMEOUT_MS,
    DEFAULT_ASSISTANT_REQUEST_TIMEOUT_MS,
    MIN_ASSISTANT_REQUEST_TIMEOUT_MS,
    MAX_ASSISTANT_REQUEST_TIMEOUT_MS,
  );
}

export function getAssistantMaxRequestsPerMinute() {
  return boundedInteger(
    "AI_ASSISTANT_MAX_REQUESTS_PER_MINUTE",
    process.env.AI_ASSISTANT_MAX_REQUESTS_PER_MINUTE,
    DEFAULT_ASSISTANT_MAX_REQUESTS_PER_MINUTE,
    MIN_ASSISTANT_MAX_REQUESTS_PER_MINUTE,
    MAX_ASSISTANT_MAX_REQUESTS_PER_MINUTE,
  );
}

export function getAssistantMaxInputChars() {
  return boundedInteger(
    "AI_ASSISTANT_MAX_INPUT_CHARS",
    process.env.AI_ASSISTANT_MAX_INPUT_CHARS,
    DEFAULT_ASSISTANT_MAX_INPUT_CHARS,
    MIN_ASSISTANT_MAX_INPUT_CHARS,
    MAX_ASSISTANT_MAX_INPUT_CHARS,
  );
}

export function getAssistantMaxOutputTokens() {
  return boundedInteger(
    "AI_ASSISTANT_MAX_OUTPUT_TOKENS",
    process.env.AI_ASSISTANT_MAX_OUTPUT_TOKENS,
    DEFAULT_ASSISTANT_MAX_OUTPUT_TOKENS,
    MIN_ASSISTANT_MAX_OUTPUT_TOKENS,
    MAX_ASSISTANT_MAX_OUTPUT_TOKENS,
  );
}

export function getAssistantAllowedEmails() {
  const raw = process.env.AI_ASSISTANT_ALLOWED_EMAILS?.trim();
  if (!raw) return null;

  const emails = [...new Set(raw.split(",").map((value) => value.trim().toLowerCase()))];
  if (
    emails.length > MAX_ASSISTANT_ALLOWED_EMAILS ||
    emails.some(
      (email) =>
        !email ||
        email.length > 320 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
    )
  ) {
    throw new AssistantConfigurationError(
      `AI_ASSISTANT_ALLOWED_EMAILS must contain at most ${MAX_ASSISTANT_ALLOWED_EMAILS} comma-separated email addresses.`,
    );
  }

  return new Set(emails);
}

export function isAssistantEmailAllowed(email: string | null | undefined) {
  const allowed = getAssistantAllowedEmails();
  if (!allowed) return true;
  return email ? allowed.has(email.trim().toLowerCase()) : false;
}

export function getAssistantModelName() {
  const model = process.env.AI_ASSISTANT_MODEL?.trim();
  if (!model || model.length > 100) {
    throw new AssistantConfigurationError("AI_ASSISTANT_MODEL is not configured correctly.");
  }
  return model;
}

export function getAssistantOpenAIConfig() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = getAssistantModelName();

  if (!apiKey) {
    throw new AssistantConfigurationError("OPENAI_API_KEY is not configured.");
  }
  return {
    apiKey,
    model,
    timeoutMs: getAssistantRequestTimeoutMs(),
  };
}
