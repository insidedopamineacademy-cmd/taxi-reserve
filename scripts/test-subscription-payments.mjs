import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient, Prisma } from "@prisma/client";
import { generateMonthlyDriverSubscriptionCharges } from "../src/lib/drivers/subscriptionCore.ts";
import { updateSubscriptionPayment } from "../src/lib/drivers/subscriptionPaymentCore.ts";
import { calculateDriverFinancialSummary } from "../src/lib/drivers/financialMath.ts";

const databaseUrl = process.env.DRIVER_SUBSCRIPTION_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("Set DRIVER_SUBSCRIPTION_TEST_DATABASE_URL to a disposable local PostgreSQL database.");
const url = new URL(databaseUrl);
if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.toLowerCase().includes("test")) {
  throw new Error("Refusing non-local or non-test database.");
}
const db = new PrismaClient({ datasourceUrl: databaseUrl });
const run = randomUUID();
const september = new Date("2026-09-01T00:00:00Z");
const august = new Date("2026-08-01T00:00:00Z");
const now = new Date("2026-09-05T12:00:00Z");
const driver = (label, extra = {}) => db.driver.create({ data: {
  name: `${label} ${run}`, licenseNumber: run, vehicleType: "VAN", ...extra,
} });
const charge = (driverId, chargeMonth = september) => db.driverSubscriptionCharge.findUniqueOrThrow({
  where: { driverId_chargeMonth: { driverId, chargeMonth } },
});
async function financials(driverId) {
  const [c, p, s] = await Promise.all([
    db.commissionEntry.aggregate({ where: { driverId }, _sum: { commissionAmount: true } }),
    db.driverPayment.aggregate({ where: { driverId }, _sum: { amount: true } }),
    db.driverSubscriptionCharge.aggregate({ where: { driverId }, _sum: { amount: true } }),
  ]);
  return calculateDriverFinancialSummary(c._sum.commissionAmount, p._sum.amount, s._sum.amount);
}

try {
  const legacy = await db.driverSubscriptionCharge.findUnique({ where: { id: "legacy-subscription-row" } });
  if (legacy) {
    assert.equal(legacy.paymentStatus, "UNVERIFIED");
    assert.equal(legacy.amount.toFixed(2), "12.34");
    assert.equal(legacy.paidAt, null);
    assert.equal(legacy.paymentRevision, 0);
    console.log("PASS: additive migration preserved the legacy row/amount and marked it UNVERIFIED.");
  }
  const admin = await db.user.create({ data: { email: `sub-admin-${run}@example.test`, role: "ADMIN" } });
  const user = await db.user.create({ data: { email: `sub-user-${run}@example.test`, role: "USER" } });
  const actor = { email: admin.email, role: "ADMIN" };
  const van = await driver("Van");
  const sedan = await driver("Sedan", { vehicleType: "SEDAN" });
  const inactive = await driver("Inactive", { status: "INACTIVE" });
  const exempt = await driver("Exempt", { subscriptionExempt: true });
  const unconfigured = await driver("Unconfigured", { vehicleType: null });
  await generateMonthlyDriverSubscriptionCharges(db, august);
  const previous = await charge(sedan.id, august);
  assert.equal(previous.amount.toFixed(2), "7.00");
  await db.driver.update({ where: { id: sedan.id }, data: { vehicleType: "VAN" } });
  await generateMonthlyDriverSubscriptionCharges(db, september);
  await generateMonthlyDriverSubscriptionCharges(db, september);
  const month = await charge(van.id);
  assert.equal(month.paymentStatus, "UNPAID");
  assert.equal(month.paidAt, null);
  assert.equal(await db.driverSubscriptionCharge.count({ where: { driverId: van.id, chargeMonth: september } }), 1);
  assert.equal((await charge(sedan.id)).amount.toFixed(2), "20.00");
  assert.deepEqual(await charge(sedan.id, august), previous, "changing vehicle type/generating another month must preserve history");
  for (const excluded of [inactive, exempt, unconfigured]) {
    assert.equal(await db.driverSubscriptionCharge.count({ where: { driverId: excluded.id } }), 0);
  }
  await assert.rejects(db.driverSubscriptionCharge.create({ data: {
    driverId: van.id, chargeMonth: september, amount: new Prisma.Decimal(20),
  } }), (error) => error.code === "P2002");

  await db.commissionEntry.create({ data: { driverId: van.id, commissionAmount: "40.00", entryDate: now } });
  assert.equal((await financials(van.id)).balance.toFixed(2), "0.00");
  assert.equal((await charge(van.id)).paymentStatus, "UNPAID", "zero commission balance is not proof of subscription payment");
  await db.driverPayment.create({ data: { driverId: van.id, amount: "12.34", paymentDate: now, method: "CASH" } });
  assert.equal((await charge(van.id)).paymentStatus, "UNPAID", "weekly settlement never marks a subscription paid");
  const before = await financials(van.id);
  const augustBefore = await charge(van.id, august);
  const input = { status: "PAID", paidDate: "2026-09-05", expectedRevision: 0, note: "Receipt A" };
  const recorded = await updateSubscriptionPayment(db, actor, van.id, month.id, input, now);
  assert.equal(recorded.changed, true);
  const paid = await charge(van.id);
  assert.equal(paid.paymentStatus, "PAID");
  assert.equal(paid.paidAt.toISOString(), "2026-09-05T00:00:00.000Z");
  assert.equal(paid.paidByUserId, admin.id);
  assert.equal(paid.paymentNote, "Receipt A");
  assert.equal(paid.amount.toFixed(2), "20.00");
  assert.equal((await updateSubscriptionPayment(db, actor, van.id, month.id, input, now)).changed, false);
  assert.equal(await db.activityLog.count({ where: { entityId: month.id } }), 1);
  assert.deepEqual(await charge(van.id, august), augustBefore);
  assert.equal((await financials(van.id)).balance.toFixed(2), before.balance.toFixed(2));
  assert.equal(await db.driverPayment.count({ where: { driverId: van.id } }), 1);

  await assert.rejects(updateSubscriptionPayment(db, { email: null, role: "ADMIN" }, van.id, month.id, input, now), { status: 401 });
  await assert.rejects(updateSubscriptionPayment(db, { email: user.email, role: "USER" }, van.id, month.id, input, now), { status: 403 });
  await assert.rejects(updateSubscriptionPayment(db, { email: user.email, role: "ADMIN" }, van.id, month.id, input, now), { status: 403 });
  await assert.rejects(updateSubscriptionPayment(db, actor, sedan.id, month.id, input, now), { status: 404 });
  await assert.rejects(updateSubscriptionPayment(db, actor, van.id, month.id, { status: "UNPAID", expectedRevision: 0 }, now), { status: 409 });
  await updateSubscriptionPayment(db, actor, van.id, month.id, { status: "UNPAID", paidDate: null, expectedRevision: 1, note: "Wrong month" }, now);
  const undone = await charge(van.id);
  assert.equal(undone.paymentStatus, "UNPAID");
  assert.equal(undone.paidAt, null);
  assert.equal(undone.paidByUserId, null);
  assert.equal(undone.paymentRevision, 2);
  const audit = await db.activityLog.findFirstOrThrow({ where: { entityId: month.id, action: "driver_subscription_marked_unpaid" } });
  assert.equal(audit.userEmail, admin.email);
  assert.equal(audit.metadata.previousPaidByUserId, admin.id);
  assert.equal(audit.metadata.previousPaidAt, "2026-09-05");
  assert.equal(audit.metadata.previousNote, "Receipt A");
  assert.equal(audit.metadata.chargeMonth, "2026-09");
  assert.equal(audit.metadata.note, "Wrong month");

  const competing = await Promise.allSettled(["Receipt B", "Receipt C"].map((note) => updateSubscriptionPayment(
    db, actor, van.id, month.id, { ...input, expectedRevision: 2, note }, now,
  )));
  assert.equal(competing.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(competing.filter((result) => result.status === "rejected" && result.reason.status === 409).length, 1);
  assert.equal((await charge(van.id)).paymentRevision, 3);
  assert.equal(await db.activityLog.count({ where: { entityId: month.id } }), 3);

  // Force an audit failure inside the disposable DB and verify transactional rollback.
  await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION subscription_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.metadata->>'note' = 'force-audit-failure' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER subscription_test_audit_failure BEFORE INSERT ON "ActivityLog" FOR EACH ROW EXECUTE FUNCTION subscription_test_audit_failure()');
  try {
    await assert.rejects(updateSubscriptionPayment(db, actor, van.id, month.id, {
      status: "UNPAID", expectedRevision: 3, note: "force-audit-failure",
    }, now));
    assert.equal((await charge(van.id)).paymentRevision, 3);
    assert.equal((await charge(van.id)).paymentStatus, "PAID");
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER subscription_test_audit_failure ON "ActivityLog"');
    await db.$executeRawUnsafe('DROP FUNCTION subscription_test_audit_failure()');
  }
  await db.driver.update({ where: { id: van.id }, data: { status: "INACTIVE" } });
  await generateMonthlyDriverSubscriptionCharges(db, new Date("2026-10-01T00:00:00Z"));
  assert.equal(await db.driverSubscriptionCharge.count({ where: { driverId: van.id } }), 2);
  await updateSubscriptionPayment(db, actor, van.id, month.id, { status: "UNPAID", expectedRevision: 3, note: "Historical correction" }, now);
  assert.equal((await charge(van.id)).paymentStatus, "UNPAID", "deactivation preserves correctable history");
  assert.equal((await financials(van.id)).balance.toFixed(2), before.balance.toFixed(2));
  console.log("PASS: generation/defaults, uniqueness, history/rates, inactive/exempt handling, payment/zero-balance independence, paid date/admin/note, idempotency, reversal/audit, concurrency, authorization and atomic audit rollback.");
} finally {
  await db.$disconnect();
}
