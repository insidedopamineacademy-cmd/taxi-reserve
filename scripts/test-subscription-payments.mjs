import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient, Prisma } from "@prisma/client";
import { calculateDriverFinancialSummary } from "../src/lib/drivers/financialMath.ts";
import {
  deleteDriverPayment,
  editDriverPaymentMetadata,
  DriverPaymentError,
  planPaymentAllocation,
  recordDriverPayment,
} from "../src/lib/drivers/paymentAllocationCore.ts";
import { updateSubscriptionPayment } from "../src/lib/drivers/subscriptionPaymentCore.ts";
import { subscriptionSettlement } from "../src/lib/drivers/subscriptionStatus.ts";

const databaseUrl = process.env.DRIVER_SUBSCRIPTION_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("Set DRIVER_SUBSCRIPTION_TEST_DATABASE_URL to a disposable local PostgreSQL database.");
const url = new URL(databaseUrl);
if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.toLowerCase().includes("test")) {
  throw new Error("Refusing non-local or non-test database.");
}

const db = new PrismaClient({ datasourceUrl: databaseUrl });
const run = randomUUID();
const adminEmail = `allocation-admin-${run}@example.test`;
const july = new Date("2026-07-01T00:00:00Z");
const august = new Date("2026-08-01T00:00:00Z");
const september = new Date("2026-09-01T00:00:00Z");
const paymentDate = new Date("2026-09-08T00:00:00Z");
const money = (value) => new Prisma.Decimal(value);

async function driver(label, extra = {}) {
  return db.driver.create({ data: {
    name: `${label} ${run}`,
    licenseNumber: `${label}-${run}`,
    vehicleType: "VAN",
    ...extra,
  } });
}

function charge(driverId, chargeMonth, amount, paymentStatus = "UNPAID") {
  return db.driverSubscriptionCharge.create({ data: { driverId, chargeMonth, amount, paymentStatus } });
}

function record(driverId, amount, overrides = {}) {
  return recordDriverPayment(db, adminEmail, {
    driverId,
    amount: money(amount),
    paymentDate,
    method: "CASH",
    notes: null,
    ...overrides,
  });
}

async function financials(driverId) {
  const [commissions, payments, subscriptions] = await Promise.all([
    db.commissionEntry.aggregate({ where: { driverId }, _sum: { commissionAmount: true } }),
    db.driverPayment.aggregate({ where: { driverId }, _sum: { amount: true } }),
    db.driverSubscriptionCharge.aggregate({ where: { driverId }, _sum: { amount: true } }),
  ]);
  return calculateDriverFinancialSummary(
    commissions._sum.commissionAmount,
    payments._sum.amount,
    subscriptions._sum.amount,
  );
}

async function settlement(subscriptionChargeId) {
  const row = await db.driverSubscriptionCharge.findUniqueOrThrow({
    where: { id: subscriptionChargeId },
    include: { paymentAllocations: { select: { amount: true } } },
  });
  const allocated = row.paymentAllocations.reduce((total, allocation) => total.plus(allocation.amount), money(0));
  return subscriptionSettlement(row.paymentStatus, row.amount.toFixed(2), allocated.toFixed(2));
}

try {
  const admin = await db.user.create({ data: { email: adminEmail, role: "ADMIN" } });

  assert.throws(() => planPaymentAllocation(money("0.00"), []), DriverPaymentError);
  assert.throws(() => planPaymentAllocation(money("0.001"), []), DriverPaymentError);

  const standard = await driver("standard");
  const standardCharge = await charge(standard.id, september, "20.00");
  // CommissionEntry is the combined charge total: ordinary €244 + subscription €20.
  await db.commissionEntry.create({ data: { driverId: standard.id, commissionAmount: "264.00", entryDate: paymentDate } });
  assert.equal((await financials(standard.id)).balance.toFixed(2), "264.00");
  const standardPayment = await record(standard.id, "100.00");
  assert.equal(standardPayment.allocation.subscriptionTotal.toFixed(2), "20.00");
  assert.equal(standardPayment.allocation.commissionAmount.toFixed(2), "80.00");
  assert.equal((await settlement(standardCharge.id)).status, "PAID");
  assert.equal((await financials(standard.id)).balance.toFixed(2), "164.00", "264 combined charges - 100");

  const partial = await driver("partial");
  const partialCharge = await charge(partial.id, september, "20.00");
  await db.commissionEntry.create({ data: { driverId: partial.id, commissionAmount: "264.00", entryDate: paymentDate } });
  const first = await record(partial.id, "10.00");
  assert.equal(first.allocation.subscriptionTotal.toFixed(2), "10.00");
  assert.equal(first.allocation.commissionAmount.toFixed(2), "0.00");
  assert.deepEqual(await settlement(partialCharge.id), {
    status: "PARTIAL", paid: "10.00", remaining: "10.00", automaticallyAllocated: "10.00",
  });
  assert.equal((await financials(partial.id)).balance.toFixed(2), "254.00");
  const second = await record(partial.id, "50.00");
  assert.equal(second.allocation.subscriptionTotal.toFixed(2), "10.00");
  assert.equal(second.allocation.commissionAmount.toFixed(2), "40.00");
  assert.equal((await settlement(partialCharge.id)).status, "PAID");
  assert.equal((await financials(partial.id)).balance.toFixed(2), "204.00");
  assert.equal((await deleteDriverPayment(db, adminEmail, partial.id, second.payment.id)).changed, true);
  assert.deepEqual(await settlement(partialCharge.id), {
    status: "PARTIAL", paid: "10.00", remaining: "10.00", automaticallyAllocated: "10.00",
  });
  assert.equal((await financials(partial.id)).balance.toFixed(2), "254.00");

  const oldest = await driver("oldest");
  await db.commissionEntry.create({ data: { driverId: oldest.id, commissionAmount: "300.00", entryDate: paymentDate } });
  const oldCharges = await Promise.all([
    charge(oldest.id, july, "5.00"),
    charge(oldest.id, august, "20.00"),
    charge(oldest.id, september, "20.00"),
  ]);
  const oldestPayment = await record(oldest.id, "50.00");
  assert.deepEqual(oldestPayment.allocation.subscriptions.map((row) => [
    row.chargeMonth.toISOString().slice(0, 7), row.amount.toFixed(2),
  ]), [["2026-07", "5.00"], ["2026-08", "20.00"], ["2026-09", "20.00"]]);
  assert.equal(oldestPayment.allocation.commissionAmount.toFixed(2), "5.00");
  for (const row of oldCharges) assert.equal((await settlement(row.id)).status, "PAID");
  assert.equal((await financials(oldest.id)).balance.toFixed(2), "250.00", "three subscription months remain breakdown-only");

  const exact = await driver("exact");
  const exactCharge = await charge(exact.id, september, "20.00");
  const exactPayment = await record(exact.id, "20.00");
  assert.equal(exactPayment.allocation.commissionAmount.toFixed(2), "0.00");
  assert.equal((await settlement(exactCharge.id)).remaining, "0.00");

  const noCharge = await driver("no-charge");
  await db.commissionEntry.create({ data: { driverId: noCharge.id, commissionAmount: "264.00", entryDate: paymentDate } });
  const noChargePayment = await record(noCharge.id, "100.00");
  assert.equal(noChargePayment.allocation.subscriptionTotal.toFixed(2), "0.00");
  assert.equal(noChargePayment.allocation.commissionAmount.toFixed(2), "100.00");
  assert.equal((await financials(noCharge.id)).balance.toFixed(2), "164.00");

  const exempt = await driver("exempt", { subscriptionExempt: true });
  assert.equal((await record(exempt.id, "7.00")).allocation.commissionAmount.toFixed(2), "7.00");
  const inactive = await driver("inactive", { status: "INACTIVE" });
  await charge(inactive.id, august, "20.00");
  await assert.rejects(record(inactive.id, "20.00"), { status: 409 });
  assert.equal(await db.driverPayment.count({ where: { driverId: inactive.id } }), 0);

  const historical = await driver("historical");
  const historicalPaid = await db.driverSubscriptionCharge.create({ data: {
    driverId: historical.id, chargeMonth: august, amount: "20.00", paymentStatus: "PAID",
    paidAt: paymentDate, paidByUserId: admin.id,
  } });
  const historicalUnverified = await charge(historical.id, september, "20.00", "UNVERIFIED");
  const historicalPayment = await record(historical.id, "10.00");
  assert.equal(historicalPayment.allocation.subscriptions[0].subscriptionChargeId, historicalUnverified.id);
  assert.equal((await settlement(historicalPaid.id)).status, "PAID");
  assert.equal((await settlement(historicalUnverified.id)).status, "PARTIAL");

  const reversible = await driver("reversible");
  const reversibleCharge = await charge(reversible.id, september, "20.00");
  const reversiblePayment = await record(reversible.id, "100.00");
  assert.equal((await settlement(reversibleCharge.id)).status, "PAID");
  assert.equal((await deleteDriverPayment(db, adminEmail, reversible.id, reversiblePayment.payment.id)).changed, true);
  assert.deepEqual(await settlement(reversibleCharge.id), {
    status: "UNPAID", paid: "0.00", remaining: "20.00", automaticallyAllocated: "0.00",
  });
  assert.equal((await deleteDriverPayment(db, adminEmail, reversible.id, reversiblePayment.payment.id)).changed, false);
  assert.equal(await db.activityLog.count({ where: { entityId: reversiblePayment.payment.id, action: "driver_payment_deleted" } }), 1);

  const concurrent = await driver("concurrent");
  const concurrentCharge = await charge(concurrent.id, september, "20.00");
  const concurrentPayments = await Promise.all([record(concurrent.id, "20.00"), record(concurrent.id, "20.00")]);
  assert.equal((await settlement(concurrentCharge.id)).automaticallyAllocated, "20.00");
  assert.deepEqual(concurrentPayments.map((result) => result.allocation.subscriptionTotal.toFixed(2)).sort(), ["0.00", "20.00"]);
  assert.equal(await db.driverSubscriptionPaymentAllocation.count({ where: { subscriptionChargeId: concurrentCharge.id } }), 1);

  const sum = standardPayment.allocation.subscriptionTotal.plus(standardPayment.allocation.commissionAmount);
  assert.equal(sum.toFixed(2), standardPayment.payment.amount.toFixed(2));
  assert.equal(await db.activityLog.count({ where: { entityId: standardPayment.payment.id, action: "driver_payment_created" } }), 1);
  const creationAudit = await db.activityLog.findFirstOrThrow({
    where: { entityId: standardPayment.payment.id, action: "driver_payment_created" },
  });
  assert.equal(creationAudit.userEmail, adminEmail);
  assert.equal(creationAudit.metadata.driverId, standard.id);
  assert.equal(creationAudit.metadata.amount, "100.00");
  assert.equal(creationAudit.metadata.subscriptionAmount, "20.00");
  assert.equal(creationAudit.metadata.commissionAmount, "80.00");
  assert.deepEqual(creationAudit.metadata.subscriptionAllocations.map((row) => ({
    chargeMonth: row.chargeMonth,
    amount: row.amount,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
  })), [{ chargeMonth: "2026-09", amount: "20.00", fromStatus: "UNPAID", toStatus: "PAID" }]);
  assert.doesNotMatch(JSON.stringify(creationAudit.metadata), /password|secret|token|cookie/i);
  await assert.rejects(editDriverPaymentMetadata(db, adminEmail, standard.id, {
    paymentId: standardPayment.payment.id, amount: money("99.00"), paymentDate, method: "CASH", notes: null,
  }), { status: 409 });
  const metadataEdit = await editDriverPaymentMetadata(db, adminEmail, standard.id, {
    paymentId: standardPayment.payment.id, amount: money("100.00"), paymentDate, method: "BANK", notes: "Reference",
  });
  assert.equal(metadataEdit.changed, true);
  await assert.rejects(updateSubscriptionPayment(db, { email: adminEmail, role: "ADMIN" }, standard.id, standardCharge.id, {
    status: "UNPAID", paidDate: null, expectedRevision: 0, note: null,
  }, paymentDate), { status: 409 });

  const manual = await driver("manual-history");
  const manualCharge = await charge(manual.id, august, "20.00", "UNVERIFIED");
  const manualResult = await updateSubscriptionPayment(db, { email: adminEmail, role: "ADMIN" }, manual.id, manualCharge.id, {
    status: "PAID", paidDate: "2026-09-08", expectedRevision: 0, note: "Historical receipt",
  }, paymentDate);
  assert.equal(manualResult.changed, true);
  assert.equal((await settlement(manualCharge.id)).status, "PAID");

  await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION allocation_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'driver_payment_created' AND NEW.metadata->>'amount' = '10.35' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER allocation_test_audit_failure BEFORE INSERT ON "ActivityLog" FOR EACH ROW EXECUTE FUNCTION allocation_test_audit_failure()');
  const atomic = await driver("atomic");
  await charge(atomic.id, september, "20.00");
  try {
    await assert.rejects(record(atomic.id, "10.35"));
    assert.equal(await db.driverPayment.count({ where: { driverId: atomic.id } }), 0);
    assert.equal(await db.driverSubscriptionPaymentAllocation.count({ where: { subscriptionCharge: { driverId: atomic.id } } }), 0);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER allocation_test_audit_failure ON "ActivityLog"');
    await db.$executeRawUnsafe('DROP FUNCTION allocation_test_audit_failure()');
  }

  console.log("PASS: automatic oldest-first allocation, partial/exact/large/no-charge/exempt/inactive cases, historical compatibility, reversal, idempotency, concurrency, decimal reconciliation, safe structured audit metadata, protected editing and atomic audit rollback.");
} finally {
  await db.$disconnect();
}
