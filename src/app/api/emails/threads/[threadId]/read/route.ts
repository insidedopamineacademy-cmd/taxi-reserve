import { NextResponse } from "next/server";
import { getEmailInboxAccess } from "@/lib/emails/permissions";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const access = await getEmailInboxAccess();
  if (!access.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { threadId } = await params;
  if (!threadId || threadId.length > 128) {
    return NextResponse.json({ error: "Invalid thread." }, { status: 400 });
  }

  await prisma.emailThread.updateMany({ where: { id: threadId }, data: { unread: false } });
  return NextResponse.json({ ok: true });
}
