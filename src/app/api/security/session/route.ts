export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { requireSecuritySession, securityFailure, securityJson } from "@/lib/security/http";

export async function GET() {
  try {
    const { session } = await requireSecuritySession();
    return securityJson({ id: session.id, expiresAt: session.expiresAt });
  } catch (error) { return securityFailure(error); }
}
