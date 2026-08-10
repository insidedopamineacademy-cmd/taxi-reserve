import "server-only";

import { logActivity } from "@/lib/activityLog";
import { financialDateFromMadridInstant } from "@/lib/drivers/financialValidation";
import {
  generateMonthlyDriverSubscriptionCharges,
  getDriverSubscriptionRate,
} from "@/lib/drivers/subscriptionCore";
import { prisma } from "@/lib/prisma";

export { getDriverSubscriptionRate };

export function getMadridSubscriptionChargeMonth(now = new Date()) {
  const madridDate = financialDateFromMadridInstant(now);
  return new Date(
    Date.UTC(madridDate.getUTCFullYear(), madridDate.getUTCMonth(), 1),
  );
}

export function formatSubscriptionMonthDisplay(chargeMonth: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(chargeMonth);
}

export async function runMonthlyDriverSubscriptions(now = new Date()) {
  const chargeMonth = getMadridSubscriptionChargeMonth(now);
  const result = await generateMonthlyDriverSubscriptionCharges(prisma, chargeMonth);
  const chargeMonthLabel = chargeMonth.toISOString().slice(0, 10);

  await Promise.all(
    result.createdCharges.map((charge) =>
      logActivity({
        action: "driver_subscription_generated",
        entityType: "driver_subscription_charge",
        entityId: charge.id,
        metadata: {
          driverId: charge.driverId,
          chargeMonth: chargeMonthLabel,
        },
      }),
    ),
  );

  await logActivity({
    action: "driver_subscription_batch_run",
    entityType: "driver_subscription_batch",
    entityId: chargeMonthLabel,
    metadata: {
      chargeMonth: chargeMonthLabel,
      eligibleCount: result.eligibleCount,
      createdCount: result.createdCount,
      alreadyExistingCount: result.alreadyExistingCount,
      skippedInactiveCount: result.skippedInactiveCount,
      skippedExemptCount: result.skippedExemptCount,
      skippedMissingVehicleTypeCount: result.skippedMissingVehicleTypeCount,
    },
  });

  return result;
}
