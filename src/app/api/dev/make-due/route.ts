import { NextResponse } from "next/server";

export async function GET() {
  const status = process.env.NODE_ENV === "production" ? 404 : 403;
  return NextResponse.json({ ok: false, error: "Endpoint disabled" }, { status });
}
