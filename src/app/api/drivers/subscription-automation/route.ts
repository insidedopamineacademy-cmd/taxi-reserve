export const runtime = "nodejs";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { setSubscriptionAutomation } from "@/lib/drivers/subscriptionAutomationAdmin";
import { SecurityError } from "@/lib/security/policy";
import {
  readSecurityJson,
  requireSecuritySession,
  requireTrustedSecurityRequest,
  securityFailure,
  securityJson,
} from "@/lib/security/http";

// Admin-only global switch for automatic monthly subscription generation.
// Authorization is enforced server-side (middleware ADMIN gate + session admin
// check + in-transaction device-session/role/ACTIVE re-verification). Not PIN
// gated, matching the other driver financial actions under /api/drivers.
export async function POST(request: Request) {
  try {
    requireTrustedSecurityRequest(request, "driver-subscriptions.automation");
    const { identity } = await requireSecuritySession({ admin: true });

    const body = await readSecurityJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new SecurityError(400, "INVALID_REQUEST", "Provide an automation state.");
    }
    const input = body as Record<string, unknown>;
    if (Object.keys(input).some((key) => key !== "enabled") || typeof input.enabled !== "boolean") {
      throw new SecurityError(400, "INVALID_REQUEST", "Provide { enabled: boolean }.");
    }

    const result = await setSubscriptionAutomation(prisma, identity, input.enabled);
    revalidatePath("/drivers");
    return securityJson(result);
  } catch (error) {
    return securityFailure(error);
  }
}
