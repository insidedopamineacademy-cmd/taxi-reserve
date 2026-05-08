export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";

type ReminderBody = {
  title?: unknown;
  note?: unknown;
  dueAt?: unknown;
};

async function requireEmail() {
  const session = await getServerSession(authOptions);
  return session?.user?.email ?? null;
}

function parseDueAt(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number" && !(value instanceof Date)) {
    return null;
  }
  const dueAt = new Date(value);
  return Number.isFinite(dueAt.getTime()) ? dueAt : null;
}

export async function GET() {
  const email = await requireEmail();
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const reminders = await prisma.reminder.findMany({
    where: { userEmail: email },
    orderBy: { dueAt: "asc" },
    take: 200,
    select: {
      id: true,
      title: true,
      note: true,
      dueAt: true,
      isDone: true,
      reservationId: true,
    },
  });

  return NextResponse.json(reminders);
}

export async function POST(req: Request) {
  const email = await requireEmail();
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as ReminderBody;
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : "";
  const dueAt = parseDueAt(body.dueAt);

  if (!title) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }
  if (!dueAt) {
    return NextResponse.json({ error: "Invalid dueAt" }, { status: 400 });
  }

  const reminder = await prisma.reminder.create({
    data: {
      userEmail: email,
      title,
      note: note || null,
      dueAt,
    },
    select: {
      id: true,
      title: true,
      note: true,
      dueAt: true,
      isDone: true,
      reservationId: true,
    },
  });

  return NextResponse.json(reminder, { status: 201 });
}
