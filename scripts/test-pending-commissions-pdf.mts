import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { PDFDocument, PDFArray, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import {
  PENDING_COMMISSIONS_COLUMNS,
  buildDueCommissionsPdf,
  formatPendingEuro,
  prepareDueCommissionsReport,
  type DueCommissionBalanceLine,
} from "../src/lib/drivers/duePdf.ts";
import {
  calculateDriverFinancePosition,
  calculateDriverFinancialSummary,
} from "../src/lib/drivers/financialMath.ts";

function balanceLine(
  id: string,
  name: string,
  licenseNumber: string | null,
  balance: string,
): DueCommissionBalanceLine {
  return {
    id,
    name,
    licenseNumber,
    summary: { balance: new Prisma.Decimal(balance) },
    currentMonthSubscription: null,
    subscriptionStatus: "NOT_RECORDED",
  };
}

async function pageTexts(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes);
  return pdf.getPages().map((page) => {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray
      ? contents.asArray().map((ref) => pdf.context.lookup(ref))
      : [contents];
    return streams.flatMap((stream) => {
      assert.ok(stream instanceof PDFRawStream);
      const operators = Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
      return [...operators.matchAll(/<([0-9A-F]+)>\s*Tj/g)].map((match) =>
        Buffer.from(match[1], "hex").toString("latin1").replace(/\x80/g, "€"));
    });
  });
}

test("rendered PDF text keeps the subscription separate, repeats headers, and totals only on the final page", async () => {
  const lines = Array.from({ length: 36 }, (_, index) => ({
    ...balanceLine(String(index), `Driver ${index}`, index === 1 ? "VTC-LONG-LICENCE-IDENTIFIER-048" : `VTC-${index}`, index === 0 ? "99999999.99" : "245.00"),
    currentMonthSubscription: index === 0 ? new Prisma.Decimal("20.00") : null,
    subscriptionStatus: index % 3 === 0 ? "PAID" as const : index % 3 === 1 ? "UNPAID" as const : "UNVERIFIED" as const,
  }));
  const report = prepareDueCommissionsReport(lines);
  const pages = await pageTexts(await buildDueCommissionsPdf({
    ...report, generatedDate: "05 Sep 2026", subscriptionMonth: "septiembre de 2026",
  }));
  assert.equal(pages.length, 2);
  for (const [index, text] of pages.entries()) {
    for (const column of PENDING_COMMISSIONS_COLUMNS) assert.ok(text.includes(column.toUpperCase()));
    assert.equal(text.includes("Total pendiente"), index === pages.length - 1);
  }
  assert.ok(pages[0].includes("€ 20.00"));
  for (const status of ["PAGADO", "PENDIENTE", "SIN VERIFICAR"]) assert.ok(pages[0].includes(status));
  assert.ok(pages[0].includes("€ 0.00"));
  assert.ok(pages[0].includes("€ 99,999,999.99"), "the full large balance is one unwrapped text operation");
  assert.ok(pages.flat().includes(formatPendingEuro(report.totalDue)));
  assert.ok(pages[0].some((text) => text.includes("septiembre de 2026")));
});

test("only positive authoritative balances appear and total with Decimal arithmetic", () => {
  const source = [
    balanceLine("low", "Muneeb", "3301", "0.10"),
    balanceLine("zero", "Zero", "0000", "0.00"),
    balanceLine("credit", "Credit", "CREDIT", "-200.00"),
    balanceLine("high", "Farrakh", "1293", "161.20"),
    balanceLine("middle", "Maradona", "6280", "152.35"),
  ];
  const sourceOrder = source.map((line) => line.id);

  const report = prepareDueCommissionsReport(source);

  assert.deepEqual(report.drivers.map((driver) => driver.name), [
    "Farrakh",
    "Maradona",
    "Muneeb",
  ]);
  assert.equal(report.totalDue, "313.65");
  assert.deepEqual(source.map((line) => line.id), sourceOrder, "preparation must not mutate input");
});

test("equal balances use deterministic name, licence, and identity ordering", () => {
  const report = prepareDueCommissionsReport([
    balanceLine("3", "Zara", "20", "78.00"),
    balanceLine("2", "Alba", "20", "78.00"),
    balanceLine("1", "Alba", "10", "78.00"),
  ]);

  assert.deepEqual(
    report.drivers.map((driver) => `${driver.name}:${driver.licenseNumber}`),
    ["Alba:10", "Alba:20", "Zara:20"],
  );
});

test("licence values are preserved and a missing value gets a safe fallback", () => {
  const report = prepareDueCommissionsReport([
    balanceLine("present", "Present", "  VTC-047  ", "1.00"),
    balanceLine("missing", "Missing", null, "2.00"),
    balanceLine("blank", "Blank", "   ", "3.00"),
  ]);

  assert.equal(report.drivers.find((driver) => driver.name === "Present")?.licenseNumber, "VTC-047");
  assert.equal(report.drivers.find((driver) => driver.name === "Missing")?.licenseNumber, "-");
  assert.equal(report.drivers.find((driver) => driver.name === "Blank")?.licenseNumber, "-");
});

test("the report contract contains exactly the four requested columns", () => {
  assert.deepEqual(PENDING_COMMISSIONS_COLUMNS, [
    "Conductor",
    "Licencia",
    "Suscripción",
    "Pendiente",
  ]);
  const source = readFileSync(
    new URL("../src/lib/drivers/duePdf.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /totalCommissions|totalPayments|totalSubscriptionCharges/);
  assert.match(
    source,
    /function addTablePage[\s\S]*?drawDocumentHeader\(writer, true\);[\s\S]*?drawTableHeader\(writer\);/,
    "continuation pages must repeat the report and table headers",
  );
});

test("pending money uses one visible euro gap, exact decimals, and grouping", () => {
  assert.deepEqual(
    ["3", "8", "78", "161", "1935", "1234567.89"].map(formatPendingEuro),
    [
      "€ 3.00",
      "€ 8.00",
      "€ 78.00",
      "€ 161.00",
      "€ 1,935.00",
      "€ 1,234,567.89",
    ],
  );
});

test("PDF generation rejects a total that does not reconcile with displayed rows", async () => {
  await assert.rejects(
    () => buildDueCommissionsPdf({
      generatedDate: "18 Aug 2026",
      subscriptionMonth: "agosto de 2026",
      totalDue: "100.00",
      drivers: [{ id: "driver", name: "Driver", licenseNumber: "100", balance: "99.99", subscription: "20.00", subscriptionStatus: "UNPAID" }],
    }),
    /does not reconcile/,
  );
});

test("a long report paginates and an empty report remains a valid single-page PDF", async () => {
  const lines = Array.from({ length: 80 }, (_, index) =>
    balanceLine(
      `driver-${index}`,
      index === 10
        ? "A Very Long Driver Name That Must Wrap Safely Without Cutting The Row"
        : `Driver ${String(index + 1).padStart(2, "0")}`,
      index === 11 ? "VTC-LONG-LICENCE-IDENTIFIER-048" : `VTC-${index + 1}`,
      `${1000 - index}.25`,
    ),
  );
  const report = prepareDueCommissionsReport(lines);
  const bytes = await buildDueCommissionsPdf({
    generatedDate: "18 Aug 2026",
      subscriptionMonth: "agosto de 2026",
    ...report,
  });
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 3);

  const emptyBytes = await buildDueCommissionsPdf({
    generatedDate: "18 Aug 2026",
      subscriptionMonth: "agosto de 2026",
    totalDue: "0.00",
    drivers: [],
  });
  const emptyPdf = await PDFDocument.load(emptyBytes);
  assert.equal(emptyPdf.getPageCount(), 1);
});

test("Pending PDF stays gross while the finance position reconciles to net (credits never offset the collections total)", () => {
  // Fixture: two drivers owe (gross pending €765), one holds €359 credit.
  // dec(commissions, payments) -> balance = commissions - payments.
  const dec = (value: string) => new Prisma.Decimal(value);
  const summaries = [
    calculateDriverFinancialSummary(dec("500.00"), null, null), // +500 owed
    calculateDriverFinancialSummary(dec("265.00"), null, null), // +265 owed
    calculateDriverFinancialSummary(null, dec("359.00"), null), // -359 credit
  ];

  const position = calculateDriverFinancePosition(summaries);
  assert.equal(position.totalCommissionDue.toFixed(2), "765.00", "gross pending is positive balances only");
  assert.equal(position.driverCredits.toFixed(2), "359.00", "credits are the absolute negative balances");
  assert.equal(position.netPosition.toFixed(2), "406.00", "net = pending - credits");

  const report = prepareDueCommissionsReport([
    balanceLine("owes-a", "Driver A", "A-01", "500.00"),
    balanceLine("owes-b", "Driver B", "B-02", "265.00"),
    balanceLine("credit-c", "Driver C", "C-03", "-359.00"),
  ]);

  // The collections report must show the GROSS pending total (€765), not the
  // net (€406). A driver's credit does not make another driver owe less.
  assert.equal(report.totalDue, "765.00");
  assert.equal(report.drivers.length, 2, "credit balances are excluded from the report");
  assert.equal(report.totalDue, position.totalCommissionDue.toFixed(2), "PDF total equals gross pending");
  assert.notEqual(report.totalDue, position.netPosition.toFixed(2), "PDF total must NOT equal the net position");
});

test("the protected endpoint keeps authentication, authorization, authoritative data, and display date", () => {
  const route = readFileSync(
    new URL("../src/app/api/drivers/due-pdf/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /await getDriverAdminAccess\(\)/);
  assert.match(route, /!access\.authenticated/);
  assert.match(route, /status: 401/);
  assert.match(route, /!access\.authorized/);
  assert.match(route, /status: 403/);
  assert.match(route, /getDriverBalanceLines\(now\)/);
  assert.match(route, /formatMadridDateDisplay\(now\)/);
});
