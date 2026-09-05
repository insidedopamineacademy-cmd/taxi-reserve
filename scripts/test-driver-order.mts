import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Prisma } from "@prisma/client";
import { alphabeticalDriverPage, sortDriversByName } from "../src/lib/drivers/driverOrder.ts";
import { prepareDriverBalanceReport } from "../src/lib/drivers/balanceReport.ts";
import { prepareDueCommissionsReport } from "../src/lib/drivers/duePdf.ts";

const drivers = [
  { id: "z", name: "zara", licenseNumber: "1" },
  { id: "alvaro", name: "Álvaro", licenseNumber: "1" },
  { id: "ali-b", name: "ali", licenseNumber: "20" },
  { id: "ali-a", name: "Ali", licenseNumber: "2" },
  { id: "ali-a2", name: "ALI", licenseNumber: "2" },
  { id: "abdullah", name: "Abdullah Hassan", licenseNumber: "99" },
];
const expected = ["abdullah", "ali-a", "ali-a2", "ali-b", "alvaro", "z"];

test("human alphabetical ordering handles mixed case, accents, numeric licences and stable IDs", () => {
  assert.deepEqual(sortDriversByName(drivers).map((driver) => driver.id), expected);
  assert.deepEqual(sortDriversByName([...drivers].reverse()).map((driver) => driver.id), expected);
  assert.equal(drivers[0].id, "z", "sorting must not mutate caller arrays");
  assert.deepEqual(sortDriversByName(drivers.filter((driver) => driver.name.toLowerCase().includes("ali"))).map((driver) => driver.id), ["ali-a", "ali-a2", "ali-b"]);
});

test("assistant candidates are sorted before pagination, regardless of database row order", () => {
  const ids = [0, 2, 4].flatMap((offset) => alphabeticalDriverPage(drivers, offset, 2).drivers.map((driver) => driver.id));
  assert.deepEqual(ids, expected);
  assert.equal(alphabeticalDriverPage(drivers, 4, 2).hasMore, false);
  assert.equal(alphabeticalDriverPage(drivers, 0, 2).hasMore, true);
});

test("pending, credits and PDF all default A–Z rather than descending money", () => {
  const lines = drivers.map((driver, index) => ({
    ...driver, summary: { balance: new Prisma.Decimal(100 - index) },
    currentMonthSubscription: null, subscriptionStatus: "NOT_RECORDED" as const,
  }));
  assert.deepEqual(prepareDriverBalanceReport(lines, "due").drivers.map((driver) => driver.id), expected);
  assert.deepEqual(prepareDueCommissionsReport(lines).drivers.map((driver) => driver.id), expected);
  const credits = lines.map((line) => ({ ...line, summary: { balance: line.summary.balance.negated() } }));
  assert.deepEqual(prepareDriverBalanceReport(credits, "credits").drivers.map((driver) => driver.id), expected);
});

test("all server driver-list producers apply the shared comparator before presentation", () => {
  for (const path of [
    "src/lib/drivers/overview.ts", "src/app/commissions/page.tsx", "src/app/payments/page.tsx",
    "src/app/reservations/[id]/edit/page.tsx", "src/app/api/drivers/full-ledger-pdf/route.ts",
    "src/lib/drivers/import-prisma.ts",
  ]) {
    assert.match(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), /sortDriversByName\(/, path);
  }
  assert.match(readFileSync(new URL("../src/lib/drivers/assistant-finance-repository.ts", import.meta.url), "utf8"), /alphabeticalDriverPage\(rows, query.offset, query.limit\)/);
  const mainPage = readFileSync(new URL("../src/app/drivers/page.tsx", import.meta.url), "utf8");
  assert.match(mainPage, /await getDriverBalanceLines\(now\)/);
});
