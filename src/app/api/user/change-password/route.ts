export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { currentPassword, newPassword } = await req.json().catch(() => ({}));
  if (!currentPassword || !newPassword) return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  if (String(newPassword).length < 8) return NextResponse.json({ error: "Password too short" }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.password) return NextResponse.json({ error: "No password set" }, { status: 400 });

  const ok = await bcrypt.compare(currentPassword, user.password);
  if (!ok) return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });

  const hash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { email }, data: { password: hash } });

  return NextResponse.json({ ok: true });
}
