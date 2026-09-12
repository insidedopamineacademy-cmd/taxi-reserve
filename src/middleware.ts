import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { decodeRegisteredToken } from "@/lib/security/token";

const publicPaths = new Set(["/login", "/favicon.ico", "/icon.png", "/apple-icon.png", "/robots.txt"]);
const machinePaths = new Set(["/api/admin/driver-subscriptions/run-monthly", "/api/admin/sessions/cleanup"]);
const gateBootstrapPrefix = "/api/admin/security-gate";

export default async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (publicPaths.has(path) || path.startsWith("/api/auth/") || path.startsWith("/_next/") || path.startsWith("/assistant/") || machinePaths.has(path)) return NextResponse.next();
  const isApi = path.startsWith("/api/");
  try {
    const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
    if (!secret) throw new Error("Authentication secret is missing");
    const encrypted = await getToken({ req: request, secret, raw: true });
    const token = encrypted ? await decodeRegisteredToken({ token: encrypted, secret }) : null;
    if (!token) {
      if (isApi) return NextResponse.json({ error: "Sign in again.", code: "UNAUTHORIZED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
      return NextResponse.redirect(new URL("/login?reason=session-ended", request.url));
    }
    const adminPath = ["/admin", "/drivers", "/commissions", "/payments", "/api/admin", "/api/drivers"].some(prefix => path === prefix || path.startsWith(prefix + "/"));
    if (adminPath && token.role !== "ADMIN") {
      return isApi ? NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 }) : NextResponse.redirect(new URL("/reservations", request.url));
    }
    const settingsUnlockedUntil = typeof token.settingsUnlockedUntil === "string"
      ? new Date(token.settingsUnlockedUntil)
      : null;
    const settingsUnlocked = Boolean(settingsUnlockedUntil && Number.isFinite(settingsUnlockedUntil.getTime()) && settingsUnlockedUntil > new Date());
    const needsSettingsGate = (path === "/admin" || path.startsWith("/admin/") || path === "/api/admin" || path.startsWith("/api/admin/"))
      && !path.startsWith(gateBootstrapPrefix);
    if (needsSettingsGate && !settingsUnlocked) {
      if (isApi) return NextResponse.json({ error: "Unlock protected settings to continue.", code: "SETTINGS_LOCKED" }, { status: 423, headers: { "Cache-Control": "private, no-store, max-age=0" } });
      const destination = `${path}${request.nextUrl.search}`;
      const settingsUrl = new URL("/settings", request.url);
      settingsUrl.searchParams.set("next", destination);
      return NextResponse.redirect(settingsUrl);
    }
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    return response;
  } catch {
    // Database outages fail closed without an endless login loop.
    return isApi
      ? NextResponse.json({ error: "Session verification is temporarily unavailable. Try again.", code: "SESSION_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } })
      : new NextResponse("Session verification is temporarily unavailable. Please reload to try again.", { status: 503, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });
  }
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"], runtime: "nodejs" };
