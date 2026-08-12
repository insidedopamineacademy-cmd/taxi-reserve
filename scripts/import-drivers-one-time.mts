import { Prisma, PrismaClient } from "@prisma/client";
import type { DriverProfileRepository } from "../src/lib/drivers/profile-core.ts";
import {
  buildOneTimeDriverImportPlan,
  executeOneTimeDriverImportTransaction,
  ONE_TIME_DRIVER_CANDIDATES,
  type OneTimeExistingDriver,
} from "./import-drivers-one-time-core.mts";

const prisma = new PrismaClient();

const allowedFlags = new Set(["--dry-run", "--apply"]);
const flags = process.argv.slice(2);
const unknownFlag = flags.find((flag) => !allowedFlags.has(flag));
if (unknownFlag) throw new Error(`Unknown flag: ${unknownFlag}`);
if (flags.includes("--dry-run") && flags.includes("--apply")) {
  throw new Error("Choose either --dry-run or --apply, not both.");
}
const apply = flags.includes("--apply");

const driverSelect = {
  id: true,
  name: true,
  licenseNumber: true,
  vehicleType: true,
  status: true,
  subscriptionExempt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.DriverSelect;

function candidateWhere(): Prisma.DriverWhereInput {
  return {
    OR: [
      ...ONE_TIME_DRIVER_CANDIDATES.map((candidate) => ({
        name: { equals: candidate.name, mode: "insensitive" as const },
      })),
      ...ONE_TIME_DRIVER_CANDIDATES.map((candidate) => ({
        licenseNumber: { equals: candidate.licenseNumber, mode: "insensitive" as const },
      })),
    ],
  };
}

async function findExisting(database: Prisma.TransactionClient | PrismaClient) {
  return database.driver.findMany({
    where: candidateWhere(),
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: driverSelect,
  });
}

function printPlan(existingDrivers: readonly OneTimeExistingDriver[]) {
  const plan = buildOneTimeDriverImportPlan(existingDrivers);
  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN (read-only)"}`);
  console.log(`Duplicate source rows removed: ${plan.counts.duplicateSourceRowsRemoved}`);
  console.log(`CREATE: ${plan.counts.create}`);
  console.log(`SKIP EXISTING: ${plan.counts.skipExisting}`);
  console.log(`NEEDS REVIEW: ${plan.counts.needsReview}`);
  console.log(`CONFLICT: ${plan.counts.conflict}`);
  for (const item of plan.items) {
    console.log(`${item.status} | ${item.profile.name} | ${item.profile.licenseNumber} | ${item.profile.vehicleType} | ${item.reason}`);
  }
  for (const row of plan.reviewRows) {
    console.log(`NEEDS_REVIEW | ${row.names.join(" / ")} | ${row.licenseNumber} | ${row.vehicleType} | ${row.reason}`);
  }
  return plan;
}

function transactionRepository(
  transaction: Prisma.TransactionClient,
): DriverProfileRepository {
  return {
    findByIdentity(input) {
      return transaction.driver.findFirst({
        where: {
          name: { equals: input.name, mode: "insensitive" },
          licenseNumber: { equals: input.licenseNumber, mode: "insensitive" },
        },
        select: driverSelect,
      });
    },
    create(profile) {
      return transaction.driver.create({ data: profile, select: driverSelect });
    },
  };
}

async function applyPlan() {
  if (process.env.ALLOW_ONE_TIME_DRIVER_IMPORT !== "true") {
    throw new Error("Set ALLOW_ONE_TIME_DRIVER_IMPORT=true only after the shared-license migration is deployed and this plan is approved.");
  }
  const actorEmail = process.env.DRIVER_IMPORT_ACTOR_EMAIL?.trim().toLowerCase();
  if (!actorEmail) throw new Error("DRIVER_IMPORT_ACTOR_EMAIL is required for --apply.");
  const actor = await prisma.user.findUnique({
    where: { email: actorEmail },
    select: { email: true, role: true },
  });
  if (!actor || actor.role !== "ADMIN") throw new Error("The import actor must be an existing ADMIN.");

  return executeOneTimeDriverImportTransaction({
    actorEmail: actor.email,
    runInTransaction: (work, options) => prisma.$transaction(work, options),
    findExisting,
    createRepository: transactionRepository,
    async createActivity(transaction, driver, actorEmail) {
      await transaction.activityLog.create({
        data: {
          action: "driver_created",
          entityType: "driver",
          entityId: driver.id,
          userEmail: actorEmail,
          metadata: {
            status: driver.status,
            vehicleType: driver.vehicleType,
            subscriptionExempt: driver.subscriptionExempt,
            source: "one_time_driver_import",
          },
        },
      });
    },
  });
}

try {
  const existing = await findExisting(prisma);
  printPlan(existing);
  if (apply) {
    const result = await applyPlan();
    console.log(`Applied: created ${result.createdCount}; skipped ${result.skippedCount}.`);
  } else {
    console.log("Dry run complete: zero Driver, finance, reservation, or ActivityLog writes.");
  }
} finally {
  await prisma.$disconnect();
}
