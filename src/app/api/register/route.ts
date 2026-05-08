import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { name, email, password } = await req.json().catch(() => ({}));
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  const displayName = typeof name === "string" ? name.trim().slice(0, 100) : "";

  if (!normalizedEmail || typeof password !== "string") {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const exists = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (exists) {
    return NextResponse.json({ error: "Email already in use" }, { status: 400 });
  }

  const hash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: { name: displayName || null, email: normalizedEmail, password: hash },
  });

  return NextResponse.json({ id: user.id, email: user.email });
}
