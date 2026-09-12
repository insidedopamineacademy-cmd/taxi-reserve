import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Settings and Admin expose role-gated in-app navigation to devices and sessions", () => {
  const settings = source("src/app/settings/page.tsx");
  const admin = source("src/app/admin/page.tsx");
  const middleware = source("src/middleware.ts");
  assert.match(settings, /session\?\.user\?\.role === "ADMIN"/);
  assert.match(settings, /href="\/admin"/);
  assert.match(settings, /Open Admin/);
  assert.match(admin, /href="\/admin\/users"/);
  assert.match(admin, /href="\/admin\/sessions"/);
  assert.match(admin, /Devices &amp; Sessions/);
  assert.match(admin, /requireAdminSettingsPage/);
  assert.match(middleware, /"\/admin"/);
});

test("Record Payment owns subscription allocation preview while Add Commission stays unchanged", () => {
  const payment = source("src/components/drivers/PaymentForm.tsx");
  const commission = source("src/components/drivers/CommissionForm.tsx");
  const newPayment = source("src/app/drivers/[id]/payments/new/page.tsx");
  assert.match(payment, /Allocation preview/);
  assert.match(payment, /Commission balance/);
  assert.match(payment, /Remaining subscription/);
  assert.match(newPayment, /getEligibleSubscriptionDebts/);
  assert.doesNotMatch(commission, /subscription|allocation/i);
});

test("payment routes use the atomic allocation core and protect amount/date edits", () => {
  const createRoute = source("src/app/api/drivers/[id]/payments/route.ts");
  const itemRoute = source("src/app/api/drivers/[id]/payments/[paymentId]/route.ts");
  const form = source("src/components/drivers/PaymentForm.tsx");
  assert.match(createRoute, /recordDriverPayment/);
  assert.doesNotMatch(createRoute, /driverPayment\.create/);
  assert.match(itemRoute, /editDriverPaymentMetadata/);
  assert.match(itemRoute, /deleteDriverPayment/);
  assert.match(form, /disabled=\{mode === "edit"\}/);
});

test("the migration is additive and the balance never adds the subscription breakdown", () => {
  const migration = source("prisma/migrations/20260912120000_add_driver_subscription_payment_allocations/migration.sql");
  const financialMath = source("src/lib/drivers/financialMath.ts");
  assert.match(migration, /CREATE TABLE "DriverSubscriptionPaymentAllocation"/);
  assert.match(migration, /ON DELETE CASCADE/);
  assert.doesNotMatch(migration, /\b(?:DROP TABLE|DROP COLUMN|TRUNCATE TABLE|DELETE FROM|UPDATE ")/);
  assert.match(financialMath, /balance: totalCommissions\.minus\(totalPayments\)/);
  assert.doesNotMatch(financialMath, /balance:\s*totalCommissions\.(?:plus|minus)\(totalSubscriptionCharges\)/);
});

test("ledger and pending UI expose paid, remaining, partial, and allocation detail", () => {
  const subscriptions = source("src/components/drivers/SubscriptionHistory.tsx");
  const ledger = source("src/app/drivers/[id]/page.tsx");
  const pending = source("src/components/drivers/DriverBalanceList.tsx");
  assert.match(subscriptions, />Paid</);
  assert.match(subscriptions, />Remaining</);
  assert.match(subscriptions, /Historical reconciliation/);
  assert.match(ledger, /Commission balance/);
  assert.match(pending, /subscriptionPaid/);
  assert.match(pending, /subscriptionRemaining/);
});
