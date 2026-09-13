import "server-only";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { SecurityError } from "./policy";
import {
  evaluateSecurityRequest,
  SECURITY_REQUEST_HEADER,
  SECURITY_REQUEST_MARKER,
} from "./securityRequestGuard";

export async function requireSecuritySession(options: { admin?: boolean; settingsUnlocked?: boolean } = {}) {
  const session = await getServerSession(authOptions);
  if (!session?.id || !session.user?.id) throw new SecurityError(401, "UNAUTHORIZED", "Sign in again.");
  if (options.admin && session.user.role !== "ADMIN") throw new SecurityError(403, "FORBIDDEN", "Administrator access required.");
  if (options.settingsUnlocked) {
    const unlockedUntil = session.settingsUnlockedUntil ? new Date(session.settingsUnlockedUntil) : null;
    if (!unlockedUntil || !Number.isFinite(unlockedUntil.getTime()) || unlockedUntil <= new Date()) {
      throw new SecurityError(423, "SETTINGS_LOCKED", "Unlock protected settings to continue.");
    }
  }
  return { session, identity: { sid: session.id, sub: session.user.id } };
}

function safeOrigin(value: string | null) {
  if (value === null) return null;
  try { return new URL(value).origin; } catch { return "invalid"; }
}

function safeHost(value: string | null | undefined) {
  if (!value) return null;
  return /^[a-z0-9.:-]{1,255}$/i.test(value) ? value : "invalid";
}

function requestTargetOrigin(request: Request) {
  const url = new URL(request.url);
  const host = safeHost(request.headers.get("host"));
  return host && host !== "invalid" ? new URL(`${url.protocol}//${host}`).origin : url.origin;
}

export function requireTrustedSecurityRequest(request: Request, diagnosticLabel?: string) {
  // Host is the authority the browser requested and the platform routed. The
  // request URL and NEXTAUTH_URL can both be canonicalized to a different alias.
  // Forwarded host/protocol headers are deliberately ignored.
  const expectedOrigin = requestTargetOrigin(request);
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const secFetchSite = request.headers.get("sec-fetch-site");
  const marker = request.headers.get(SECURITY_REQUEST_HEADER);
  const decision = evaluateSecurityRequest({
    expectedOrigin,
    origin,
    referer,
    secFetchSite,
    marker,
  });
  if (diagnosticLabel) {
    const metadata = {
      event: "SECURITY_REQUEST_PROVENANCE",
      endpoint: diagnosticLabel,
      outcome: decision.trusted ? "accepted" : "rejected",
      branch: decision.branch,
      method: request.method,
      contentType: request.headers.get("content-type")?.split(";", 1)[0] ?? null,
      host: safeHost(request.headers.get("host")),
      requestOrigin: expectedOrigin,
      frameworkRequestOrigin: new URL(request.url).origin,
      configuredAuthOrigin: safeOrigin(process.env.NEXTAUTH_URL ?? null),
      deploymentHost: safeHost(process.env.VERCEL_URL),
      originPresent: origin !== null,
      origin: safeOrigin(origin),
      refererPresent: referer !== null,
      refererOrigin: safeOrigin(referer),
      secFetchSite,
      markerPresent: marker !== null,
      markerValid: marker === SECURITY_REQUEST_MARKER,
    };
    if (decision.trusted) console.info("Security request provenance.", metadata);
    else console.warn("Security request provenance rejected.", metadata);
  }
  if (!decision.trusted) {
    throw new SecurityError(403, "INVALID_ORIGIN", "This action must be submitted from Taxi Reserve.");
  }
}

export async function readSecurityJson(request: Request, maxBytes = 4096) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new SecurityError(415, "INVALID_CONTENT_TYPE", "Submit a JSON request.");
  const reader = request.body?.getReader();
  if (!reader) throw new SecurityError(400, "INVALID_REQUEST", "A request body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new SecurityError(413, "PAYLOAD_TOO_LARGE", "Request is too large."); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof SecurityError) throw error;
    throw new SecurityError(400, "INVALID_REQUEST", "Invalid JSON request.");
  } finally { reader.releaseLock(); }
}

export function securityJson(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export function securityFailure(error: unknown) {
  if (error instanceof SecurityError) return securityJson({ error: error.message, code: error.code }, error.status);
  console.error("Security operation failed.", error instanceof Error ? error.name : "Unknown error");
  return securityJson({ error: "This security operation is temporarily unavailable. Try again.", code: "SECURITY_UNAVAILABLE" }, 503);
}
