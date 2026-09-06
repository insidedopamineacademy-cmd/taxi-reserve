export const runtime = "nodejs";
import { prisma } from "@/lib/prisma";
import { clearSessionLocation, recordSessionLocation } from "@/lib/security/sessionCore";
import { readSecurityJson, requireSecuritySession, requireTrustedLocationRequest, securityFailure, securityJson } from "@/lib/security/http";

export async function POST(request: Request) {
  try {
    requireTrustedLocationRequest(request);
    const { identity } = await requireSecuritySession({ location: false });
    return securityJson(await recordSessionLocation(prisma, identity, await readSecurityJson(request)));
  } catch (error) { return securityFailure(error); }
}

export async function DELETE(request: Request) {
  try {
    requireTrustedLocationRequest(request);
    const { identity } = await requireSecuritySession({ location: false });
    await clearSessionLocation(prisma, identity);
    return securityJson({ ok: true });
  } catch (error) { return securityFailure(error); }
}
