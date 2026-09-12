import assert from "node:assert/strict";
import test from "node:test";
import { parseSubscriptionPaymentInput, updateSubscriptionPayment } from "../src/lib/drivers/subscriptionPaymentCore.ts";
import { currentSubscriptionStatus, subscriptionSettlement } from "../src/lib/drivers/subscriptionStatus.ts";
import type { PrismaClient } from "@prisma/client";

const now = new Date("2026-09-05T12:00:00Z");
const valid = { status: "PAID", paidDate: "2026-09-05", expectedRevision: 0, note: " Receipt 42 " };

test("payment input accepts civil dates and bounded notes, rejects malformed and financial fields", () => {
  const parsed = parseSubscriptionPaymentInput(valid, now);
  assert.equal(parsed.paidDate?.toISOString(), "2026-09-05T00:00:00.000Z");
  assert.equal(parsed.note, "Receipt 42");
  for (const input of [null, [], { ...valid, status: "UNVERIFIED" }, { ...valid, paidDate: "2026-02-30" },
    { ...valid, paidDate: "2026-09-06" }, { ...valid, paidDate: "2026-09-05T12:00:00Z" },
    { ...valid, expectedRevision: -1 }, { ...valid, expectedRevision: 0.5 }, { ...valid, note: "x".repeat(501) },
    { ...valid, amount: "7" }, { ...valid, paidByUserId: "spoof" }, { ...valid, status: "UNPAID" },
  ]) assert.throws(() => parseSubscriptionPaymentInput(input, now));
  assert.equal(parseSubscriptionPaymentInput({ status: "UNPAID", paidDate: null, expectedRevision: 2 }, now).paidDate, null);
});

test("unauthenticated and non-admin status writes fail before any database access", async () => {
  const forbiddenDatabase = new Proxy({}, { get() { throw new Error("Database must not be accessed"); } }) as PrismaClient;
  await assert.rejects(updateSubscriptionPayment(forbiddenDatabase, { email: null, role: "ADMIN" }, "d", "s", valid), { status: 401 });
  await assert.rejects(updateSubscriptionPayment(forbiddenDatabase, { email: "user@test", role: "USER" }, "d", "s", valid), { status: 403 });
});

test("current-month status comes from its record, never balances or current vehicle eligibility", () => {
  const driver = { status: "ACTIVE", subscriptionExempt: false, vehicleType: "VAN" };
  assert.equal(currentSubscriptionStatus(driver, { paymentStatus: "UNPAID" }), "UNPAID");
  assert.equal(currentSubscriptionStatus({ ...driver, status: "INACTIVE", subscriptionExempt: true }, { paymentStatus: "PAID" }), "PAID");
  assert.equal(currentSubscriptionStatus(driver, { paymentStatus: "UNVERIFIED" }), "UNVERIFIED");
  assert.equal(currentSubscriptionStatus(driver, null), "NOT_GENERATED");
  assert.equal(currentSubscriptionStatus({ ...driver, subscriptionExempt: true }, null), "EXEMPT");
  assert.equal(currentSubscriptionStatus({ ...driver, status: "INACTIVE" }, null), "INACTIVE");
  assert.equal(currentSubscriptionStatus({ ...driver, vehicleType: null }, null), "NOT_CONFIGURED");
});

test("allocated money derives exact partial and paid progress without changing historical baseline status", () => {
  assert.deepEqual(subscriptionSettlement("UNPAID", "20.00", "10.00"), {
    status: "PARTIAL", paid: "10.00", remaining: "10.00", automaticallyAllocated: "10.00",
  });
  assert.deepEqual(subscriptionSettlement("UNVERIFIED", "20.00", "20.00"), {
    status: "PAID", paid: "20.00", remaining: "0.00", automaticallyAllocated: "20.00",
  });
  assert.deepEqual(subscriptionSettlement("PAID", "20.00", "0.00"), {
    status: "PAID", paid: "20.00", remaining: "0.00", automaticallyAllocated: "0.00",
  });
});
