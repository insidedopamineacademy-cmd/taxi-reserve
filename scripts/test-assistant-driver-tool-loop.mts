import assert from "node:assert/strict";
import test from "node:test";
import { AssistantTransportError } from "../src/lib/assistant/errors.ts";
import {
  runReservationAssistantToolLoop,
  type AssistantModelOutputItem,
  type AssistantModelRequest,
  type AssistantToolLoopDependencies,
} from "../src/lib/assistant/tool-loop.ts";
import { DriverAssistantForbiddenError } from "../src/lib/drivers/assistant-finance-core.ts";
import type {
  AssistantDriverLedgerSummaryData,
  AssistantDriverResultData,
  AssistantDriverTransactionsData,
} from "../src/lib/drivers/assistant-finance-core.ts";
import type { AssistantStreamEvent } from "../src/lib/assistant/stream-protocol.ts";
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

const driverCard = (id: string, name = "Alex", balance = "12.50"): AssistantDriverResultData => ({
  id,
  name,
  status: "ACTIVE",
  vehicleType: "SEDAN",
  href: `/drivers/${id}`,
  balance,
  balancePosition: balance.startsWith("-") ? "CREDIT" : balance === "0.00" ? "SETTLED" : "DUE",
  currency: "EUR",
});

const summary = (balance = "12.50"): AssistantDriverLedgerSummaryData => ({
  driver: {
    id: "d-1",
    name: "Alex",
    status: "ACTIVE",
    vehicleType: "SEDAN",
    href: "/drivers/d-1",
  },
  currency: "EUR",
  totalCommissions: "20.00",
  totalPayments: "5.00",
  totalSubscriptionCharges: "2.50",
  balance,
  balancePosition: balance.startsWith("-") ? "CREDIT" : balance === "0.00" ? "SETTLED" : "DUE",
  calculatedAt: "2026-08-11T10:00:00.000Z",
});

const transactions: AssistantDriverTransactionsData = {
  driver: summary().driver,
  transactionType: "ALL",
  period: { from: "2026-08-01", to: "2026-08-31" },
  pageCursor: null,
  currency: "EUR",
  totals: {
    commissions: "20.00",
    payments: "5.00",
    subscriptionCharges: "2.50",
    netChange: "12.50",
  },
  rows: [
    {
      id: "c-1",
      type: "COMMISSION",
      date: "2026-08-10",
      amount: "20.00",
      source: "RESERVATION",
      route: { pickup: "Airport", dropoff: "City" },
      reservation: { id: "r-1", href: "/reservations/r-1/edit" },
    },
  ],
  hasMore: false,
  nextCursor: null,
};

const searchArgs = {
  query: "Alex",
  status: "ANY",
  vehicle_type: "ANY",
  balance_position: "ANY",
  limit: null,
  cursor: null,
};
const transactionArgs = {
  driver_id: "d-1",
  transaction_type: "ALL",
  from_date: "2026-08-01",
  to_date: "2026-08-31",
  limit: 10,
  cursor: null,
};

function call(name: string, args: unknown, callId = `call-${name}`): AssistantModelOutputItem {
  return { type: "function_call", name, call_id: callId, arguments: JSON.stringify(args) };
}

function scripted(
  rounds: Array<{ output: AssistantModelOutputItem[]; text?: string }>,
  patch: Partial<AssistantToolLoopDependencies> = {},
) {
  const requests: AssistantModelRequest[] = [];
  const dependencies: AssistantToolLoopDependencies = {
    async streamModel(request) {
      requests.push(request);
      const next = rounds.shift();
      assert.ok(next);
      if (next.text) request.onTextDelta(next.text);
      return { output: next.output };
    },
    searchReservations: async () => [],
    getReservation: async () => null,
    searchDrivers: async () => ({ drivers: [], count: 0, hasMore: false, nextCursor: null }),
    getDriverLedgerSummary: async () => null,
    getDriverTransactions: async () => null,
    now: () => new Date("2026-08-11T09:30:00.000Z"),
    ...patch,
  };
  return { dependencies, requests };
}

async function run(
  dependencies: AssistantToolLoopDependencies,
  authContext = admin,
) {
  const events: AssistantStreamEvent[] = [];
  await runReservationAssistantToolLoop({
    message: "Driver finance question",
    context: [],
    authContext,
    signal: new AbortController().signal,
    emit: (event) => events.push(event),
  }, dependencies);
  return events;
}

test("A: one driver match chains to the authoritative ledger summary", async () => {
  const result = { drivers: [driverCard("d-1")], count: 1, hasMore: false, nextCursor: null };
  const { dependencies, requests } = scripted([
    { output: [call("search_drivers", searchArgs, "call-search")] },
    { output: [call("get_driver_ledger_summary", { driver_id: "d-1" }, "call-summary")] },
    { output: [{ type: "message" }], text: "Alex has €12.50 due." },
  ], {
    searchDrivers: async () => result,
    getDriverLedgerSummary: async () => summary(),
  });
  const events = await run(dependencies);
  assert.deepEqual(requests[0].tools.map((tool) => tool.name), [
    "search_reservations",
    "get_reservation",
    "search_drivers",
    "get_driver_ledger_summary",
    "get_driver_transactions",
  ]);
  assert.equal(events.filter((event) => event.type === "assistant.driver_result").length, 1);
  assert.equal(events.filter((event) => event.type === "assistant.driver_financial_summary").length, 1);
  assert.match(requests[0].instructions, /positive driver balance is due/);
  assert.match(requests[0].instructions, /ADMIN-only/);
});

test("D: duplicate names remain separate bounded cards for clarification", async () => {
  const first = { ...driverCard("d-1"), licenseNumber: "L-1" };
  const second = { ...driverCard("d-2"), licenseNumber: "L-2" };
  const { dependencies } = scripted([
    { output: [call("search_drivers", searchArgs)] },
    { output: [{ type: "message" }], text: "I found two Alex records. Which license do you mean?" },
  ], {
    searchDrivers: async () => ({ drivers: [first, second], count: 2, hasMore: false, nextCursor: null }),
  });
  const events = await run(dependencies);
  assert.deepEqual(events.filter((event) => event.type === "assistant.driver_result").map((event) =>
    event.type === "assistant.driver_result" && event.driver.licenseNumber,
  ), ["L-1", "L-2"]);
});

test("ledger summary streams server-owned due, zero, and credit strings without client arithmetic", async () => {
  for (const balance of ["12.50", "0.00", "-4.25"]) {
    const { dependencies } = scripted([
      { output: [call("get_driver_ledger_summary", { driver_id: "d-1" })] },
      { output: [{ type: "message" }] },
    ], { getDriverLedgerSummary: async () => summary(balance) });
    const events = await run(dependencies);
    const event = events.find((candidate) => candidate.type === "assistant.driver_financial_summary");
    assert.equal(event?.type === "assistant.driver_financial_summary" ? event.summary.balance : null, balance);
  }
});

test("B: a this-month commissions request chains search to typed period activity", async () => {
  let filters: unknown;
  const { dependencies, requests } = scripted([
    { output: [call("search_drivers", searchArgs, "call-search")] },
    { output: [call("get_driver_transactions", { ...transactionArgs, transaction_type: "COMMISSION" }, "call-transactions")] },
    { output: [{ type: "message" }], text: "One commission this month." },
  ], {
    searchDrivers: async () => ({ drivers: [driverCard("d-1")], count: 1, hasMore: false, nextCursor: null }),
    getDriverTransactions: async (_context, input) => {
      filters = input;
      return { ...transactions, transactionType: "COMMISSION" };
    },
  });
  const events = await run(dependencies);
  assert.deepEqual(filters, {
    driverId: "d-1",
    transactionType: "COMMISSION",
    fromDate: "2026-08-01",
    toDate: "2026-08-31",
    limit: 10,
  });
  assert.equal(events.filter((event) => event.type === "assistant.driver_transactions").length, 1);
  assert.equal(JSON.stringify(requests[2].input).includes("notes"), false);
  assert.match(requests[0].instructions, /This financial month: 2026-08-01 to 2026-08-31/);
});

test("C: outstanding balances use the server-classified DUE search filter and stay bounded", async () => {
  let filters: unknown;
  const { dependencies } = scripted([
    { output: [call("search_drivers", { ...searchArgs, query: null, balance_position: "DUE", limit: 20 })] },
    { output: [{ type: "message" }], text: "One driver currently has an amount due." },
  ], {
    searchDrivers: async (_context, input) => {
      filters = input;
      return { drivers: [driverCard("d-1")], count: 1, hasMore: false, nextCursor: null };
    },
  });
  const events = await run(dependencies);
  assert.deepEqual(filters, { balancePosition: "DUE", limit: 20 });
  assert.equal(events.filter((event) => event.type === "assistant.driver_result").length, 1);
});

test("E: USER calls for every driver-finance tool return one permission-safe token and no cards", async () => {
  const cases = [
    ["search_drivers", searchArgs, "searchDrivers"],
    ["get_driver_ledger_summary", { driver_id: "secret-id" }, "getDriverLedgerSummary"],
    ["get_driver_transactions", transactionArgs, "getDriverTransactions"],
  ] as const;
  for (const [tool, args, dependency] of cases) {
    const patch = {
      [dependency]: async () => { throw new DriverAssistantForbiddenError(); },
    } as Partial<AssistantToolLoopDependencies>;
    const { dependencies, requests } = scripted([
      { output: [call(tool, args)] },
      { output: [{ type: "message" }], text: "That information is unavailable for this account." },
    ], patch);
    const events = await run(dependencies, user);
    const serialized = JSON.stringify(requests[1].input);
    const toolResult = requests[1].input.find((item) => item.type === "function_call_output");
    assert.match(serialized, /NOT_AUTHORIZED/);
    assert.equal(
      toolResult?.type === "function_call_output" ? toolResult.output : null,
      JSON.stringify({ ok: false, error: "NOT_AUTHORIZED" }),
    );
    assert.equal(serialized.includes("restricted"), false);
    assert.equal(events.some((event) => event.type.startsWith("assistant.driver_")), false);
  }
});

test("chained search, ledger, and activity calls stay inside the existing bounded loop and deduplicate cards", async () => {
  const result = { drivers: [driverCard("d-1")], count: 1, hasMore: false, nextCursor: null };
  const { dependencies } = scripted([
    { output: [call("search_drivers", searchArgs, "call-1")] },
    { output: [call("get_driver_ledger_summary", { driver_id: "d-1" }, "call-2")] },
    { output: [call("get_driver_transactions", transactionArgs, "call-3")] },
    { output: [{ type: "message" }], text: "Driver ledger ready." },
  ], {
    searchDrivers: async () => result,
    getDriverLedgerSummary: async () => summary(),
    getDriverTransactions: async () => transactions,
  });
  const events = await run(dependencies);
  assert.equal(events.filter((event) => event.type === "assistant.driver_result").length, 1);
  assert.equal(events.filter((event) => event.type === "assistant.driver_financial_summary").length, 1);
  assert.equal(events.filter((event) => event.type === "assistant.driver_transactions").length, 1);
});

test("F: malformed finance arguments and forged roles fail exact validation", async () => {
  const { dependencies } = scripted([{ output: [
    call("search_drivers", { ...searchArgs, role: "ADMIN" }),
  ] }]);
  await assert.rejects(
    () => run(dependencies, user),
    (error: unknown) => error instanceof AssistantTransportError && error.code === "TOOL_VALIDATION_FAILED",
  );
});

test("G: an unregistered finance write tool is rejected", async () => {
  const { dependencies } = scripted([{ output: [
    call("create_driver_payment", { driver_id: "d-1", amount: "1.00" }),
  ] }]);
  await assert.rejects(
    () => run(dependencies, admin),
    (error: unknown) => error instanceof AssistantTransportError && error.code === "UNKNOWN_TOOL",
  );
});
