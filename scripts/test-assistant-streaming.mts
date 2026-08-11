import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAssistantStreamEvent,
  buildAssistantConversationContext,
  createAssistantNetworkError,
  createPendingAssistantMessage,
  disablePreviousRetries,
  markAssistantMessageFailed,
  markAssistantMessageStopped,
} from "../src/components/assistant/assistantStreaming.ts";
import type { AssistantMessage } from "../src/components/assistant/types.ts";
import {
  AssistantSseDecoder,
  encodeAssistantStreamEvent,
  type AssistantReservationCardData,
  type AssistantDriverCardData,
  type AssistantDriverFinancialSummaryCardData,
  type AssistantDriverTransactionsCardData,
  type AssistantStreamEvent,
} from "../src/lib/assistant/stream-protocol.ts";

const card: AssistantReservationCardData = {
  id: "reservation-1",
  dateLabel: "2026-08-12",
  timeLabel: "10:00",
  pickup: "BCN Airport T1",
  dropoff: "Sabadell",
  phone: "+34 600 000 000",
  passengerCount: 2,
  flight: "VY1000",
  statusLabel: "Pending",
  driver: { visibility: "hidden" },
  href: "/reservations/reservation-1/edit",
};

const driverCard: AssistantDriverCardData = {
  id: "driver-1",
  name: "A very long driver name that must wrap safely on narrow screens",
  status: "ACTIVE",
  vehicleType: "VAN",
  href: "/drivers/driver-1",
  balance: "-25.50",
  balancePosition: "CREDIT",
  currency: "EUR",
};

const financialSummary: AssistantDriverFinancialSummaryCardData = {
  driver: {
    id: "driver-1",
    name: "Alex",
    status: "ACTIVE",
    vehicleType: "VAN",
    href: "/drivers/driver-1",
  },
  currency: "EUR",
  totalCommissions: "100.00",
  totalPayments: "80.00",
  totalSubscriptionCharges: "20.00",
  balance: "0.00",
  balancePosition: "SETTLED",
  calculatedAt: "2026-08-11T10:00:00.000Z",
};

const driverTransactions: AssistantDriverTransactionsCardData = {
  driver: financialSummary.driver,
  transactionType: "ALL",
  period: { from: "2026-08-01", to: "2026-08-31" },
  pageCursor: null,
  currency: "EUR",
  totals: {
    commissions: "100.00",
    payments: "80.00",
    subscriptionCharges: "20.00",
    netChange: "0.00",
  },
  rows: [{
    id: "commission-1",
    type: "COMMISSION",
    date: "2026-08-10",
    amount: "100.00",
    source: "RESERVATION",
    route: { pickup: "A long pickup string that must wrap", dropoff: "A long destination string that must wrap" },
    reservation: { id: "reservation-1", href: "/reservations/reservation-1/edit" },
  }],
  hasMore: true,
  nextCursor: "txn_1",
};

test("chunked SSE decodes the small app-owned protocol in order", () => {
  const source = [
    { type: "assistant.status", status: "thinking", label: "Thinking…" },
    { type: "assistant.text.delta", delta: "Two jobs found." },
    { type: "assistant.reservation_result", reservation: card },
    { type: "assistant.complete", requestId: "request-1" },
  ] satisfies AssistantStreamEvent[];
  const encoded = source.map(encodeAssistantStreamEvent).join("");
  const decoder = new AssistantSseDecoder();
  const events = [
    ...decoder.push(encoded.slice(0, 37)),
    ...decoder.push(encoded.slice(37, 103)),
    ...decoder.push(encoded.slice(103)),
  ];
  decoder.finish();
  assert.deepEqual(events, source);
});

test("send waiting, status, coalesced text, card, and complete form one turn", () => {
  let message = createPendingAssistantMessage("assistant-1");
  message = applyAssistantStreamEvent(message, {
    type: "assistant.status",
    status: "searching",
    label: "Checking reservations…",
  });
  message = applyAssistantStreamEvent(message, {
    type: "assistant.text.delta",
    delta: "Two ",
  });
  message = applyAssistantStreamEvent(message, {
    type: "assistant.text.delta",
    delta: "jobs found.",
  });
  message = applyAssistantStreamEvent(message, {
    type: "assistant.reservation_result",
    reservation: card,
  });
  message = applyAssistantStreamEvent(message, {
    type: "assistant.reservation_result",
    reservation: card,
  });
  message = applyAssistantStreamEvent(message, {
    type: "assistant.complete",
    requestId: "request-1",
  });

  assert.deepEqual(message.parts.map((part) => part.type), ["text", "reservation"]);
  assert.equal(message.parts[0].type === "text" ? message.parts[0].text : null, "Two jobs found.");
  assert.equal(
    message.parts.filter((part) => part.type === "reservation").length,
    1,
  );
});

test("driver, zero-balance summary, and transaction events decode and deduplicate as structured cards", () => {
  const source = [
    { type: "assistant.driver_result", driver: driverCard },
    { type: "assistant.driver_financial_summary", summary: financialSummary },
    { type: "assistant.driver_transactions", transactions: driverTransactions },
  ] satisfies AssistantStreamEvent[];
  const decoder = new AssistantSseDecoder();
  const decoded = decoder.push(source.map(encodeAssistantStreamEvent).join(""));
  decoder.finish();
  assert.deepEqual(decoded, source);

  let message = createPendingAssistantMessage("assistant-driver");
  for (const event of [...source, ...source]) {
    message = applyAssistantStreamEvent(message, event);
  }
  message = applyAssistantStreamEvent(message, {
    type: "assistant.complete",
    requestId: "request-driver",
  });
  assert.deepEqual(message.parts.map((part) => part.type), [
    "driver",
    "driver-financial-summary",
    "driver-transactions",
  ]);
  assert.equal(JSON.stringify(message.parts).includes("-25.50"), true);
  assert.equal(JSON.stringify(message.parts).includes("0.00"), true);
});

test("Stop preserves already streamed finance cards and removes only live status", () => {
  let message = createPendingAssistantMessage("assistant-finance");
  message = applyAssistantStreamEvent(message, {
    type: "assistant.driver_transactions",
    transactions: driverTransactions,
  });
  const stopped = markAssistantMessageStopped(message);
  assert.deepEqual(stopped.parts.map((part) => part.type), ["driver-transactions", "interrupted"]);
});

test("Stop and network failure preserve partial text while clearing live status", () => {
  let message = createPendingAssistantMessage("assistant-1");
  message = applyAssistantStreamEvent(message, {
    type: "assistant.text.delta",
    delta: "Partial answer",
  });
  const stopped = markAssistantMessageStopped(message);
  assert.deepEqual(stopped.parts.map((part) => part.type), ["text", "interrupted"]);

  const failed = markAssistantMessageFailed(
    message,
    createAssistantNetworkError("Connection interrupted."),
  );
  assert.deepEqual(failed.parts.map((part) => part.type), ["text", "error"]);
  assert.equal(failed.parts.at(-1)?.type === "error" && failed.parts.at(-1).retryable, true);
});

test("Retry resets only the failed assistant bubble and disables stale retry controls", () => {
  const user: AssistantMessage = {
    id: "user-1",
    role: "user",
    parts: [{ type: "text", text: "Tomorrow?" }],
  };
  const failed: AssistantMessage = {
    id: "assistant-1",
    role: "assistant",
    parts: [
      { type: "text", text: "Partial" },
      { type: "reservation", reservation: card },
      createAssistantNetworkError("Connection interrupted."),
    ],
  };
  const reset = disablePreviousRetries([user, failed]).map((message) =>
    message.id === "assistant-1" ? createPendingAssistantMessage(message.id) : message,
  );
  assert.equal(reset.filter((message) => message.role === "user").length, 1);
  assert.deepEqual(reset[1].parts.map((part) => part.type), ["status"]);
});

test("ephemeral context contains only bounded transcript text, never cards or errors", () => {
  const messages: AssistantMessage[] = Array.from({ length: 8 }, (_, index) => ({
    id: `message-${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    parts:
      index === 7
        ? [
            { type: "text", text: "latest answer" },
            { type: "reservation", reservation: card },
            { type: "driver", driver: driverCard },
            { type: "driver-financial-summary", summary: financialSummary },
            { type: "driver-transactions", transactions: driverTransactions },
            createAssistantNetworkError("not context"),
          ]
        : [{ type: "text", text: `message ${index}` }],
  }));
  const context = buildAssistantConversationContext(messages);
  assert.equal(context.length, 6);
  assert.equal(context.at(-1)?.content, "latest answer");
  assert.equal(JSON.stringify(context).includes("reservation-1"), false);
  assert.equal(JSON.stringify(context).includes("driver-1"), false);
  assert.equal(JSON.stringify(context).includes("not context"), false);
});

test("malformed, mismatched, and interrupted stream frames are rejected", () => {
  assert.throws(() => {
    const decoder = new AssistantSseDecoder();
    decoder.push('event: assistant.complete\ndata: {"type":"assistant.text.delta","delta":"x"}\n\n');
  });
  assert.throws(() => {
    const decoder = new AssistantSseDecoder();
    decoder.push('event: assistant.text.delta\ndata: {"type":"assistant.text.delta"');
    decoder.finish();
  });
});

test("bursty tiny-delta stress preserves one coherent turn with mixed structured cards", () => {
  const deltas = Array.from({ length: 1_000 }, (_, index) => ({
    type: "assistant.text.delta" as const,
    delta: String(index % 10),
  }));
  const source: AssistantStreamEvent[] = [
    { type: "assistant.status", status: "thinking", label: "Thinking…" },
    ...deltas.slice(0, 250),
    { type: "assistant.reservation_result", reservation: card },
    ...deltas.slice(250, 500),
    { type: "assistant.driver_result", driver: driverCard },
    ...deltas.slice(500, 750),
    { type: "assistant.driver_financial_summary", summary: financialSummary },
    ...deltas.slice(750),
    { type: "assistant.driver_transactions", transactions: driverTransactions },
    { type: "assistant.complete", requestId: "request-stress" },
  ];
  const encoded = source.map(encodeAssistantStreamEvent).join("");
  const decoder = new AssistantSseDecoder();
  const events: AssistantStreamEvent[] = [];
  for (let offset = 0; offset < encoded.length; offset += 17) {
    events.push(...decoder.push(encoded.slice(offset, offset + 17)));
  }
  decoder.finish();
  assert.equal(events.length, source.length);

  let message = createPendingAssistantMessage("assistant-stress");
  for (const event of events) message = applyAssistantStreamEvent(message, event);
  const textPart = message.parts.find((part) => part.type === "text");
  assert.equal(textPart?.type === "text" ? textPart.text.length : 0, 1_000);
  assert.deepEqual(message.parts.map((part) => part.type), [
    "text",
    "reservation",
    "driver",
    "driver-financial-summary",
    "driver-transactions",
  ]);
});
