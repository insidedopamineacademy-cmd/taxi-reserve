export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { requireSecuritySession, securityFailure, securityJson } from "@/lib/security/http";
import { hasFreshLocation } from "@/lib/security/policy";

export async function GET() {
  try {
    const { session } = await requireSecuritySession({ location: false });
    return securityJson({ id: session.id, expiresAt: session.expiresAt, locationVerifiedAt: session.locationVerifiedAt, locationRequired: !hasFreshLocation(session.locationVerifiedAt) });
  } catch (error) { return securityFailure(error); }
}
