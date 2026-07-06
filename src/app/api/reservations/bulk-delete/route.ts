import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";

type Body = { ids: string[] };

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Body | undefined;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ids = Array.isArray(body?.ids)
    ? body!.ids.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];

  if (ids.length === 0) {
    return NextResponse.json({ error: "No ids to delete" }, { status: 400 });
  }
  if (ids.length > 100) {
    return NextResponse.json({ error: "Too many ids" }, { status: 400 });
  }

  const result = await prisma.reservation.updateMany({
    where: {
      id: { in: ids },
      userEmail: email,
      isDeleted: false,
    },
    data: { isDeleted: true },
  });

  if (result.count > 0) {
    await logActivity({
      action: "reservation_deleted",
      entityType: "reservation",
      userEmail: email,
      metadata: { deletionType: "soft_bulk", count: result.count },
    });
  }

  return NextResponse.json({ ok: true, deleted: result.count });
}
