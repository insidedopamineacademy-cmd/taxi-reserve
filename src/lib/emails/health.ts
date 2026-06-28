import "server-only";

import { ImapFlow } from "imapflow";
import nodemailer from "smtp-nodemailer";
import {
  getEmailConfigIssue,
  getEmailConfigStatus,
  getImapConfig,
  getSmtpConfig,
} from "@/lib/emails/config";
import {
  classifyMailFailure,
  logMailFailure,
  safeMailFailureDetail,
  withTimeout,
} from "@/lib/emails/errors";

const CONNECTION_TEST_TIMEOUT_MS = 12_000;

export type EmailConnectionHealth = {
  configured: boolean;
  connectionTested: boolean;
  connected: boolean;
  authenticated: boolean;
  error: string | null;
};

export type ImapConnectionHealth = EmailConnectionHealth & {
  mailboxesFound: string[];
};

function safeMailboxNames(mailboxes: Array<{ path: string; flags: Set<string> }>) {
  return mailboxes
    .filter((mailbox) => !mailbox.flags.has("\\Noselect"))
    .map((mailbox) => mailbox.path.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, 50);
}

async function checkImapHealth(): Promise<ImapConnectionHealth> {
  const status = getEmailConfigStatus();
  if (!status.imapConfigured) {
    return {
      configured: false,
      connectionTested: false,
      connected: false,
      authenticated: false,
      mailboxesFound: [],
      error: getEmailConfigIssue("imap"),
    };
  }

  const config = getImapConfig();
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    logger: false,
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 10_000,
  });
  let connected = false;
  let authenticated = false;

  try {
    await withTimeout(client.connect(), CONNECTION_TEST_TIMEOUT_MS, () => client.close());
    connected = true;
    authenticated = Boolean(client.authenticated);
    const mailboxes = await withTimeout(
      client.list(),
      CONNECTION_TEST_TIMEOUT_MS,
      () => client.close(),
    );
    return {
      configured: true,
      connectionTested: true,
      connected,
      authenticated,
      mailboxesFound: safeMailboxNames(mailboxes),
      error: null,
    };
  } catch (error) {
    const authenticationFailed = classifyMailFailure(error) === "authentication";
    logMailFailure("IMAP connection health check failed", error);
    return {
      configured: true,
      connectionTested: true,
      connected: connected || authenticationFailed,
      authenticated,
      mailboxesFound: [],
      error: safeMailFailureDetail("IMAP", error),
    };
  } finally {
    client.close();
  }
}

export async function getSmtpConnectionHealth(): Promise<EmailConnectionHealth> {
  const status = getEmailConfigStatus();
  if (!status.smtpConfigured) {
    return {
      configured: false,
      connectionTested: false,
      connected: false,
      authenticated: false,
      error: getEmailConfigIssue("smtp"),
    };
  }

  const config = getSmtpConfig();
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 10_000,
  });

  try {
    await withTimeout(transporter.verify(), CONNECTION_TEST_TIMEOUT_MS, () => transporter.close());
    return {
      configured: true,
      connectionTested: true,
      connected: true,
      authenticated: true,
      error: null,
    };
  } catch (error) {
    const authenticationFailed = classifyMailFailure(error) === "authentication";
    logMailFailure("SMTP connection health check failed", error);
    return {
      configured: true,
      connectionTested: true,
      connected: authenticationFailed,
      authenticated: false,
      error: safeMailFailureDetail("SMTP", error),
    };
  } finally {
    transporter.close();
  }
}

export async function getEmailConnectionHealth() {
  const [imap, smtp] = await Promise.all([checkImapHealth(), getSmtpConnectionHealth()]);
  return { imap, smtp };
}
