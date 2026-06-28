type MailConnectionConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  secure: boolean;
};

type EmailTransport = "imap" | "smtp";

export type EmailConfigStatus = {
  imapHost: boolean;
  imapPort: boolean;
  imapUser: boolean;
  imapPassword: boolean;
  smtpHost: boolean;
  smtpPort: boolean;
  smtpUser: boolean;
  smtpPassword: boolean;
  allowedUsersConfigured: boolean;
  imapConfigured: boolean;
  smtpConfigured: boolean;
  emailServiceConfigured: boolean;
};

export class EmailConfigError extends Error {
  readonly transport: EmailTransport;

  constructor(transport: EmailTransport, message?: string) {
    super(
      message ??
        (transport === "imap"
          ? "Inbox sync is not configured. Check the server-side IMAP settings."
          : "Email sending is not configured. Check the server-side SMTP settings."),
    );
    this.name = "EmailConfigError";
    this.transport = transport;
  }
}

function present(name: string) {
  return Boolean(process.env[name]?.trim());
}

function validPort(name: string) {
  const raw = process.env[name]?.trim();
  if (!raw) return false;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

function required(name: string, transport: EmailTransport) {
  const value = process.env[name]?.trim();
  if (!value) throw new EmailConfigError(transport);
  return value;
}

function port(name: string, transport: EmailTransport) {
  const raw = required(name, transport);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new EmailConfigError(
      transport,
      transport === "imap"
        ? "Inbox sync is not configured because the IMAP port is invalid."
        : "Email sending is not configured because the SMTP port is invalid.",
    );
  }
  return value;
}

export function getEmailConfigStatus(): EmailConfigStatus {
  const imapHost = present("IMAP_HOST");
  const imapPort = validPort("IMAP_PORT");
  const imapUser = present("IMAP_USER");
  const imapPassword = present("IMAP_PASSWORD");
  const smtpHost = present("SMTP_HOST");
  const smtpPort = validPort("SMTP_PORT");
  const smtpUser = present("SMTP_USER");
  const smtpPassword = present("SMTP_PASSWORD");
  const allowedUsersConfigured = (process.env.EMAIL_INBOX_ALLOWED_USERS ?? "")
    .split(",")
    .some((email) => Boolean(email.trim()));
  const imapConfigured = imapHost && imapPort && imapUser && imapPassword;
  const smtpConfigured = smtpHost && smtpPort && smtpUser && smtpPassword;

  return {
    imapHost,
    imapPort,
    imapUser,
    imapPassword,
    smtpHost,
    smtpPort,
    smtpUser,
    smtpPassword,
    allowedUsersConfigured,
    imapConfigured,
    smtpConfigured,
    emailServiceConfigured: imapConfigured && smtpConfigured,
  };
}

export function getImapConfig(): MailConnectionConfig {
  const imapPort = port("IMAP_PORT", "imap");
  return {
    host: required("IMAP_HOST", "imap"),
    port: imapPort,
    user: required("IMAP_USER", "imap"),
    password: required("IMAP_PASSWORD", "imap"),
    secure: imapPort === 993,
  };
}

export function getSmtpConfig(): MailConnectionConfig {
  const smtpPort = port("SMTP_PORT", "smtp");
  return {
    host: required("SMTP_HOST", "smtp"),
    port: smtpPort,
    user: required("SMTP_USER", "smtp"),
    password: required("SMTP_PASSWORD", "smtp"),
    secure: smtpPort === 465,
  };
}

export function getEmailInitialSyncLimit() {
  const configured = Number(process.env.EMAIL_INITIAL_SYNC_LIMIT ?? "100");
  if (!Number.isInteger(configured) || configured < 1) return 100;
  return Math.min(configured, 5000);
}
