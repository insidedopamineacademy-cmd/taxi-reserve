export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

type RouteContext = { params: Promise<{ id: string }> };

function parseDate(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number" && !(value instanceof Date)) {
    return null;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export async function PATCH(
  req: Request,
  { params }: RouteContext
) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await prisma.reminder.findFirst({
    where: { id, userEmail: email },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const data: Prisma.ReminderUpdateInput = {};
  if ("title" in body) {
    const title = String(body.title ?? "").trim().slice(0, 120);
    if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });
    data.title = title;
  }
  if ("note" in body) {
    const note = String(body.note ?? "").trim().slice(0, 2000);
    data.note = note || null;
  }
  if ("dueAt" in body) {
    const dueAt = parseDate(body.dueAt);
    if (!dueAt) return NextResponse.json({ error: "Invalid dueAt" }, { status: 400 });
    data.dueAt = dueAt;
  }
  if ("isDone" in body) data.isDone = Boolean(body.isDone);

  const item = await prisma.reminder.update({
    where: { id },
    data,
  });
  return NextResponse.json(item);
}

export async function DELETE(
  _req: Request,
  { params }: RouteContext
) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await prisma.reminder.deleteMany({ where: { id, userEmail: email } });
  if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
