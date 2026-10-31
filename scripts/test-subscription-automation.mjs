import assert from "node:assert/strict";
import {
  DriverPaymentMethod,
  DriverStatus,
  DriverVehicleType,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { generateMonthlyDriverSubscriptionCharges } from "../src/lib/drivers/subscriptionCore.ts";
import {
  SUBSCRIPTION_AUTOMATION_ID,
  readSubscriptionAutomationEnabled,
} from "../src/lib/drivers/subscriptionAutomation.ts";
import { setSubscriptionAutomation } from "../src/lib/drivers/subscriptionAutomationAdmin.ts";
import { SecurityError } from "../src/lib/security/policy.ts";

const databaseUrl = process.env.DRIVER_SUBSCRIPTION_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("Set DRIVER_SUBSCRIPTION_TEST_DATABASE_URL to a disposable local PostgreSQL database.");
const parsed = new URL(databaseUrl);
const dbName = parsed.pathname.replace(/^\//, "").toLowerCase();
if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || !dbName.includes("test")) {
  throw new Error("Refusing to run: this test requires a local database whose name contains 'test'.");
}

const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const monthUtc = (year, monthIndex) => new Date(Date.UTC(year, monthIndex, 1));

let seq = 0;
async function createDriver(options = {}) {
  seq += 1;
  return prisma.driver.create({
    data: {
      name: options.name ?? `Driver ${seq}`,
      licenseNumber: options.licenseNumber ?? `AUTO-${seq}`,
      status: options.status ?? DriverStatus.ACTIVE,
      vehicleType: options.vehicleType ?? DriverVehicleType.VAN,
      subscriptionExempt: options.subscriptionExempt ?? false,
      deletedAt: options.deletedAt ?? null,
    },
  });
}

async function createActor({ role = "ADMIN", status = "ACTIVE" } = {}) {
  seq += 1;
  const now = Date.now();
  const user = await prisma.user.create({
    data: { email: `auto-actor-${seq}@example.com`, name: `Actor ${seq}`, role, status },
  });
  const session = await prisma.deviceSession.create({
    data: {
      userId: user.id,
      expiresAt: new Date(now + 24 * 60 * 60 * 1000),
      settingsUnlockedUntil: null, // no PIN needed for this financial action
      device: "Test", browser: "Test", os: "Test",
    },
  });
  return { user, identity: { sid: session.id, sub: user.id } };
}

async function assertSecurityStatus(promise, status, label) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof SecurityError, `${label}: expected SecurityError, got ${error}`);
    assert.equal(error.status, status, `${label}: expected ${status}, got ${error.status}`);
    return true;
  }, label);
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
  await prisma.subscriptionAutomationSetting.deleteMany();
  seq = 0;
}

async function chargeCount(month) {
  return prisma.driverSubscriptionCharge.count({ where: { chargeMonth: month } });
}
async function automationAuditCount() {
  return prisma.activityLog.count({ where: { entityType: "subscription_automation" } });
}

async function main() {
  await reset();
  const admin = await createActor();
  const user = await createActor({ role: "USER" });

  // 1. Default state is enabled (no row present).
  assert.equal(await readSubscriptionAutomationEnabled(prisma), true, "default enabled");

  // 5. Unauthenticated / invalid session rejected (401).
  await assertSecurityStatus(
    setSubscriptionAutomation(prisma, { sid: "11111111-1111-1111-1111-111111111111", sub: "nope" }, false),
    401, "unauthenticated",
  );
  // 4. USER cannot modify (403). 16. Failed toggle leaves state unchanged.
  await assertSecurityStatus(setSubscriptionAutomation(prisma, user.identity, false), 403, "non-admin");
  assert.equal(await readSubscriptionAutomationEnabled(prisma), true, "state unchanged after rejected toggle");
  assert.equal(await automationAuditCount(), 0, "no audit for rejected toggle");

  // 2. Admin can pause. 17. Audit records genuine change.
  const pause = await setSubscriptionAutomation(prisma, admin.identity, false);
  assert.deepEqual(pause, { enabled: false, changed: true }, "admin pauses");
  // 15. Persists across requests (fresh read).
  assert.equal(await readSubscriptionAutomationEnabled(prisma), false, "pause persisted");
  const audit = await prisma.activityLog.findFirst({ where: { action: "SUBSCRIPTION_AUTOMATION_DISABLED" } });
  assert.ok(audit, "disable audit written");
  assert.equal(audit.userEmail, admin.user.email, "audit actor email");
  assert.equal(audit.metadata.previousState, true, "audit previousState");
  assert.equal(audit.metadata.newState, false, "audit newState");
  assert.equal(audit.metadata.actorUserId, admin.user.id, "audit actor id");

  // 18. No-op toggle: already disabled -> no change, no new audit.
  const auditBefore = await automationAuditCount();
  const noop = await setSubscriptionAutomation(prisma, admin.identity, false);
  assert.deepEqual(noop, { enabled: false, changed: false }, "no-op pause");
  assert.equal(await automationAuditCount(), auditBefore, "no duplicate audit on no-op");

  // 6/7. Disabled generator creates zero charges and zero liabilities.
  const octEligible = await createDriver({ vehicleType: DriverVehicleType.VAN });
  const oct = monthUtc(2026, 9);
  const liabilitiesBefore = await prisma.commissionEntry.count();
  const disabledRun = await generateMonthlyDriverSubscriptionCharges(prisma, oct);
  assert.equal(disabledRun.paused, true, "disabled run reports paused");
  assert.equal(disabledRun.createdCount, 0, "disabled run creates zero charges");
  assert.equal(await chargeCount(oct), 0, "no charge rows while disabled");
  assert.equal(await prisma.commissionEntry.count(), liabilitiesBefore, "no liability rows while disabled");

  // 8/9. Existing balances/payments/allocations untouched by a disabled run.
  await prisma.commissionEntry.create({ data: { driverId: octEligible.id, commissionAmount: new Prisma.Decimal("50.00"), entryDate: oct } });
  const payment = await prisma.driverPayment.create({ data: { driverId: octEligible.id, amount: new Prisma.Decimal("10.00"), paymentDate: oct, method: DriverPaymentMethod.CASH } });
  const comms = await prisma.commissionEntry.aggregate({ where: { driverId: octEligible.id }, _sum: { commissionAmount: true } });
  const pays = await prisma.driverPayment.aggregate({ where: { driverId: octEligible.id }, _sum: { amount: true } });
  await generateMonthlyDriverSubscriptionCharges(prisma, oct); // still disabled
  const commsAfter = await prisma.commissionEntry.aggregate({ where: { driverId: octEligible.id }, _sum: { commissionAmount: true } });
  const paysAfter = await prisma.driverPayment.aggregate({ where: { driverId: octEligible.id }, _sum: { amount: true } });
  assert.equal(commsAfter._sum.commissionAmount.toFixed(2), comms._sum.commissionAmount.toFixed(2), "commission total unchanged");
  assert.equal(paysAfter._sum.amount.toFixed(2), pays._sum.amount.toFixed(2), "payment total unchanged");
  assert.ok(await prisma.driverPayment.findUnique({ where: { id: payment.id } }), "payment preserved");

  // 3 + 11. Admin can resume; resuming does NOT immediately generate charges.
  const chargesBeforeResume = await chargeCount(oct);
  const resume = await setSubscriptionAutomation(prisma, admin.identity, true);
  assert.deepEqual(resume, { enabled: true, changed: true }, "admin resumes");
  assert.equal(await chargeCount(oct), chargesBeforeResume, "resume creates no charges");

  // 12 + 20. Enabled run charges only eligible drivers; excludes exempt/inactive/deleted.
  const exempt = await createDriver({ subscriptionExempt: true });
  const inactive = await createDriver({ status: DriverStatus.INACTIVE });
  const deleted = await createDriver({ deletedAt: new Date() });
  const nov = monthUtc(2026, 10);
  const enabledRun = await generateMonthlyDriverSubscriptionCharges(prisma, nov);
  assert.equal(enabledRun.paused, false, "enabled run not paused");
  assert.ok(await prisma.driverSubscriptionCharge.findFirst({ where: { driverId: octEligible.id, chargeMonth: nov } }), "eligible driver charged");
  assert.equal(await prisma.driverSubscriptionCharge.count({ where: { driverId: { in: [exempt.id, inactive.id, deleted.id] }, chargeMonth: nov } }), 0, "exempt/inactive/deleted excluded");

  // 13. Duplicate cron run is idempotent.
  const rerun = await generateMonthlyDriverSubscriptionCharges(prisma, nov);
  assert.equal(rerun.createdCount, 0, "rerun creates nothing");
  assert.ok(rerun.alreadyExistingCount >= 1, "rerun sees existing charges");
  assert.equal(await prisma.driverSubscriptionCharge.count({ where: { driverId: octEligible.id, chargeMonth: nov } }), 1, "no duplicate charge row");

  // 10. Paused months are never recovered on resume.
  await reset();
  const admin2 = await createActor();
  await createDriver({ vehicleType: DriverVehicleType.SEDAN });
  const octM = monthUtc(2026, 9), novM = monthUtc(2026, 10), decM = monthUtc(2026, 11), janM = monthUtc(2027, 0);
  await generateMonthlyDriverSubscriptionCharges(prisma, octM);            // ON (default)
  await setSubscriptionAutomation(prisma, admin2.identity, false);         // pause
  await generateMonthlyDriverSubscriptionCharges(prisma, novM);            // OFF
  await generateMonthlyDriverSubscriptionCharges(prisma, decM);            // OFF
  await setSubscriptionAutomation(prisma, admin2.identity, true);          // resume
  await generateMonthlyDriverSubscriptionCharges(prisma, janM);            // ON
  assert.equal(await chargeCount(octM), 1, "October charged");
  assert.equal(await chargeCount(novM), 0, "November skipped, not recovered");
  assert.equal(await chargeCount(decM), 0, "December skipped, not recovered");
  assert.equal(await chargeCount(janM), 1, "January charged");

  // 14. Pause/generator concurrency: a pause cannot commit while the singleton
  //     row is locked FOR UPDATE by a generator-style transaction.
  await prisma.subscriptionAutomationSetting.upsert({
    where: { id: SUBSCRIPTION_AUTOMATION_ID },
    create: { id: SUBSCRIPTION_AUTOMATION_ID, enabled: true },
    update: { enabled: true },
  });
  let pausePromise;
  await prisma.$transaction(async (holdTx) => {
    await holdTx.$queryRaw`SELECT "enabled" FROM "SubscriptionAutomationSetting" WHERE "id" = ${SUBSCRIPTION_AUTOMATION_ID} FOR UPDATE`;
    pausePromise = setSubscriptionAutomation(prisma, admin2.identity, false); // blocks on the lock
    await delay(400);
    assert.equal(await readSubscriptionAutomationEnabled(prisma), true, "pause cannot commit while row is locked");
  });
  const pauseResult = await pausePromise; // lock released on commit -> pause proceeds
  assert.equal(pauseResult.changed, true, "pause completes after lock release");
  assert.equal(await readSubscriptionAutomationEnabled(prisma), false, "pause applied after lock release");

  console.log("subscription-automation integration tests passed");
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
