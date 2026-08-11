import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  DriverAssistantForbiddenError,
  DriverAssistantInputError,
  getAssistantDriverLedgerSummary,
  getAssistantDriverTransactions,
  searchAssistantDrivers,
  type AssistantDriverFinanceRepository,
  type AssistantDriverRecord,
} from "../src/lib/drivers/assistant-finance-core.ts";
import { calculateDriverFinancialSummary } from "../src/lib/drivers/financialMath.ts";
import { driverFinanceTools } from "../src/lib/assistant/tools/driver-finance-contracts.ts";
import type { ReservationAccessContext } from "../src/lib/reservations/assistant-read-core.ts";

const admin: ReservationAccessContext = {
  userId: "admin-1",
  email: "admin@example.com",
  role: "ADMIN",
};
const user: ReservationAccessContext = {
  userId: "user-1",
  email: "user@example.com",
  role: "USER",
};

function driver(
  id: string,
  name: string,
  patch: Partial<AssistantDriverRecord> = {},
): AssistantDriverRecord {
  return {
    id,
    name,
    licenseNumber: `LICENSE-${id}`,
    vehicleType: "SEDAN",
    subscriptionExempt: false,
    status: "ACTIVE",
    ...patch,
  };
}

function decimal(value: string) {
  return new Prisma.Decimal(value);
}

function repository(
  patch: Partial<AssistantDriverFinanceRepository> = {},
): AssistantDriverFinanceRepository {
  return {
    searchDriverCandidates: async () => ({ drivers: [], hasMore: false }),
    getDriver: async () => null,
    getFinancialSummaries: async () => new Map(),
    getFinancialSummary: async () => calculateDriverFinancialSummary(null, null, null),
    listTransactions: async () => ({ rows: [], hasMore: false }),
    getPeriodTotals: async () => ({ commissions: null, payments: null, subscriptionCharges: null }),
    ...patch,
  };
}

test("all three services authorize from canonical context before any repository access", async () => {
  let calls = 0;
  const repo = repository({
    searchDriverCandidates: async () => { calls += 1; return { drivers: [], hasMore: false }; },
    getDriver: async () => { calls += 1; return null; },
  });
  await assert.rejects(() => searchAssistantDrivers(user, {}, repo), DriverAssistantForbiddenError);
  await assert.rejects(() => getAssistantDriverLedgerSummary(user, "present-or-missing", repo), DriverAssistantForbiddenError);
  await assert.rejects(
    () => getAssistantDriverTransactions(user, { driverId: "present-or-missing", transactionType: "ALL" }, repo),
    DriverAssistantForbiddenError,
  );
  assert.equal(calls, 0);
});

test("the three finance tool schemas are strict, closed, bounded, and contain no auth override", () => {
  assert.deepEqual(driverFinanceTools.map((tool) => tool.name), [
    "search_drivers",
    "get_driver_ledger_summary",
    "get_driver_transactions",
  ]);
  for (const tool of driverFinanceTools) {
    assert.equal(tool.strict, true);
    assert.equal(tool.parameters.additionalProperties, false);
    const serialized = JSON.stringify(tool.parameters);
    assert.equal(/user_?id|email|role/i.test(serialized), false);
  }
  const search = driverFinanceTools[0].parameters.properties as Record<string, Record<string, unknown>>;
  const activity = driverFinanceTools[2].parameters.properties as Record<string, Record<string, unknown>>;
  assert.equal(search.limit.maximum, 20);
  assert.equal(activity.limit.maximum, 25);
});

test("driver search returns authoritative due, settled, and credit positions and disambiguates duplicate names", async () => {
  const records = [
    driver("d-due", "Alex"),
    driver("d-zero", "Alex", { vehicleType: null }),
    driver("d-credit", "Bea", { status: "INACTIVE", vehicleType: "VAN" }),
  ];
  const summaries = new Map([
    ["d-due", calculateDriverFinancialSummary(decimal("10.00"), null, null)],
    ["d-zero", calculateDriverFinancialSummary(decimal("10.00"), decimal("10.00"), null)],
    ["d-credit", calculateDriverFinancialSummary(null, decimal("5.25"), null)],
  ]);
  const repo = repository({
    searchDriverCandidates: async (query) => {
      let filtered = records;
      if (query.status) filtered = filtered.filter((entry) => entry.status === query.status);
      if (query.vehicleType !== undefined) {
        const vehicle = query.vehicleType === "UNSPECIFIED" ? null : query.vehicleType;
        filtered = filtered.filter((entry) => entry.vehicleType === vehicle);
      }
      const page = filtered.slice(query.offset, query.offset + query.limit + 1);
      return { drivers: page.slice(0, query.limit), hasMore: page.length > query.limit };
    },
    getFinancialSummaries: async (ids) => new Map(ids.map((id) => [id, summaries.get(id)!])),
  });

  const result = await searchAssistantDrivers(admin, { limit: 3 }, repo);
  assert.deepEqual(result.drivers.map((entry) => [entry.id, entry.balance, entry.balancePosition]), [
    ["d-due", "10.00", "DUE"],
    ["d-zero", "0.00", "SETTLED"],
    ["d-credit", "-5.25", "CREDIT"],
  ]);
  assert.equal(result.drivers[0].licenseNumber, "LICENSE-d-due");
  assert.equal(result.drivers[1].licenseNumber, "LICENSE-d-zero");
  assert.equal(result.drivers[2].licenseNumber, undefined);
  assert.equal(result.hasMore, false);

  const filtered = await searchAssistantDrivers(
    admin,
    { status: "INACTIVE", vehicleType: "VAN", balancePosition: "CREDIT" },
    repo,
  );
  assert.deepEqual(filtered.drivers.map((entry) => entry.id), ["d-credit"]);
});

test("driver search pagination is bounded and resumes after the last processed candidate", async () => {
  const records = Array.from({ length: 205 }, (_, index) => driver(`d-${index}`, `Driver ${index}`));
  let calls = 0;
  const repo = repository({
    searchDriverCandidates: async (query) => {
      calls += 1;
      const page = records.slice(query.offset, query.offset + query.limit + 1);
      return { drivers: page.slice(0, query.limit), hasMore: page.length > query.limit };
    },
    getFinancialSummaries: async (ids) => new Map(ids.map((id) => [
      id,
      calculateDriverFinancialSummary(decimal("1.00"), null, null),
    ])),
  });
  const noCredits = await searchAssistantDrivers(admin, { balancePosition: "CREDIT" }, repo);
  assert.equal(noCredits.count, 0);
  assert.equal(noCredits.hasMore, true);
  assert.equal(noCredits.nextCursor, "drv_5k");
  assert.equal(calls, 8);

  await assert.rejects(
    () => searchAssistantDrivers(admin, { limit: 21 }, repo),
    DriverAssistantInputError,
  );
});

test("ledger summary preserves Decimal precision, exact zeros, and historical charges for exempt drivers", async () => {
  const exemptDriver = driver("d-exempt", "Exempt Driver", { subscriptionExempt: true });
  const repo = repository({
    getDriver: async () => exemptDriver,
    getFinancialSummary: async () => calculateDriverFinancialSummary(
      decimal("10.10"),
      decimal("0.05"),
      decimal("10.05"),
    ),
  });
  const summary = await getAssistantDriverLedgerSummary(
    admin,
    exemptDriver.id,
    repo,
    new Date("2026-08-11T10:00:00.000Z"),
  );
  assert.deepEqual(summary && {
    commissions: summary.totalCommissions,
    payments: summary.totalPayments,
    subscriptions: summary.totalSubscriptionCharges,
    balance: summary.balance,
    position: summary.balancePosition,
  }, {
    commissions: "10.10",
    payments: "0.05",
    subscriptions: "10.05",
    balance: "0.00",
    position: "SETTLED",
  });
});

test("typed transaction pages use inclusive civil dates, deterministic totals, and authorized links", async () => {
  const record = driver("d-1", "Alex");
  let receivedQuery: Parameters<AssistantDriverFinanceRepository["listTransactions"]>[0] | undefined;
  const repo = repository({
    getDriver: async () => record,
    listTransactions: async (query) => {
      receivedQuery = query;
      return {
        hasMore: true,
        rows: [
          {
            id: "c-1",
            type: "COMMISSION",
            date: new Date("2026-08-31T00:00:00.000Z"),
            createdAt: new Date("2026-08-31T10:00:00.000Z"),
            amount: decimal("100.10"),
            manualPickupText: null,
            manualDropoffText: null,
            reservation: { id: "r-1", pickupText: "Airport", dropoffText: "City" },
          },
          {
            id: "p-1",
            type: "PAYMENT",
            date: new Date("2026-08-20T00:00:00.000Z"),
            createdAt: new Date("2026-08-20T10:00:00.000Z"),
            amount: decimal("25.05"),
            method: "BANK",
          },
          {
            id: "s-1",
            type: "SUBSCRIPTION",
            date: new Date("2026-08-01T00:00:00.000Z"),
            createdAt: new Date("2026-08-01T10:00:00.000Z"),
            amount: decimal("7.00"),
          },
        ],
      };
    },
    getPeriodTotals: async () => ({
      commissions: decimal("100.10"),
      payments: decimal("25.05"),
      subscriptionCharges: decimal("7.00"),
    }),
  });
  const result = await getAssistantDriverTransactions(admin, {
    driverId: record.id,
    transactionType: "ALL",
    fromDate: "2026-08-01",
    toDate: "2026-08-31",
    limit: 3,
    cursor: "txn_a",
  }, repo);

  assert.equal(receivedQuery?.offset, 10);
  assert.equal(receivedQuery?.fromInclusive?.toISOString(), "2026-08-01T00:00:00.000Z");
  assert.equal(receivedQuery?.toExclusive?.toISOString(), "2026-09-01T00:00:00.000Z");
  assert.deepEqual(result?.totals, {
    commissions: "100.10",
    payments: "25.05",
    subscriptionCharges: "7.00",
    netChange: "68.05",
  });
  assert.equal(result?.nextCursor, "txn_d");
  assert.equal(result?.rows[0].type === "COMMISSION" ? result.rows[0].reservation?.href : null, "/reservations/r-1/edit");
  assert.equal(JSON.stringify(result).includes("notes"), false);
});

test("commission, payment, subscription, and empty period queries keep type-specific Decimal totals", async () => {
  const record = driver("d-period", "Period Driver");
  const totalsByType = {
    COMMISSION: { commissions: decimal("12.34"), payments: null, subscriptionCharges: null },
    PAYMENT: { commissions: null, payments: decimal("5.67"), subscriptionCharges: null },
    SUBSCRIPTION: { commissions: null, payments: null, subscriptionCharges: decimal("7.00") },
    ALL: { commissions: null, payments: null, subscriptionCharges: null },
  } as const;
  let activeType: keyof typeof totalsByType = "ALL";
  const repo = repository({
    getDriver: async () => record,
    listTransactions: async (query) => {
      activeType = query.transactionType;
      return { rows: [], hasMore: false };
    },
    getPeriodTotals: async (query) => totalsByType[query.transactionType],
  });

  const expectedNet = {
    COMMISSION: "12.34",
    PAYMENT: "-5.67",
    SUBSCRIPTION: "-7.00",
    ALL: "0.00",
  } as const;
  for (const transactionType of ["COMMISSION", "PAYMENT", "SUBSCRIPTION", "ALL"] as const) {
    const result = await getAssistantDriverTransactions(admin, {
      driverId: record.id,
      transactionType,
      fromDate: "2026-08-01",
      toDate: "2026-08-31",
    }, repo);
    assert.equal(activeType, transactionType);
    assert.equal(result?.totals.netChange, expectedNet[transactionType]);
    assert.deepEqual(result?.rows, []);
    assert.equal(result?.hasMore, false);
  }
});

test("transaction validation rejects reversed dates and oversized pages before data fetch", async () => {
  let driverFetches = 0;
  const repo = repository({ getDriver: async () => { driverFetches += 1; return null; } });
  await assert.rejects(
    () => getAssistantDriverTransactions(admin, {
      driverId: "d-1",
      transactionType: "ALL",
      fromDate: "2026-08-31",
      toDate: "2026-08-01",
    }, repo),
    DriverAssistantInputError,
  );
  await assert.rejects(
    () => getAssistantDriverTransactions(admin, {
      driverId: "d-1",
      transactionType: "ALL",
      limit: 26,
    }, repo),
    DriverAssistantInputError,
  );
  assert.equal(driverFetches, 0);
});

test("the production repository exposes explicit read queries and no mutation call", () => {
  const source = readFileSync(
    new URL("../src/lib/drivers/assistant-finance-repository.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /prisma\.[a-zA-Z]+\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/,
  );
  assert.doesNotMatch(source, /\bnotes:\s*true\b/);
  assert.match(source, /select:\s*driverSelect/);
});
