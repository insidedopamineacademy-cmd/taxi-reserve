import type { PrismaClient } from "@prisma/client";
import { requireActiveAdmin } from "../security/adminSecurity.ts";
import type { SessionIdentity } from "../security/sessionCore.ts";
import { SUBSCRIPTION_AUTOMATION_ID } from "./subscriptionAutomation.ts";

export type SubscriptionAutomationResult = { enabled: boolean; changed: boolean };

/**
 * Admin-only toggle for the global automatic-subscription switch. Authorization
 * is re-verified against the database inside the transaction (ACTIVE account,
 * current ADMIN role, valid device session) — the client-supplied role is never
 * trusted. The singleton row is locked FOR UPDATE so the toggle serialises
 * against a concurrent generator run. A no-op (requested state already current)
 * writes no audit entry.
 */
export async function setSubscriptionAutomation(
  db: PrismaClient,
  identity: SessionIdentity,
  enabled: boolean,
  now = new Date(),
): Promise<SubscriptionAutomationResult> {
  return db.$transaction(async (tx) => {
    const actor = await requireActiveAdmin(tx, identity, now);

    await tx.$queryRaw`SELECT "id" FROM "SubscriptionAutomationSetting" WHERE "id" = ${SUBSCRIPTION_AUTOMATION_ID} FOR UPDATE`;
    const current = await tx.subscriptionAutomationSetting.findUnique({
      where: { id: SUBSCRIPTION_AUTOMATION_ID },
      select: { enabled: true },
    });
    const previous = current?.enabled ?? true;

    if (previous === enabled) {
      return { enabled: previous, changed: false };
    }

    await tx.subscriptionAutomationSetting.upsert({
      where: { id: SUBSCRIPTION_AUTOMATION_ID },
      create: { id: SUBSCRIPTION_AUTOMATION_ID, enabled, updatedByUserId: actor.userId },
      update: { enabled, updatedByUserId: actor.userId },
    });

    await tx.activityLog.create({
      data: {
        action: enabled ? "SUBSCRIPTION_AUTOMATION_ENABLED" : "SUBSCRIPTION_AUTOMATION_DISABLED",
        entityType: "subscription_automation",
        entityId: SUBSCRIPTION_AUTOMATION_ID,
        userEmail: actor.user.email,
        createdAt: now,
        metadata: {
          previousState: previous,
          newState: enabled,
          actorUserId: actor.userId,
          actorEmail: actor.user.email,
        },
      },
    });

    return { enabled, changed: true };
  });
}
