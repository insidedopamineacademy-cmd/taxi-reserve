import {
  DriverVehicleType,
  Prisma,
  PrismaClient,
  Role,
  UserStatus,
} from "@prisma/client";
import {
  createSubscriptionChargeAndLiability,
  getDriverSubscriptionRate,
} from "../src/lib/drivers/subscriptionCore.ts";
import {
  parseBackfillArguments,
  type ApprovedDriver,
} from "./backfill-driver-subscriptions-august-2026-core.mts";

const AUGUST = new Date(Date.UTC(2026, 7, 1));
const SEPTEMBER = new Date(Date.UTC(2026, 8, 1));
const prisma = new PrismaClient();

type Transaction = Prisma.TransactionClient;
type Decision =
  | "CLEAR SKIP"
  | "MANUAL APPROVAL REQUIRED"
  | "ALREADY REPRESENTED"
  | "INCONSISTENT - DO NOT TOUCH";

type PreviewRow = {
  driverId: string;
  driver: string;
  licence: string;
  currentVehicleType: DriverVehicleType | null;
  createdAt: string;
  augustAmount: string;
  currentBalance: string;
  projectedBalance: string;
  evidence: string;
  decision: Decision;
};

function decimal(value: Prisma.Decimal | null | undefined) {
  return value ?? new Prisma.Decimal(0);
}

async function schemaHasLiabilityLink(transaction: Transaction) {
  const rows = await transaction.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'CommissionEntry'
        AND column_name = 'subscriptionChargeId'
    ) AS "exists"
  `;
  return rows[0]?.exists === true;
}

async function linkedChargeIds(transaction: Transaction, linkExists: boolean) {
  if (!linkExists) return new Map<string, { driverId: string; amount: string }>();
  const rows = await transaction.$queryRaw<
    Array<{ chargeId: string; driverId: string; amount: Prisma.Decimal }>
  >`
    SELECT c."id" AS "chargeId", e."driverId", e."commissionAmount" AS "amount"
    FROM "DriverSubscriptionCharge" c
    JOIN "CommissionEntry" e ON e."subscriptionChargeId" = c."id"
    WHERE c."chargeMonth" = ${AUGUST}
  `;
  return new Map(
    rows.map((row) => [
      row.chargeId,
      { driverId: row.driverId, amount: row.amount.toFixed(2) },
    ]),
  );
}

async function buildPreview(transaction: Transaction) {
  const [drivers, augustCharges, septemberChargeCount, commissions, payments, creationLogs, linkExists] =
    await Promise.all([
      transaction.driver.findMany({
        orderBy: [{ name: "asc" }, { licenseNumber: "asc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
          licenseNumber: true,
          vehicleType: true,
          subscriptionExempt: true,
          createdAt: true,
        },
      }),
      transaction.driverSubscriptionCharge.findMany({ where: { chargeMonth: AUGUST } }),
      transaction.driverSubscriptionCharge.count({ where: { chargeMonth: SEPTEMBER } }),
      transaction.commissionEntry.groupBy({
        by: ["driverId"],
        _sum: { commissionAmount: true },
      }),
      transaction.driverPayment.groupBy({ by: ["driverId"], _sum: { amount: true } }),
      transaction.activityLog.findMany({
        where: {
          entityType: "driver",
          action: { in: ["driver_created", "driver_updated"] },
        },
        select: { entityId: true, action: true, metadata: true, createdAt: true },
      }),
      schemaHasLiabilityLink(transaction),
    ]);

  const links = await linkedChargeIds(transaction, linkExists);
  const chargesByDriver = new Map(augustCharges.map((charge) => [charge.driverId, charge]));
  const commissionsByDriver = new Map(
    commissions.map((row) => [row.driverId, decimal(row._sum.commissionAmount)]),
  );
  const paymentsByDriver = new Map(
    payments.map((row) => [row.driverId, decimal(row._sum.amount)]),
  );
  const logsByDriver = new Map<string, typeof creationLogs>();
  for (const log of creationLogs) {
    if (!log.entityId) continue;
    const existing = logsByDriver.get(log.entityId) ?? [];
    existing.push(log);
    logsByDriver.set(log.entityId, existing);
  }

  const rows: PreviewRow[] = drivers.map((driver) => {
    const currentBalance = decimal(commissionsByDriver.get(driver.id)).minus(
      decimal(paymentsByDriver.get(driver.id)),
    );
    const amount = driver.vehicleType
      ? getDriverSubscriptionRate(driver.vehicleType)
      : new Prisma.Decimal(0);
    const charge = chargesByDriver.get(driver.id);
    const driverLogs = logsByDriver.get(driver.id) ?? [];
    const exemptionChangeLogs = driverLogs.filter(
      (log) =>
        log.action === "driver_updated" &&
        log.metadata &&
        typeof log.metadata === "object" &&
        !Array.isArray(log.metadata) &&
        Array.isArray(log.metadata.changedFields) &&
        log.metadata.changedFields.includes("subscriptionExempt"),
    );
    const creationProvesAugustExemption = driverLogs.some(
      (log) =>
        log.action === "driver_created" &&
        log.createdAt < SEPTEMBER &&
        log.metadata &&
        typeof log.metadata === "object" &&
        !Array.isArray(log.metadata) &&
        log.metadata.subscriptionExempt === true,
    );
    const laterToggleCount = exemptionChangeLogs.filter(
      (log) => log.createdAt >= SEPTEMBER,
    ).length;
    const exemptAtEndOfAugust =
      laterToggleCount % 2 === 0
        ? driver.subscriptionExempt
        : !driver.subscriptionExempt;
    const exemptionChangedDuringAugust = exemptionChangeLogs.some(
      (log) => log.createdAt < SEPTEMBER,
    );
    const exemptDuringAugust =
      exemptAtEndOfAugust &&
      (creationProvesAugustExemption || exemptionChangedDuringAugust);

    let decision: Decision;
    let evidence: string;
    if (charge) {
      const link = links.get(charge.id);
      if (
        link &&
        link.driverId === driver.id &&
        link.amount === charge.amount.toFixed(2)
      ) {
        decision = "ALREADY REPRESENTED";
        evidence = "August charge has one linked liability CommissionEntry with the same driver and amount.";
      } else {
        decision = "INCONSISTENT - DO NOT TOUCH";
        evidence = linkExists
          ? "August classification row exists without a matching linked liability."
          : "August classification row exists but production does not yet have the linkage column.";
      }
    } else if (driver.createdAt >= SEPTEMBER) {
      decision = "CLEAR SKIP";
      evidence = "Driver record was created after August 2026.";
    } else if (exemptDuringAugust) {
      decision = "CLEAR SKIP";
      evidence = "August audit trail proves subscription exemption was set during August 2026.";
    } else if (!driver.vehicleType) {
      decision = "INCONSISTENT - DO NOT TOUCH";
      evidence = "Current vehicle type is missing, so no reviewed historical rate can be pinned.";
    } else {
      decision = "MANUAL APPROVAL REQUIRED";
      evidence = "No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility.";
    }

    const projectedBalance =
      decision === "MANUAL APPROVAL REQUIRED" ? currentBalance.plus(amount) : currentBalance;
    return {
      driverId: driver.id,
      driver: driver.name,
      licence: driver.licenseNumber,
      currentVehicleType: driver.vehicleType,
      createdAt: driver.createdAt.toISOString(),
      augustAmount: amount.toFixed(2),
      currentBalance: currentBalance.toFixed(2),
      projectedBalance: projectedBalance.toFixed(2),
      evidence,
      decision,
    };
  });

  const currentGrossPending = rows.reduce(
    (total, row) =>
      new Prisma.Decimal(row.currentBalance).greaterThan(0)
        ? total.plus(row.currentBalance)
        : total,
    new Prisma.Decimal(0),
  );
  const currentCredits = rows.reduce(
    (total, row) => {
      const balance = new Prisma.Decimal(row.currentBalance);
      return balance.lessThan(0) ? total.plus(balance.abs()) : total;
    },
    new Prisma.Decimal(0),
  );
  const projectedGrossPending = rows.reduce(
    (total, row) =>
      new Prisma.Decimal(row.projectedBalance).greaterThan(0)
        ? total.plus(row.projectedBalance)
        : total,
    new Prisma.Decimal(0),
  );
  const candidates = rows.filter((row) => row.decision === "MANUAL APPROVAL REQUIRED");

  return {
    mode: "PREVIEW_READ_ONLY" as const,
    auditTimestamp: new Date().toISOString(),
    linkageColumnPresent: linkExists,
    septemberChargeCount,
    existingAugustChargeCount: augustCharges.length,
    counts: Object.fromEntries(
      [
        "CLEAR SKIP",
        "MANUAL APPROVAL REQUIRED",
        "ALREADY REPRESENTED",
        "INCONSISTENT - DO NOT TOUCH",
      ].map((decision) => [decision, rows.filter((row) => row.decision === decision).length]),
    ),
    candidateVehicleCounts: {
      VAN: candidates.filter((row) => row.currentVehicleType === DriverVehicleType.VAN).length,
      SEDAN: candidates.filter((row) => row.currentVehicleType === DriverVehicleType.SEDAN).length,
    },
    maximumProposedLiability: candidates
      .reduce((total, row) => total.plus(row.augustAmount), new Prisma.Decimal(0))
      .toFixed(2),
    currentGrossPending: currentGrossPending.toFixed(2),
    currentCredits: currentCredits.toFixed(2),
    projectedGrossPendingIfEveryCandidateApproved: projectedGrossPending.toFixed(2),
    rows,
  };
}

function validateApproval(row: PreviewRow | undefined, approval: ApprovedDriver) {
  if (!row) throw new Error(`Approved driver does not exist: ${approval.driverId}`);
  if (row.decision !== "MANUAL APPROVAL REQUIRED") {
    throw new Error(`${approval.driverId} is ${row.decision}; apply is refused.`);
  }
  if (row.currentVehicleType !== approval.vehicleType) {
    throw new Error(`${approval.driverId} vehicle type changed since review.`);
  }
  if (row.augustAmount !== approval.amount) {
    throw new Error(`${approval.driverId} amount changed since review.`);
  }
}

async function applyApproved(approvals: ApprovedDriver[], actorEmail: string, executionId: string) {
  return prisma.$transaction(
    async (transaction) => {
      const preview = await buildPreview(transaction);
      if (!preview.linkageColumnPresent) {
        throw new Error("The subscription-liability linkage migration is not deployed; apply is refused.");
      }
      const actor = await transaction.user.findUnique({
        where: { email: actorEmail },
        select: { role: true, status: true },
      });
      if (!actor || actor.role !== Role.ADMIN || actor.status !== UserStatus.ACTIVE) {
        throw new Error("--actor-email must identify an active administrator.");
      }

      const rowsById = new Map(preview.rows.map((row) => [row.driverId, row]));
      approvals.forEach((approval) => validateApproval(rowsById.get(approval.driverId), approval));

      const created: Array<{ driverId: string; chargeId: string; liabilityCommissionId: string }> = [];
      for (const approval of approvals) {
        const row = rowsById.get(approval.driverId)!;
        const result = await createSubscriptionChargeAndLiability(transaction, {
          driverId: approval.driverId,
          chargeMonth: AUGUST,
          amount: new Prisma.Decimal(approval.amount),
        });
        if (!result.created) {
          throw new Error(`Concurrent or existing August charge detected for ${approval.driverId}.`);
        }
        await transaction.activityLog.create({
          data: {
            action: "august_2026_subscription_backfill_created",
            entityType: "driver_subscription_charge",
            entityId: result.charge.id,
            userEmail: actorEmail,
            metadata: {
              executionId,
              driverId: approval.driverId,
              driverName: row.driver,
              licence: row.licence,
              vehicleType: approval.vehicleType,
              chargeMonth: "2026-08-01",
              amount: approval.amount,
              priorBalance: row.currentBalance,
              newBalance: new Prisma.Decimal(row.currentBalance).plus(approval.amount).toFixed(2),
              liabilityCommissionId: result.liabilityCommissionId,
            },
          },
        });
        created.push({
          driverId: approval.driverId,
          chargeId: result.charge.id,
          liabilityCommissionId: result.liabilityCommissionId,
        });
      }

      await transaction.activityLog.create({
        data: {
          action: "august_2026_subscription_backfill_batch",
          entityType: "driver_subscription_backfill",
          entityId: executionId,
          userEmail: actorEmail,
          metadata: {
            executionId,
            chargeMonth: "2026-08-01",
            approvedDriverIds: approvals.map((approval) => approval.driverId),
            createdCount: created.length,
          },
        },
      });
      return { mode: "APPLIED" as const, executionId, created };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

async function main() {
  const args = parseBackfillArguments(process.argv.slice(2));
  if (!args.apply) {
    const preview = await prisma.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return buildPreview(transaction);
    });
    console.log(JSON.stringify(preview, null, 2));
    return;
  }

  const result = await applyApproved(
    args.approvals,
    args.actorEmail!,
    args.executionId!,
  );
  console.log(JSON.stringify(result, null, 2));
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
