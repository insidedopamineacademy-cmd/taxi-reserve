type MailConnectionConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  secure: boolean;
};

export class EmailConfigError extends Error {
  constructor(message = "Email service is not configured") {
    super(message);
    this.name = "EmailConfigError";
  }
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new EmailConfigError();
  return value;
}

function port(name: string) {
  const value = Number(required(name));
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new EmailConfigError();
  }
  return value;
}

export function getImapConfig(): MailConnectionConfig {
  const imapPort = port("IMAP_PORT");
  return {
    host: required("IMAP_HOST"),
    port: imapPort,
    user: required("IMAP_USER"),
    password: required("IMAP_PASSWORD"),
    secure: imapPort === 993,
  };
}

export function getSmtpConfig(): MailConnectionConfig {
  const smtpPort = port("SMTP_PORT");
  return {
    host: required("SMTP_HOST"),
    port: smtpPort,
    user: required("SMTP_USER"),
    password: required("SMTP_PASSWORD"),
    secure: smtpPort === 465,
  };
}

export function getEmailInitialSyncLimit() {
  const configured = Number(process.env.EMAIL_INITIAL_SYNC_LIMIT ?? "100");
  if (!Number.isInteger(configured) || configured < 1) return 100;
  return Math.min(configured, 5000);
}
