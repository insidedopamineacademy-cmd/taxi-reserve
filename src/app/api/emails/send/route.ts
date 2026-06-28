import { NextResponse } from "next/server";
import { EmailConfigError } from "@/lib/emails/config";
import { isEmailInboxSchemaReady } from "@/lib/emails/database";
import { getEmailInboxAccess } from "@/lib/emails/permissions";
import { EmailSendInputError, sendThreadReply } from "@/lib/emails/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const access = await getEmailInboxAccess();
  if (!access.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!(await isEmailInboxSchemaReady())) {
    return NextResponse.json({ error: "Inbox database setup is incomplete." }, { status: 503 });
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (!input || typeof input !== "object") {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { threadId, body } = input as Record<string, unknown>;
  if (typeof threadId !== "string" || typeof body !== "string") {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    return NextResponse.json(await sendThreadReply(threadId, body));
  } catch (error) {
    if (error instanceof EmailSendInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof EmailConfigError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("Email reply failed", error);
    return NextResponse.json(
      { error: "Reply could not be sent. Please try again." },
      { status: 502 },
    );
  }
}
