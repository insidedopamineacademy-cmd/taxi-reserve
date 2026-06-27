import { NextResponse } from "next/server";
import { EmailConfigError } from "@/lib/emails/config";
import { getEmailInboxAccess } from "@/lib/emails/permissions";
import { syncInbox } from "@/lib/emails/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const access = await getEmailInboxAccess();
  if (!access.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    return NextResponse.json(await syncInbox());
  } catch (error) {
    if (error instanceof EmailConfigError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("Email inbox sync failed", error);
    return NextResponse.json(
      { error: "Inbox sync failed. Your existing emails were not changed." },
      { status: 502 },
    );
  }
}
