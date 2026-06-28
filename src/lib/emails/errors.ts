import "server-only";

export type MailFailureKind =
  | "authentication"
  | "timeout"
  | "dns"
  | "tls"
  | "refused"
  | "closed"
  | "database"
  | "unknown";

export class EmailOperationTimeoutError extends Error {
  constructor() {
    super("Email operation timed out");
    this.name = "EmailOperationTimeoutError";
  }
}

function errorRecord(error: unknown): Record<string, unknown> {
  return error && typeof error === "object" ? (error as Record<string, unknown>) : {};
}

function errorText(error: unknown) {
  const record = errorRecord(error);
  return [record.name, record.code, record.responseCode, record.message, record.response]
    .filter((value): value is string | number => typeof value === "string" || typeof value === "number")
    .join(" ")
    .toLowerCase();
}

export function classifyMailFailure(error: unknown): MailFailureKind {
  const record = errorRecord(error);
  const text = errorText(error);

  if (/prismaclient|\bp\d{4}\b/.test(text)) return "database";
  if (
    error instanceof EmailOperationTimeoutError ||
    /timeout|timed out|etimedout|esockettimedout/.test(text)
  ) {
    return "timeout";
  }
  if (
    record.authenticationFailed === true ||
    /eauth|authenticationfailed|authentication failed|invalid (login|credentials)|login failed/.test(text)
  ) {
    return "authentication";
  }
  if (/enotfound|eai_again|dns|getaddrinfo/.test(text)) return "dns";
  if (/certificate|cert_|tls|ssl|self signed|unable to verify/.test(text)) return "tls";
  if (/econnrefused|connection refused/.test(text)) return "refused";
  if (/econnreset|epipe|connection closed|socket closed|unexpected close/.test(text)) return "closed";
  return "unknown";
}

export function safeMailFailureDetail(service: "IMAP" | "SMTP", error: unknown) {
  switch (classifyMailFailure(error)) {
    case "authentication":
      return "Authentication failed. Check the mailbox username and password.";
    case "timeout":
      return `${service} connection timed out.`;
    case "dns":
      return `${service} server address could not be resolved.`;
    case "tls":
      return `${service} secure connection failed.`;
    case "refused":
      return `${service} server refused the connection.`;
    case "closed":
      return `${service} connection closed unexpectedly.`;
    case "database":
      return "The inbox database operation failed.";
    default:
      return `${service} connection test failed.`;
  }
}

export function logMailFailure(context: string, error: unknown) {
  const record = errorRecord(error);
  console.error(context, {
    name: typeof record.name === "string" ? record.name : "Error",
    code: typeof record.code === "string" ? record.code : undefined,
    responseCode:
      typeof record.responseCode === "number" || typeof record.responseCode === "string"
        ? record.responseCode
        : undefined,
    command: typeof record.command === "string" ? record.command : undefined,
    kind: classifyMailFailure(error),
  });
}

export async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.();
      reject(new EmailOperationTimeoutError());
    }, timeoutMs);
    timer.unref?.();
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
