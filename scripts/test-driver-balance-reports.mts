import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { prepareDriverBalanceReport, formatBalanceEuro } from "../src/lib/drivers/balanceReport.ts";
import { calculateDriverFinancialSummary, calculateDriverFinancePosition } from "../src/lib/drivers/financialMath.ts";
import { prepareDueCommissionsReport, buildDueCommissionsPdf } from "../src/lib/drivers/duePdf.ts";
import { buildDriverLedgerPdf, buildFullDriverLedgerPdf } from "../src/lib/drivers/pdf.ts";
import { getMadridFinancialPeriods } from "../src/lib/drivers/financialDateCore.ts";
import { isDriverAdminRole } from "../src/lib/drivers/access-core.ts";

const dec = (value: string) => new Prisma.Decimal(value);
const line = (id: string, commissions: string, payments: string, subscriptions: string, current: string | null) => ({
  id, name: id, licenseNumber: `VTC-${id}`,
  summary: calculateDriverFinancialSummary(dec(commissions), dec(payments), dec(subscriptions)),
  currentMonthSubscription: current === null ? null : dec(current),
  subscriptionStatus: "UNPAID" as const,
});

async function pdfText(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes);
  return pdf.getPages().flatMap((page) => {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray
      ? contents.asArray().map((ref) => pdf.context.lookup(ref))
      : [contents];
    return streams.flatMap((stream) => {
      assert.ok(stream instanceof PDFRawStream);
      const operators = Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
      return [...operators.matchAll(/<([0-9A-F]+)>\s*Tj/g)].map((match) =>
        Buffer.from(match[1], "hex").toString("latin1"));
    });
  }).join(" ");
}

test("opposite datasets exclude zero and reconcile exactly to the canonical KPI totals", () => {
  const lines = [
    line("due", "300.30", "35.10", "40.00", "20.00"),
    line("credit", "10.10", "22.22", "7.00", "7.00"),
    line("zero", "20", "20", "7", "7"),
    line("cents", "0.30", "0.10", "0", null),
    line("credit-2", "0", "0.10", "0", null),
  ];
  const order = lines.map(({ id }) => id);
  const position = calculateDriverFinancePosition(lines.map(({ summary }) => summary));
  const credits = prepareDriverBalanceReport(lines, "credits");
  const due = prepareDriverBalanceReport(lines, "due");
  const pdf = prepareDueCommissionsReport(lines);
  assert.deepEqual(credits.drivers.map(({ id }) => id), ["credit", "credit-2"]);
  assert.deepEqual(due.drivers.map(({ id }) => id), ["cents", "due"]);
  assert.equal(credits.total, "12.22");
  assert.equal(credits.total, position.driverCredits.toFixed(2));
  assert.equal(due.total, "265.40");
  assert.equal(due.total, position.totalCommissionDue.toFixed(2));
  assert.equal(pdf.totalDue, due.total);
  assert.deepEqual(pdf.drivers, due.drivers);
  assert.deepEqual(lines.map(({ id }) => id), order);
});

test("monthly subscription is the stored current charge, with past months already in final balance", async () => {
  const source = line("multiple-months", "300.30", "35.10", "40.00", "20.00");
  const report = prepareDueCommissionsReport([source, line("no-charge", "1.10", "0.90", "0", null)]);
  assert.equal(source.summary.balance.toFixed(2), "265.20", "300.30 - 35.10; 40.00 is a breakdown");
  assert.equal(report.drivers[0].subscription, "20.00", "current month only, not all 40.00");
  assert.equal(report.drivers[0].balance, "265.20", "subscription is neither added nor deducted again");
  assert.equal(report.drivers[1].subscription, "0.00");
  assert.equal(report.totalDue, "265.40");
  // Missing current month must not fall back to historical charges or a vehicle rate.
  assert.equal(prepareDueCommissionsReport([{ ...source, currentMonthSubscription: null }]).drivers[0].subscription, "0.00");
  assert.equal(prepareDueCommissionsReport([{ ...source, currentMonthSubscription: dec("12.34") }]).drivers[0].subscription, "12.34");
  await buildDueCommissionsPdf({ ...report, generatedDate: "05 Sep 2026", subscriptionMonth: "septiembre de 2026" });
});

test("€264 combined charges with a €20 subscription reconcile across web, KPI, pending PDF and both ledgers", async () => {
  const source = line("observed-production-shape", "264.00", "0.00", "20.00", "20.00");
  assert.equal(source.summary.totalCommissions.toFixed(2), "264.00");
  assert.equal(source.summary.totalSubscriptionCharges.toFixed(2), "20.00");
  assert.equal(source.summary.totalCommissions.minus(source.summary.totalSubscriptionCharges).toFixed(2), "244.00");
  assert.equal(source.summary.balance.toFixed(2), "264.00");

  const position = calculateDriverFinancePosition([source.summary]);
  const pending = prepareDriverBalanceReport([source], "due");
  const credits = prepareDriverBalanceReport([source], "credits");
  const duePdf = prepareDueCommissionsReport([source]);
  assert.equal(position.totalCommissionDue.toFixed(2), "264.00");
  assert.equal(pending.total, "264.00");
  assert.equal(pending.drivers[0].balance, "264.00");
  assert.equal(credits.total, "0.00");
  assert.equal(duePdf.totalDue, "264.00");

  const individualText = await pdfText(await buildDriverLedgerPdf({
    driverName: "Reconciliation Driver", licenseNumber: "TEST-264", generatedDate: "12 Sep 2026",
    totalCommissions: "264.00", totalPayments: "0.00", totalSubscriptionCharges: "20.00",
    balance: source.summary.balance.toFixed(2), commissions: [], payments: [], subscriptions: [],
  }));
  const fullText = await pdfText(await buildFullDriverLedgerPdf({
    generatedAt: "12 Sep 2026",
    drivers: [{
      name: "Reconciliation Driver", licenseNumber: "TEST-264", status: "ACTIVE",
      totalCommissions: "264.00", totalPayments: "0.00", totalSubscriptionCharges: "20.00",
      balance: source.summary.balance.toFixed(2), commissions: [], payments: [], subscriptions: [],
    }],
  }));
  const pendingText = await pdfText(await buildDueCommissionsPdf({
    ...duePdf, generatedDate: "12 Sep 2026", subscriptionMonth: "septiembre de 2026",
  }));
  for (const text of [individualText, fullText]) {
    assert.match(text, /Total charges/);
    assert.match(text, /Subscription component/);
    assert.match(text, /EUR 264\.00/);
  }
  assert.match(pendingText, /264\.00/);
});

test("authoritative balance ignores subscription breakdown and preserves Decimal edge cases", () => {
  const cases = [
    ["0.01", "0.00", "0.01", "0.01"],
    ["7.00", "0.00", "7.00", "7.00"],
    ["20.00", "0.00", "20.00", "20.00"],
    ["264.00", "100.00", "20.00", "164.00"],
    ["1,234.56", "0.00", "20.00", "1,234.56"],
  ] as const;
  for (const [charges, payments, subscription, expected] of cases) {
    const normalizedCharges = charges.replace(",", "");
    const normalizedExpected = expected.replace(",", "");
    assert.equal(
      calculateDriverFinancialSummary(dec(normalizedCharges), dec(payments), dec(subscription)).balance.toFixed(2),
      normalizedExpected,
    );
  }
  assert.equal(calculateDriverFinancialSummary(dec("100.00"), dec("125.00"), dec("20.00")).balance.toFixed(2), "-25.00");
  assert.equal(calculateDriverFinancialSummary(dec("264.00"), dec("100.00"), null).balance.toFixed(2), "164.00");
});

test("credit order is alphabetical with stable name, licence and id ties", () => {
  const a = line("a", "0", "10", "0", null);
  const b = { ...a, id: "b" };
  const c = { ...a, id: "c", licenseNumber: "ZZZ" };
  const biggest = line("biggest", "0", "20", "0", null);
  const lines = [c, b, biggest, a];
  assert.deepEqual(prepareDriverBalanceReport(lines, "credits").drivers.map(({ id }) => id), ["a", "b", "c", "biggest"]);
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
