export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { cleanupDeviceSessions } from "@/lib/security/sessionCore";
import { securityFailure, securityJson } from "@/lib/security/http";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return securityJson({ error: "Session cleanup is not configured." }, 503);
  const expected = Buffer.from(`Bearer ${secret}`);
  const provided = Buffer.from(request.headers.get("authorization") ?? "");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return securityJson({ error: "Unauthorized" }, 401);
  try { return securityJson(await cleanupDeviceSessions(prisma)); }
  catch (error) { return securityFailure(error); }
}
