import { NextResponse } from "next/server";
import { EmailConfigError, getEmailConfigStatus } from "@/lib/emails/config";
import { isEmailInboxSchemaReady } from "@/lib/emails/database";
import { logMailFailure } from "@/lib/emails/errors";
import { getEmailInboxAccess } from "@/lib/emails/permissions";
import type { EmailSyncResult } from "@/lib/emails/progress";
import { syncInbox } from "@/lib/emails/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function failedSync(label: string, detail?: string): EmailSyncResult {
  return {
    ok: false,
    steps: [{ status: "error", label, detail }],
    summary: {
      foldersChecked: 0,
      foldersSynced: 0,
      messagesImported: 0,
      duplicatesSkipped: 0,
    },
  };
}

export async function POST() {
  const access = await getEmailInboxAccess();
  if (!access.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    if (!(await isEmailInboxSchemaReady())) {
      return NextResponse.json(
        failedSync(
          "Inbox database setup is incomplete",
          "Email sync is unavailable until the email tables are deployed.",
        ),
        { status: 503 },
      );
    }
    const imapConfigured = getEmailConfigStatus().imapConfigured;
    const result = await syncInbox();
    return NextResponse.json(result, { status: result.ok ? 200 : imapConfigured ? 502 : 503 });
  } catch (error) {
    if (error instanceof EmailConfigError) {
      return NextResponse.json(failedSync("Email configuration is incomplete", error.message), {
        status: 503,
      });
    }
    logMailFailure("Email inbox sync route failed", error);
    return NextResponse.json(
      failedSync(
        "Inbox sync failed",
        "The server could not complete the sync. Existing inbox data was preserved.",
      ),
      { status: 502 },
    );
  }
}
