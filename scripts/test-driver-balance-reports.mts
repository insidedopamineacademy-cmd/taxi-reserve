import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { prepareDriverBalanceReport, formatBalanceEuro } from "../src/lib/drivers/balanceReport.ts";
import { calculateDriverFinancialSummary, calculateDriverFinancePosition } from "../src/lib/drivers/financialMath.ts";
import { prepareDueCommissionsReport, buildDueCommissionsPdf } from "../src/lib/drivers/duePdf.ts";
import { getMadridFinancialPeriods } from "../src/lib/drivers/financialDateCore.ts";
import { isDriverAdminRole } from "../src/lib/drivers/access-core.ts";

const dec = (value: string) => new Prisma.Decimal(value);
const line = (id: string, commissions: string, payments: string, subscriptions: string, current: string | null) => ({
  id, name: id, licenseNumber: `VTC-${id}`,
  summary: calculateDriverFinancialSummary(dec(commissions), dec(payments), dec(subscriptions)),
  currentMonthSubscription: current === null ? null : dec(current),
});

test("opposite datasets exclude zero and reconcile exactly to the canonical KPI totals", () => {
  const lines = [
    line("due", "300.30", "35.10", "40.00", "20.00"),
    line("credit", "10.10", "22.22", "7.00", "7.00"),
    line("zero", "20", "13", "7", "7"),
    line("cents", "0.30", "0.10", "0", null),
    line("credit-2", "0", "0.10", "0", null),
  ];
  const order = lines.map(({ id }) => id);
  const position = calculateDriverFinancePosition(lines.map(({ summary }) => summary));
  const credits = prepareDriverBalanceReport(lines, "credits");
  const due = prepareDriverBalanceReport(lines, "due");
  const pdf = prepareDueCommissionsReport(lines);
  assert.deepEqual(credits.drivers.map(({ id }) => id), ["credit", "credit-2"]);
  assert.deepEqual(due.drivers.map(({ id }) => id), ["due", "cents"]);
  assert.equal(credits.total, "19.22");
  assert.equal(credits.total, position.driverCredits.toFixed(2));
  assert.equal(due.total, "225.40");
  assert.equal(due.total, position.totalCommissionDue.toFixed(2));
  assert.equal(pdf.totalDue, due.total);
  assert.deepEqual(pdf.drivers, due.drivers);
  assert.deepEqual(lines.map(({ id }) => id), order);
});

test("monthly subscription is the stored current charge, with past months already in final balance", async () => {
  const source = line("multiple-months", "300.30", "35.10", "40.00", "20.00");
  const report = prepareDueCommissionsReport([source, line("no-charge", "1.10", "0.90", "0", null)]);
  assert.equal(source.summary.balance.toFixed(2), "225.20", "300.30 - 35.10 - 40.00");
  assert.equal(report.drivers[0].subscription, "20.00", "current month only, not all 40.00");
  assert.equal(report.drivers[0].balance, "225.20", "subscription is neither added nor deducted again");
  assert.equal(report.drivers[1].subscription, "0.00");
  assert.equal(report.totalDue, "225.40");
  // Missing current month must not fall back to historical charges or a vehicle rate.
  assert.equal(prepareDueCommissionsReport([{ ...source, currentMonthSubscription: null }]).drivers[0].subscription, "0.00");
  assert.equal(prepareDueCommissionsReport([{ ...source, currentMonthSubscription: dec("12.34") }]).drivers[0].subscription, "12.34");
  await buildDueCommissionsPdf({ ...report, generatedDate: "05 Sep 2026", subscriptionMonth: "septiembre de 2026" });
});

test("credit order is largest credit first with stable name, licence and id ties", () => {
  const a = line("a", "0", "10", "0", null);
  const b = { ...a, id: "b" };
  const c = { ...a, id: "c", licenseNumber: "ZZZ" };
  const biggest = line("biggest", "0", "20", "0", null);
  const lines = [c, b, biggest, a];
  assert.deepEqual(prepareDriverBalanceReport(lines, "credits").drivers.map(({ id }) => id), ["biggest", "a", "b", "c"]);
  assert.deepEqual(prepareDriverBalanceReport([], "credits"), { total: "0.00", drivers: [] });
  assert.deepEqual(prepareDriverBalanceReport([], "due"), { total: "0.00", drivers: [] });
});

test("Madrid month boundaries use normalized civil subscription dates", () => {
  assert.equal(getMadridFinancialPeriods(new Date("2026-08-31T21:59:59Z")).monthStart.toISOString(), "2026-08-01T00:00:00.000Z");
  assert.equal(getMadridFinancialPeriods(new Date("2026-08-31T22:00:00Z")).monthStart.toISOString(), "2026-09-01T00:00:00.000Z");
  assert.equal(getMadridFinancialPeriods(new Date("2026-12-31T23:00:00Z")).monthStart.toISOString(), "2027-01-01T00:00:00.000Z");
});

test("shared pages guard admin access before querying financial data", () => {
  assert.equal(isDriverAdminRole("ADMIN"), true);
  for (const role of ["USER", undefined, null, "admin"]) assert.equal(isDriverAdminRole(role), false);
  const page = readFileSync(new URL("../src/components/drivers/DriverBalancePage.tsx", import.meta.url), "utf8");
  assert.ok(page.indexOf("await requireDriverAdminPage()") < page.indexOf("await getDriverBalanceLines(now)"));
  for (const kind of ["credits", "due"]) {
    const route = readFileSync(new URL(`../src/app/drivers/${kind}/page.tsx`, import.meta.url), "utf8");
    assert.ok(route.includes(`<DriverBalancePage kind="${kind}"`));
  }
});

test("currency preserves its euro gap, cents and very large amounts", () => {
  assert.deepEqual(["0", "7", "20", "245", "2025", "99999999.99"].map(formatBalanceEuro), [
    "€ 0.00", "€ 7.00", "€ 20.00", "€ 245.00", "€ 2,025.00", "€ 99,999,999.99",
  ]);
});
