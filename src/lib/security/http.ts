import "server-only";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, identityAuthOptions } from "@/lib/auth";
import { SecurityError } from "./policy";
import { isTrustedLocationRequest, LOCATION_REQUEST_HEADER } from "./locationRequestGuard";

export async function requireSecuritySession(options: { location?: boolean; admin?: boolean } = {}) {
  const session = await getServerSession(options.location === false ? identityAuthOptions : authOptions);
  if (!session?.id || !session.user?.id) throw new SecurityError(401, "UNAUTHORIZED", "Sign in again.");
  if (options.admin && session.user.role !== "ADMIN") throw new SecurityError(403, "FORBIDDEN", "Administrator access required.");
  return { session, identity: { sid: session.id, sub: session.user.id } };
}

export function requireSameOrigin(request: Request) {
  const expectedOrigin = new URL(process.env.NEXTAUTH_URL ?? request.url).origin;
  if (request.headers.get("origin") !== expectedOrigin) throw new SecurityError(403, "INVALID_ORIGIN", "This action must be submitted from Taxi Reserve.");
}

export function requireTrustedLocationRequest(request: Request) {
  const expectedOrigin = new URL(process.env.NEXTAUTH_URL ?? request.url).origin;
  if (!isTrustedLocationRequest({
    expectedOrigin,
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"),
    marker: request.headers.get(LOCATION_REQUEST_HEADER),
  })) throw new SecurityError(403, "INVALID_LOCATION_REQUEST", "This location request must be submitted from Taxi Reserve.");
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
