import assert from "node:assert/strict";
import {
  DriverPaymentMethod,
  DriverStatus,
  DriverVehicleType,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { calculateDriverFinancialSummary } from "../src/lib/drivers/financialMath.ts";
import { generateMonthlyDriverSubscriptionCharges } from "../src/lib/drivers/subscriptionCore.ts";

const databaseUrl = process.env.DRIVER_SUBSCRIPTION_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("Set DRIVER_SUBSCRIPTION_TEST_DATABASE_URL to a disposable local PostgreSQL database.");
}

const parsedDatabaseUrl = new URL(databaseUrl);
const databaseName = parsedDatabaseUrl.pathname.replace(/^\//, "").toLowerCase();
if (
  !["127.0.0.1", "localhost"].includes(parsedDatabaseUrl.hostname) ||
  !databaseName.includes("test")
) {
  throw new Error(
    "Refusing to run: the subscription integration test requires a local database whose name contains 'test'.",
  );
}

const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const september = new Date(Date.UTC(2026, 8, 1));
const october = new Date(Date.UTC(2026, 9, 1));

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
  await prisma.driverSubscriptionCharge.deleteMany();
  await prisma.commissionEntry.deleteMany();
  await prisma.driverPayment.deleteMany();
  await prisma.reservation.deleteMany();
  await prisma.driver.deleteMany();

  const activeVan = await createDriver("Active Van", "TEST-VAN", {
    vehicleType: DriverVehicleType.VAN,
  });
  const activeSedan = await createDriver("Active Sedan", "TEST-SEDAN", {
    vehicleType: DriverVehicleType.SEDAN,
  });
  await createDriver("Exempt Van", "TEST-EXEMPT-VAN", {
    vehicleType: DriverVehicleType.VAN,
    subscriptionExempt: true,
  });
  await createDriver("Exempt Sedan", "TEST-EXEMPT-SEDAN", {
    vehicleType: DriverVehicleType.SEDAN,
    subscriptionExempt: true,
  });
  await createDriver("Inactive Van", "TEST-INACTIVE", {
    status: DriverStatus.INACTIVE,
    vehicleType: DriverVehicleType.VAN,
  });
  await createDriver("Needs Configuration", "TEST-NO-VEHICLE");
  const legacyDriver = await createDriver("Legacy Driver", "TEST-LEGACY");

  await prisma.commissionEntry.create({
    data: {
      driverId: activeVan.id,
      commissionAmount: new Prisma.Decimal("100.00"),
      entryDate: september,
    },
  });
  await prisma.driverPayment.create({
    data: {
      driverId: activeVan.id,
      amount: new Prisma.Decimal("30.00"),
      paymentDate: september,
      method: DriverPaymentMethod.BANK,
    },
  });
  await prisma.commissionEntry.create({
    data: {
      driverId: legacyDriver.id,
      commissionAmount: new Prisma.Decimal("40.00"),
      entryDate: september,
    },
  });
  await prisma.driverPayment.create({
    data: {
      driverId: legacyDriver.id,
      amount: new Prisma.Decimal("10.00"),
      paymentDate: september,
      method: DriverPaymentMethod.CASH,
    },
  });

  const firstRun = await generateMonthlyDriverSubscriptionCharges(prisma, september);
  assert.equal(firstRun.createdCount, 2);
  assert.equal(firstRun.skippedExemptCount, 2);
  assert.equal(firstRun.skippedInactiveCount, 1);
  assert.equal(firstRun.skippedMissingVehicleTypeCount, 2);

  const septemberCharges = await prisma.driverSubscriptionCharge.findMany({
    where: { chargeMonth: september },
    orderBy: { amount: "desc" },
  });
  assert.deepEqual(
    septemberCharges.map((charge) => charge.amount.toFixed(2)),
    ["20.00", "7.00"],
  );

  const repeatedRun = await generateMonthlyDriverSubscriptionCharges(prisma, september);
  assert.equal(repeatedRun.createdCount, 0);
  assert.equal(repeatedRun.alreadyExistingCount, 2);
  assert.equal(await prisma.driverSubscriptionCharge.count(), 2);

  await assert.rejects(
    prisma.driverSubscriptionCharge.create({
      data: {
        driverId: activeVan.id,
        chargeMonth: september,
        amount: new Prisma.Decimal("20.00"),
      },
    }),
    (error) =>
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002",
  );

  const activeVanTotals = await Promise.all([
    prisma.commissionEntry.aggregate({
      where: { driverId: activeVan.id },
      _sum: { commissionAmount: true },
    }),
    prisma.driverPayment.aggregate({
      where: { driverId: activeVan.id },
      _sum: { amount: true },
    }),
    prisma.driverSubscriptionCharge.aggregate({
      where: { driverId: activeVan.id },
      _sum: { amount: true },
    }),
  ]);
  const summary = calculateDriverFinancialSummary(
    activeVanTotals[0]._sum.commissionAmount,
    activeVanTotals[1]._sum.amount,
    activeVanTotals[2]._sum.amount,
  );
  assert.equal(summary.balance.toFixed(2), "50.00");

  await prisma.driver.update({
    where: { id: activeVan.id },
    data: { vehicleType: DriverVehicleType.SEDAN },
  });
  await prisma.driver.update({
    where: { id: activeSedan.id },
    data: { subscriptionExempt: true },
  });

  const secondMonthRun = await generateMonthlyDriverSubscriptionCharges(prisma, october);
  assert.equal(secondMonthRun.createdCount, 1);
  const activeVanHistory = await prisma.driverSubscriptionCharge.findMany({
    where: { driverId: activeVan.id },
    orderBy: { chargeMonth: "asc" },
  });
  assert.deepEqual(
    activeVanHistory.map((charge) => charge.amount.toFixed(2)),
    ["20.00", "7.00"],
  );
  assert.equal(
    await prisma.driverSubscriptionCharge.count({
      where: { driverId: activeSedan.id },
    }),
    1,
  );

  assert.equal(
    await prisma.driverSubscriptionCharge.count({
      where: { driverId: legacyDriver.id },
    }),
    0,
  );
  assert.equal(
    (
      await prisma.commissionEntry.aggregate({
        where: { driverId: legacyDriver.id },
        _sum: { commissionAmount: true },
      })
    )._sum.commissionAmount?.toFixed(2),
    "40.00",
  );
  assert.equal(
    (
      await prisma.driverPayment.aggregate({
        where: { driverId: legacyDriver.id },
        _sum: { amount: true },
      })
    )._sum.amount?.toFixed(2),
    "10.00",
  );

  await assert.rejects(
    prisma.driver.delete({ where: { id: activeVan.id } }),
    (error) =>
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003",
  );

  console.log("Driver subscription integration scenarios passed.");
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
