import {
  DriverStatus,
  DriverVehicleType,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import {
  readSubscriptionAutomationEnabled,
  readSubscriptionAutomationEnabledForUpdate,
} from "./subscriptionAutomation.ts";

const RATE_VALUES = {
  [DriverVehicleType.VAN]: "20.00",
  [DriverVehicleType.SEDAN]: "7.00",
} as const satisfies Record<DriverVehicleType, string>;

export type DriverSubscriptionBatchResult = {
  chargeMonth: Date;
  eligibleCount: number;
  createdCount: number;
  alreadyExistingCount: number;
  skippedInactiveCount: number;
  skippedExemptCount: number;
  skippedMissingVehicleTypeCount: number;
  // True when the global automation switch was OFF, so this run created nothing.
  paused: boolean;
  createdCharges: Array<{
    id: string;
    driverId: string;
    amount: Prisma.Decimal;
    liabilityCommissionId: string;
  }>;
};

export function getDriverSubscriptionRate(vehicleType: DriverVehicleType) {
  return new Prisma.Decimal(RATE_VALUES[vehicleType]);
}

function assertNormalizedChargeMonth(chargeMonth: Date) {
  const valid =
    !Number.isNaN(chargeMonth.getTime()) &&
    chargeMonth.getUTCHours() === 0 &&
    chargeMonth.getUTCMinutes() === 0 &&
    chargeMonth.getUTCSeconds() === 0 &&
    chargeMonth.getUTCMilliseconds() === 0 &&
    chargeMonth.getUTCDate() === 1;

  if (!valid) {
    throw new Error("Subscription chargeMonth must be the first UTC date of a calendar month.");
  }
}

export async function createSubscriptionChargeAndLiability(
  transaction: Prisma.TransactionClient,
  input: {
    driverId: string;
    chargeMonth: Date;
    amount: Prisma.Decimal;
  },
) {
  assertNormalizedChargeMonth(input.chargeMonth);

  const existing = await transaction.driverSubscriptionCharge.findUnique({
    where: {
      driverId_chargeMonth: {
        driverId: input.driverId,
        chargeMonth: input.chargeMonth,
      },
    },
    select: { id: true },
  });
  if (existing) return { created: false as const, chargeId: existing.id };

  const charge = await transaction.driverSubscriptionCharge.create({
    data: {
      driverId: input.driverId,
      chargeMonth: input.chargeMonth,
      amount: input.amount,
    },
    select: { id: true, driverId: true, amount: true },
  });
  const liability = await transaction.commissionEntry.create({
    data: {
      driverId: input.driverId,
      subscriptionChargeId: charge.id,
      commissionAmount: input.amount,
      entryDate: input.chargeMonth,
    },
    select: { id: true },
  });

  return {
    created: true as const,
    charge,
    liabilityCommissionId: liability.id,
  };
}

export async function generateMonthlyDriverSubscriptionCharges(
  client: PrismaClient,
  chargeMonth: Date,
): Promise<DriverSubscriptionBatchResult> {
  assertNormalizedChargeMonth(chargeMonth);

  const result: DriverSubscriptionBatchResult = {
    chargeMonth,
    eligibleCount: 0,
    createdCount: 0,
    alreadyExistingCount: 0,
    skippedInactiveCount: 0,
    skippedExemptCount: 0,
    skippedMissingVehicleTypeCount: 0,
    paused: false,
    createdCharges: [],
  };

  // Global automation switch. When OFF, the automatic generator creates nothing
  // for this run. Paused months are therefore never generated and never later
  // recovered — there is no catch-up path; the next run handles its own month.
  if (!(await readSubscriptionAutomationEnabled(client))) {
    result.paused = true;
    return result;
  }

  const drivers = await client.driver.findMany({
    // Deleted drivers never receive future subscription charges.
    where: { deletedAt: null },
    orderBy: { id: "asc" },
    select: {
      id: true,
      status: true,
      vehicleType: true,
      subscriptionExempt: true,
    },
  });

  for (const driver of drivers) {
    if (driver.status !== DriverStatus.ACTIVE) {
      result.skippedInactiveCount += 1;
      continue;
    }
    if (driver.subscriptionExempt) {
      result.skippedExemptCount += 1;
      continue;
    }
    if (!driver.vehicleType) {
      result.skippedMissingVehicleTypeCount += 1;
      continue;
    }

    result.eligibleCount += 1;

    const existingCharge = await client.driverSubscriptionCharge.findUnique({
      where: {
        driverId_chargeMonth: {
          driverId: driver.id,
          chargeMonth,
        },
      },
      select: { id: true },
    });
    if (existingCharge) {
      result.alreadyExistingCount += 1;
      continue;
    }

    try {
      const created = await client.$transaction(async (transaction) => {
        // Re-check the switch under a row lock so a pause committed mid-run
        // stops further charge creation. Serialises with setSubscriptionAutomation.
        if (!(await readSubscriptionAutomationEnabledForUpdate(transaction))) {
          return { paused: true as const };
        }
        return createSubscriptionChargeAndLiability(transaction, {
          driverId: driver.id,
          chargeMonth,
          amount: getDriverSubscriptionRate(driver.vehicleType!),
        });
      });
      if ("paused" in created) {
        // Automation was paused during this run; create nothing further.
        result.paused = true;
        result.eligibleCount -= 1;
        break;
      }
      if (!created.created) {
        result.alreadyExistingCount += 1;
        continue;
      }
      result.createdCharges.push({
        ...created.charge,
        liabilityCommissionId: created.liabilityCommissionId,
      });
      result.createdCount += 1;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        result.alreadyExistingCount += 1;
        continue;
      }
      throw error;
    }
  }

  return result;
}
