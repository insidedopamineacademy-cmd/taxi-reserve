import { NextResponse } from "next/server";
import { getEmailConfigStatus } from "@/lib/emails/config";
import { getEmailConnectionHealth } from "@/lib/emails/health";
import { getEmailInboxAccess } from "@/lib/emails/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const access = await getEmailInboxAccess();
  if (!access.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const status = getEmailConfigStatus();
  const health = await getEmailConnectionHealth();
  return NextResponse.json(
    {
      env: {
        imapHost: status.imapHost,
        imapPort: status.imapPort,
        imapUser: status.imapUser,
        imapPassword: status.imapPassword,
        smtpHost: status.smtpHost,
        smtpPort: status.smtpPort,
        smtpUser: status.smtpUser,
        smtpPassword: status.smtpPassword,
        allowedUsersConfigured: status.allowedUsersConfigured,
        currentUserAllowed: access.allowed,
      },
      imap: health.imap,
      smtp: health.smtp,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
