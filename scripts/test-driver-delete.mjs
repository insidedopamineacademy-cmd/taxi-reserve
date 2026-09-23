import assert from "node:assert/strict";
import {
  DriverPaymentMethod,
  DriverStatus,
  DriverSubscriptionPaymentStatus,
  DriverVehicleType,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { softDeleteDriver } from "../src/lib/drivers/deleteDriver.ts";
import { generateMonthlyDriverSubscriptionCharges } from "../src/lib/drivers/subscriptionCore.ts";
import { SecurityError } from "../src/lib/security/policy.ts";

// Reuses the disposable-database contract of the subscription integration test.
const databaseUrl = process.env.DRIVER_SUBSCRIPTION_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("Set DRIVER_SUBSCRIPTION_TEST_DATABASE_URL to a disposable local PostgreSQL database.");
const parsedDatabaseUrl = new URL(databaseUrl);
const databaseName = parsedDatabaseUrl.pathname.replace(/^\//, "").toLowerCase();
if (!["127.0.0.1", "localhost"].includes(parsedDatabaseUrl.hostname) || !databaseName.includes("test")) {
  throw new Error("Refusing to run: the driver-delete integration test requires a local database whose name contains 'test'.");
}

const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const october = new Date(Date.UTC(2026, 9, 1));

let driverSeq = 0;
async function createDriver(options = {}) {
  driverSeq += 1;
  return prisma.driver.create({
    data: {
      name: options.name ?? `Driver ${driverSeq}`,
      licenseNumber: options.licenseNumber ?? `DEL-${driverSeq}`,
      status: options.status ?? DriverStatus.ACTIVE,
      vehicleType: options.vehicleType ?? null,
      subscriptionExempt: options.subscriptionExempt ?? false,
    },
  });
}

let sessionSeq = 0;
async function createActor({ role = "ADMIN", status = "ACTIVE", unlocked = true, revoked = false } = {}) {
  sessionSeq += 1;
  const now = Date.now();
  const user = await prisma.user.create({
    data: { email: `actor-${sessionSeq}@example.com`, name: `Actor ${sessionSeq}`, role, status },
  });
  const session = await prisma.deviceSession.create({
    data: {
      userId: user.id,
      expiresAt: new Date(now + 24 * 60 * 60 * 1000),
      revokedAt: revoked ? new Date(now - 1000) : null,
      settingsUnlockedUntil: unlocked ? new Date(now + 10 * 60 * 1000) : null,
      device: "Test", browser: "Test", os: "Test",
    },
  });
  return { user, identity: { sid: session.id, sub: user.id } };
}

async function assertSecurityStatus(promise, status, label) {
  await assert.rejects(
    promise,
    (error) => {
      assert.ok(error instanceof SecurityError, `${label}: expected SecurityError, got ${error}`);
      assert.equal(error.status, status, `${label}: expected status ${status}, got ${error.status}`);
      return true;
    },
    label,
  );
}

async function reset() {
  await prisma.activityLog.deleteMany();
  await prisma.driverSubscriptionPaymentAllocation.deleteMany();
  await prisma.commissionEntry.deleteMany();
  await prisma.driverSubscriptionCharge.deleteMany();
  await prisma.driverPayment.deleteMany();
  await prisma.reservation.deleteMany();
  await prisma.driver.deleteMany();
  await prisma.deviceSession.deleteMany();
  await prisma.user.deleteMany();
  driverSeq = 0;
  sessionSeq = 0;
}

async function main() {
  await reset();

  // 1. A non-admin (USER role, from the database) is refused with 403 — the
  //    role is re-read from the DB, never taken from the client.
  {
    const driver = await createDriver();
    const nonAdmin = await createActor({ role: "USER" });
    await assertSecurityStatus(softDeleteDriver(prisma, nonAdmin.identity, driver.id), 403, "non-admin");
    const row = await prisma.driver.findUnique({ where: { id: driver.id } });
    assert.equal(row.deletedAt, null, "non-admin delete must not soft-delete");
  }

  // 2. A revoked device session is refused with 401.
  {
    const driver = await createDriver();
    const revoked = await createActor({ revoked: true });
    await assertSecurityStatus(softDeleteDriver(prisma, revoked.identity, driver.id), 401, "revoked session");
  }

  // 3. An admin whose account is INACTIVE is refused with 401.
  {
    const driver = await createDriver();
    const inactive = await createActor({ status: "INACTIVE" });
    await assertSecurityStatus(softDeleteDriver(prisma, inactive.identity, driver.id), 401, "inactive admin");
  }

  // 4. An admin who has not unlocked the Settings PIN is refused with 423.
  {
    const driver = await createDriver();
    const locked = await createActor({ unlocked: false });
    await assertSecurityStatus(softDeleteDriver(prisma, locked.identity, driver.id), 423, "settings locked");
    const row = await prisma.driver.findUnique({ where: { id: driver.id } });
    assert.equal(row.deletedAt, null, "locked admin delete must not soft-delete");
  }

  // 5. Deleting a driver that does not exist returns 404.
  {
    const admin = await createActor();
    await assertSecurityStatus(softDeleteDriver(prisma, admin.identity, "does-not-exist"), 404, "missing driver");
  }

  // 6. An unlocked admin soft-deletes the driver: deletedAt is stamped and the
  //    row still exists. 7. Financial + reservation history is preserved.
  //    8. Exactly one DRIVER_DELETED audit row is written with the actor + driver.
  {
    const admin = await createActor();
    const driver = await createDriver({ name: "Ledger Driver", vehicleType: DriverVehicleType.VAN });
    const reservationOwner = admin.user.email;
    const commission = await prisma.commissionEntry.create({
      data: { driverId: driver.id, commissionAmount: new Prisma.Decimal("42.00"), entryDate: october },
    });
    const payment = await prisma.driverPayment.create({
      data: { driverId: driver.id, amount: new Prisma.Decimal("10.00"), paymentDate: october, method: DriverPaymentMethod.CASH },
    });
    const charge = await prisma.driverSubscriptionCharge.create({
      data: { driverId: driver.id, chargeMonth: october, amount: new Prisma.Decimal("20.00"), paymentStatus: DriverSubscriptionPaymentStatus.UNPAID },
    });
    const allocation = await prisma.driverSubscriptionPaymentAllocation.create({
      data: { driverPaymentId: payment.id, subscriptionChargeId: charge.id, amount: new Prisma.Decimal("10.00") },
    });
    const reservation = await prisma.reservation.create({
      data: { userEmail: reservationOwner, driverId: driver.id, startAt: october, pickupText: "A", dropoffText: "B" },
    });

    const result = await softDeleteDriver(prisma, admin.identity, driver.id);
    assert.equal(result.changed, true, "first delete reports a change");
    assert.equal(result.driverId, driver.id);

    const row = await prisma.driver.findUnique({ where: { id: driver.id } });
    assert.ok(row, "soft-deleted driver row still exists");
    assert.ok(row.deletedAt instanceof Date, "deletedAt is stamped");
    assert.equal(row.status, DriverStatus.ACTIVE, "status is left untouched by soft delete");

    // History preserved (no cascade).
    assert.ok(await prisma.commissionEntry.findUnique({ where: { id: commission.id } }), "commission preserved");
    assert.ok(await prisma.driverPayment.findUnique({ where: { id: payment.id } }), "payment preserved");
    assert.ok(await prisma.driverSubscriptionCharge.findUnique({ where: { id: charge.id } }), "subscription charge preserved");
    assert.ok(await prisma.driverSubscriptionPaymentAllocation.findUnique({ where: { id: allocation.id } }), "allocation preserved");
    const reservationRow = await prisma.reservation.findUnique({ where: { id: reservation.id } });
    assert.equal(reservationRow.driverId, driver.id, "reservation keeps its historical driver link");

    // Audit.
    const audits = await prisma.activityLog.findMany({ where: { action: "DRIVER_DELETED", entityId: driver.id } });
    assert.equal(audits.length, 1, "exactly one DRIVER_DELETED audit row");
    assert.equal(audits[0].userEmail, admin.user.email, "audit records the acting admin");
    assert.equal(audits[0].metadata.driverName, "Ledger Driver", "audit records the driver name");

    // 9. Idempotent: a second delete reports no change and writes no new audit.
    const second = await softDeleteDriver(prisma, admin.identity, driver.id);
    assert.equal(second.changed, false, "second delete reports no change");
    const auditsAfter = await prisma.activityLog.count({ where: { action: "DRIVER_DELETED", entityId: driver.id } });
    assert.equal(auditsAfter, 1, "no duplicate audit row on idempotent delete");

    // 10. Excluded from the operational list predicate; a detail lookup 404s.
    const listed = await prisma.driver.findMany({ where: { deletedAt: null }, select: { id: true } });
    assert.ok(!listed.some((d) => d.id === driver.id), "deleted driver hidden from list predicate");
    const detail = await prisma.driver.findFirst({ where: { id: driver.id, deletedAt: null } });
    assert.equal(detail, null, "deleted driver 404s on detail predicate");
  }

  // 11. A deleted, otherwise-eligible driver is skipped by future subscription
  //     generation, while a live eligible driver still receives a charge.
  {
    const admin = await createActor();
    const deleted = await createDriver({ name: "Deleted Eligible", licenseNumber: "DEL-SUB", vehicleType: DriverVehicleType.VAN });
    const live = await createDriver({ name: "Live Eligible", licenseNumber: "LIVE-SUB", vehicleType: DriverVehicleType.SEDAN });
    await softDeleteDriver(prisma, admin.identity, deleted.id);

    const december = new Date(Date.UTC(2026, 11, 1));
    const batch = await generateMonthlyDriverSubscriptionCharges(prisma, december);
    assert.ok(batch.createdCount >= 1, "generation creates at least the live driver's charge");

    const deletedCharge = await prisma.driverSubscriptionCharge.findFirst({ where: { driverId: deleted.id, chargeMonth: december } });
    assert.equal(deletedCharge, null, "no subscription charge generated for a deleted driver");
    const liveCharge = await prisma.driverSubscriptionCharge.findFirst({ where: { driverId: live.id, chargeMonth: december } });
    assert.ok(liveCharge, "live eligible driver still receives a subscription charge");
  }

  console.log("driver-delete integration tests passed");
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
