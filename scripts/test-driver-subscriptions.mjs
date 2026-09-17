import assert from "node:assert/strict";
import {
  DriverPaymentMethod,
  DriverStatus,
  DriverSubscriptionPaymentStatus,
  DriverVehicleType,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { calculateDriverFinancialSummary } from "../src/lib/drivers/financialMath.ts";
import { generateMonthlyDriverSubscriptionCharges } from "../src/lib/drivers/subscriptionCore.ts";

const databaseUrl = process.env.DRIVER_SUBSCRIPTION_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("Set DRIVER_SUBSCRIPTION_TEST_DATABASE_URL to a disposable local PostgreSQL database.");
const parsedDatabaseUrl = new URL(databaseUrl);
const databaseName = parsedDatabaseUrl.pathname.replace(/^\//, "").toLowerCase();
if (!["127.0.0.1", "localhost"].includes(parsedDatabaseUrl.hostname) || !databaseName.includes("test")) {
  throw new Error("Refusing to run: the subscription integration test requires a local database whose name contains 'test'.");
}

const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const september = new Date(Date.UTC(2026, 8, 1));
const october = new Date(Date.UTC(2026, 9, 1));
const november = new Date(Date.UTC(2026, 10, 1));

async function createDriver(name, licenseNumber, options = {}) {
  return prisma.driver.create({
    data: {
      name,
      licenseNumber,
      status: options.status ?? DriverStatus.ACTIVE,
      vehicleType: options.vehicleType ?? null,
      subscriptionExempt: options.subscriptionExempt ?? false,
    },
  });
}

async function main() {
  await prisma.activityLog.deleteMany();
  await prisma.driverSubscriptionPaymentAllocation.deleteMany();
  await prisma.commissionEntry.deleteMany();
  await prisma.driverSubscriptionCharge.deleteMany();
  await prisma.driverPayment.deleteMany();
  await prisma.reservation.deleteMany();
  await prisma.driver.deleteMany();

  const user = await prisma.user.upsert({
    where: { email: "subscription-test@example.com" },
    create: { email: "subscription-test@example.com", role: "ADMIN" },
    update: { role: "ADMIN", status: "ACTIVE" },
  });
  const activeVan = await createDriver("Active Van", "TEST-VAN", { vehicleType: DriverVehicleType.VAN });
  const activeSedan = await createDriver("Active Sedan", "TEST-SEDAN", { vehicleType: DriverVehicleType.SEDAN });
  await createDriver("Exempt Van", "TEST-EXEMPT-VAN", { vehicleType: DriverVehicleType.VAN, subscriptionExempt: true });
  await createDriver("Exempt Sedan", "TEST-EXEMPT-SEDAN", { vehicleType: DriverVehicleType.SEDAN, subscriptionExempt: true });
  await createDriver("Inactive Van", "TEST-INACTIVE", { status: DriverStatus.INACTIVE, vehicleType: DriverVehicleType.VAN });
  await createDriver("Needs Configuration", "TEST-NO-VEHICLE");
  const legacyDriver = await createDriver("Legacy September Driver", "TEST-LEGACY", { vehicleType: DriverVehicleType.VAN });

  const manualCommission = await prisma.commissionEntry.create({
    data: { driverId: activeVan.id, commissionAmount: new Prisma.Decimal("100.00"), entryDate: september, manualPickupText: "Manual pickup", manualDropoffText: "Manual destination" },
  });
  const reservation = await prisma.reservation.create({
    data: { userEmail: user.email, driverId: activeVan.id, startAt: new Date("2026-09-08T08:30:00.000Z"), pickupText: "Ride pickup", dropoffText: "Ride destination" },
  });
  const rideCommission = await prisma.commissionEntry.create({
    data: { driverId: activeVan.id, reservationId: reservation.id, commissionAmount: new Prisma.Decimal("15.00"), entryDate: september },
  });
  const activeVanPayment = await prisma.driverPayment.create({
    data: { driverId: activeVan.id, amount: new Prisma.Decimal("30.00"), paymentDate: september, method: DriverPaymentMethod.BANK },
  });
  const legacyCommission = await prisma.commissionEntry.create({
    data: { driverId: legacyDriver.id, commissionAmount: new Prisma.Decimal("40.00"), entryDate: september },
  });
  const legacyPayment = await prisma.driverPayment.create({
    data: { driverId: legacyDriver.id, amount: new Prisma.Decimal("10.00"), paymentDate: september, method: DriverPaymentMethod.CASH },
  });
  const legacySeptemberCharge = await prisma.driverSubscriptionCharge.create({
    data: { driverId: legacyDriver.id, chargeMonth: september, amount: new Prisma.Decimal("20.00"), paymentStatus: DriverSubscriptionPaymentStatus.UNVERIFIED },
  });
  const legacyAllocation = await prisma.driverSubscriptionPaymentAllocation.create({
    data: { driverPaymentId: legacyPayment.id, subscriptionChargeId: legacySeptemberCharge.id, amount: new Prisma.Decimal("10.00") },
  });

  const paymentSnapshot = await prisma.driverPayment.findMany({ orderBy: { id: "asc" } });
  const allocationSnapshot = await prisma.driverSubscriptionPaymentAllocation.findMany({ orderBy: { id: "asc" } });
  const legacySnapshot = await prisma.driverSubscriptionCharge.findUniqueOrThrow({ where: { id: legacySeptemberCharge.id }, include: { liabilityCommission: true } });

  const firstRun = await generateMonthlyDriverSubscriptionCharges(prisma, september);
  assert.equal(firstRun.createdCount, 2);
  assert.equal(firstRun.alreadyExistingCount, 1);
  assert.equal(firstRun.skippedExemptCount, 2);
  assert.equal(firstRun.skippedInactiveCount, 1);
  assert.equal(firstRun.skippedMissingVehicleTypeCount, 1);

  const generatedSeptember = await prisma.driverSubscriptionCharge.findMany({
    where: { chargeMonth: september, id: { not: legacySeptemberCharge.id } },
    include: { liabilityCommission: true },
    orderBy: { amount: "desc" },
  });
  assert.deepEqual(generatedSeptember.map((charge) => charge.amount.toFixed(2)), ["20.00", "7.00"]);
  assert.deepEqual(generatedSeptember.map((charge) => charge.liabilityCommission?.commissionAmount.toFixed(2)), ["20.00", "7.00"]);
  for (const charge of generatedSeptember) {
    assert.equal(charge.liabilityCommission?.driverId, charge.driverId);
    assert.equal(charge.liabilityCommission?.entryDate.toISOString(), september.toISOString());
    assert.equal(charge.liabilityCommission?.reservationId, null);
  }

  const repeatedRun = await generateMonthlyDriverSubscriptionCharges(prisma, september);
  assert.equal(repeatedRun.createdCount, 0);
  assert.equal(repeatedRun.alreadyExistingCount, 3);
  assert.equal(await prisma.driverSubscriptionCharge.count({ where: { chargeMonth: september } }), 3);
  assert.equal(await prisma.commissionEntry.count({ where: { subscriptionChargeId: { not: null } } }), 2);

  const activeVanTotals = await Promise.all([
    prisma.commissionEntry.aggregate({ where: { driverId: activeVan.id }, _sum: { commissionAmount: true } }),
    prisma.driverPayment.aggregate({ where: { driverId: activeVan.id }, _sum: { amount: true } }),
    prisma.driverSubscriptionCharge.aggregate({ where: { driverId: activeVan.id }, _sum: { amount: true } }),
  ]);
  const summary = calculateDriverFinancialSummary(activeVanTotals[0]._sum.commissionAmount, activeVanTotals[1]._sum.amount, activeVanTotals[2]._sum.amount);
  assert.equal(summary.totalCommissions.toFixed(2), "135.00");
  assert.equal(summary.totalSubscriptionCharges.toFixed(2), "20.00");
  assert.equal(summary.balance.toFixed(2), "105.00", "135.00 - 30.00; subscription metadata is not added again");

  await prisma.driver.update({ where: { id: activeVan.id }, data: { vehicleType: DriverVehicleType.SEDAN } });
  await prisma.driver.update({ where: { id: activeSedan.id }, data: { subscriptionExempt: true } });
  await prisma.driver.update({ where: { id: legacyDriver.id }, data: { status: DriverStatus.INACTIVE } });

  const concurrentRuns = await Promise.all([
    generateMonthlyDriverSubscriptionCharges(prisma, october),
    generateMonthlyDriverSubscriptionCharges(prisma, october),
  ]);
  assert.equal(concurrentRuns.reduce((total, run) => total + run.createdCount, 0), 1);
  const octoberCharges = await prisma.driverSubscriptionCharge.findMany({ where: { driverId: activeVan.id, chargeMonth: october }, include: { liabilityCommission: true } });
  assert.equal(octoberCharges.length, 1);
  assert.equal(octoberCharges[0].amount.toFixed(2), "7.00");
  assert.equal(octoberCharges[0].liabilityCommission?.commissionAmount.toFixed(2), "7.00");

  const atomicDriver = await createDriver("Atomic Failure Driver", "TEST-ATOMIC", { vehicleType: DriverVehicleType.VAN });
  await prisma.driver.update({ where: { id: activeVan.id }, data: { status: DriverStatus.INACTIVE } });
  assert.match(atomicDriver.id, /^[A-Za-z0-9_-]+$/);
  await prisma.$executeRawUnsafe(`ALTER TABLE "CommissionEntry" ADD CONSTRAINT "CommissionEntry_atomic_test_check" CHECK (NOT ("driverId" = '${atomicDriver.id}' AND "subscriptionChargeId" IS NOT NULL))`);
  try {
    await assert.rejects(generateMonthlyDriverSubscriptionCharges(prisma, november));
  } finally {
    await prisma.$executeRawUnsafe('ALTER TABLE "CommissionEntry" DROP CONSTRAINT "CommissionEntry_atomic_test_check"');
  }
  assert.equal(await prisma.driverSubscriptionCharge.count({ where: { driverId: atomicDriver.id, chargeMonth: november } }), 0, "a failed liability insert rolls back its charge");

  assert.deepEqual(await prisma.driverPayment.findMany({ orderBy: { id: "asc" } }), paymentSnapshot, "monthly generation does not rewrite payments");
  assert.deepEqual(await prisma.driverSubscriptionPaymentAllocation.findMany({ orderBy: { id: "asc" } }), allocationSnapshot, "monthly generation does not rewrite allocations");
  assert.deepEqual(
    await prisma.driverSubscriptionCharge.findUniqueOrThrow({ where: { id: legacySeptemberCharge.id }, include: { liabilityCommission: true } }),
    legacySnapshot,
    "existing September charge remains unlinked and unchanged",
  );
  assert.deepEqual(await prisma.commissionEntry.findUnique({ where: { id: manualCommission.id } }), manualCommission);
  assert.deepEqual(await prisma.commissionEntry.findUnique({ where: { id: rideCommission.id } }), rideCommission);
  assert.deepEqual(await prisma.commissionEntry.findUnique({ where: { id: legacyCommission.id } }), legacyCommission);
  assert.equal((await prisma.driverPayment.findUnique({ where: { id: activeVanPayment.id } }))?.amount.toFixed(2), "30.00");
  assert.equal((await prisma.driverSubscriptionPaymentAllocation.findUnique({ where: { id: legacyAllocation.id } }))?.amount.toFixed(2), "10.00");

  await assert.rejects(prisma.driver.delete({ where: { id: activeVan.id } }), (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003");
  console.log("Driver subscription linkage, concurrency, and atomicity scenarios passed.");
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
