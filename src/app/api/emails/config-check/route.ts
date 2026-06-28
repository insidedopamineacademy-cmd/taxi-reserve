import { NextResponse } from "next/server";
import { getEmailConfigStatus } from "@/lib/emails/config";
import { getEmailInboxAccess } from "@/lib/emails/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const access = await getEmailInboxAccess();
  if (!access.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const status = getEmailConfigStatus();
  return NextResponse.json(
    {
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
      emailServiceConfigured: status.emailServiceConfigured,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
