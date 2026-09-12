export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { changePasswordAndRevokeOthers } from "@/lib/security/sessionCore";
import { requireTrustedSecurityRequest, securityFailure } from "@/lib/security/http";

export async function POST(req: Request) {
  try { requireTrustedSecurityRequest(req); } catch (error) { return securityFailure(error); }
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email || !session?.id || !session.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role === "ADMIN") {
    const unlockedUntil = session.settingsUnlockedUntil ? new Date(session.settingsUnlockedUntil) : null;
    if (!unlockedUntil || !Number.isFinite(unlockedUntil.getTime()) || unlockedUntil <= new Date()) {
      return NextResponse.json({ error: "Unlock protected settings to continue.", code: "SETTINGS_LOCKED" }, { status: 423 });
    }
  }

  const { currentPassword, newPassword } = await req.json().catch(() => ({}));
  if (typeof currentPassword !== "string" || typeof newPassword !== "string" || !currentPassword || !newPassword) return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  if (String(newPassword).length < 8) return NextResponse.json({ error: "Password too short" }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.password) return NextResponse.json({ error: "No password set" }, { status: 400 });

  const ok = await bcrypt.compare(currentPassword, user.password);
  if (!ok) return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });

  const hash = await bcrypt.hash(newPassword, 12);
  try {
    await changePasswordAndRevokeOthers(prisma, { sid: session.id, sub: session.user.id }, user.password, hash);
  } catch (error) { return securityFailure(error); }

  return NextResponse.json({ ok: true });
}
