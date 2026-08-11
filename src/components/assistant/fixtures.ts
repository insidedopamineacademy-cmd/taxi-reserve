import type {
  AssistantMessage,
  AssistantPreviewScenario,
  AssistantRequestState,
} from "./types";

type FixtureScenario = {
  label: string;
  messages: AssistantMessage[];
  requestState?: AssistantRequestState;
  announcement?: string;
};

const longParagraph =
  "This is a development-only long response used to verify wrapping, scrolling, readable line lengths, and the jump-to-latest control. It is static fixture copy and does not describe live Taxi Reserve records. Long answers should remain calm and scannable while the composer stays anchored at the bottom of the assistant.";

const fixtureReservation: AssistantMessage = {
  id: "fixture-reservation",
  role: "assistant",
  parts: [
    { type: "text", text: "Here is a reservation-card layout preview using fixture data only." },
    {
      type: "reservation",
      reservation: {
        id: "fixture-reservation-001",
        dateLabel: "Wednesday, 12 August",
        timeLabel: "06:45",
        pickup:
          "Barcelona-El Prat Airport, Terminal 1 — Arrivals meeting point beside the exceptionally long transport desk name",
        dropoff:
          "Passeig de Gràcia, 92, 4th floor, apartment with a deliberately long delivery note, Barcelona",
        passengerCount: 3,
        passengerName: "Fixture Passenger",
        statusLabel: "Confirmed",
        bookingReference: "FIX-001",
        flight: "VY 8100",
        driver: { visibility: "assigned", name: "Fixture Driver" },
        fixture: true,
      },
    },
    {
      type: "reservation",
      reservation: {
        id: "fixture-reservation-002",
        dateLabel: "Wednesday, 12 August",
        timeLabel: "09:10",
        pickup: "Plaça de Catalunya, Barcelona",
        dropoff: "Girona Old Town",
        passengerCount: 1,
        flight: null,
        driver: { visibility: "unassigned" },
        fixture: true,
      },
    },
    {
      type: "reservation",
      reservation: {
        id: "fixture-reservation-003",
        dateLabel: "Wednesday, 12 August",
        timeLabel: "12:30",
        pickup: "Hotel fixture pickup",
        dropoff: "Port fixture drop-off",
        passengerCount: 2,
        driver: { visibility: "hidden" },
        fixture: true,
      },
    },
  ],
};

const fixtureDriverFinance: AssistantMessage = {
  id: "fixture-driver-finance",
  role: "assistant",
  parts: [
    { type: "text", text: "Development-only driver and finance card fixtures." },
    {
      type: "driver",
      driver: {
        id: "fixture-driver-001",
        name: "Fixture Driver With An Exceptionally Long Display Name",
        status: "INACTIVE",
        vehicleType: null,
        href: "/drivers/fixture-driver-001",
        licenseNumber: "FIXTURE-LICENSE-NUMBER-001-LONG",
        balance: "-1234.56",
        balancePosition: "CREDIT",
        currency: "EUR",
        fixture: true,
      },
    },
    {
      type: "driver-financial-summary",
      summary: {
        driver: {
          id: "fixture-driver-001",
          name: "Fixture Driver With An Exceptionally Long Display Name",
          status: "INACTIVE",
          vehicleType: null,
          href: "/drivers/fixture-driver-001",
        },
        currency: "EUR",
        totalCommissions: "1000000.10",
        totalPayments: "999000.05",
        totalSubscriptionCharges: "1000.05",
        balance: "0.00",
        balancePosition: "SETTLED",
        calculatedAt: "2026-08-11T10:00:00.000Z",
        fixture: true,
      },
    },
    {
      type: "driver-transactions",
      transactions: {
        driver: {
          id: "fixture-driver-001",
          name: "Fixture Driver With An Exceptionally Long Display Name",
          status: "INACTIVE",
          vehicleType: null,
          href: "/drivers/fixture-driver-001",
        },
        transactionType: "ALL",
        period: { from: "2026-08-01", to: "2026-08-31" },
        pageCursor: null,
        currency: "EUR",
        totals: {
          commissions: "1000000.10",
          payments: "999000.05",
          subscriptionCharges: "1000.05",
          netChange: "0.00",
        },
        rows: [
          {
            id: "fixture-commission-1",
            type: "COMMISSION",
            date: "2026-08-10",
            amount: "123456.78",
            source: "RESERVATION",
            route: {
              pickup: "Barcelona-El Prat Airport Terminal 1 arrivals meeting point with a very long location name",
              dropoff: "An intentionally long destination address in central Barcelona that must wrap safely",
            },
            reservation: {
              id: "fixture-reservation-001",
              href: "/reservations/fixture-reservation-001/edit",
            },
          },
          {
            id: "fixture-payment-1",
            type: "PAYMENT",
            date: "2026-08-08",
            amount: "999000.05",
            method: "BANK",
          },
          {
            id: "fixture-subscription-1",
            type: "SUBSCRIPTION",
            date: "2026-08-01",
            amount: "1000.05",
          },
        ],
        hasMore: true,
        nextCursor: "txn_fixture",
        fixture: true,
      },
    },
  ],
};

const longConversation: AssistantMessage[] = Array.from({ length: 14 }, (_, index) => ({
  id: `fixture-long-${index}`,
  role: index % 2 === 0 ? "user" : "assistant",
  parts: [
    {
      type: "text",
      text:
        index % 2 === 0
          ? `Fixture question ${index / 2 + 1}: show how a longer conversation behaves.`
          : `Fixture response ${Math.ceil(index / 2)}. No live operational data was searched or displayed.`,
    },
  ],
}));

export const assistantFixtureScenarios: Record<AssistantPreviewScenario, FixtureScenario> = {
  empty: {
    label: "Empty state",
    messages: [],
    announcement: "Empty assistant preview",
  },
  conversation: {
    label: "Short conversation",
    messages: [
      {
        id: "fixture-user-1",
        role: "user",
        parts: [{ type: "text", text: "What can this assistant help with?" }],
      },
      {
        id: "fixture-assistant-1",
        role: "assistant",
        parts: [
          {
            type: "text",
            text: "This Phase 1B shell previews conversation layout only. Live Taxi Reserve search and operational tools are not connected.",
          },
        ],
      },
    ],
    announcement: "Fixture response complete",
  },
  thinking: {
    label: "Thinking",
    messages: [
      {
        id: "fixture-thinking",
        role: "assistant",
        parts: [{ type: "status", status: "thinking", label: "Thinking" }],
      },
    ],
    requestState: "generating",
    announcement: "Assistant is thinking",
  },
  searching: {
    label: "Searching",
    messages: [
      {
        id: "fixture-searching",
        role: "assistant",
        parts: [{ type: "status", status: "searching", label: "Searching reservations" }],
      },
    ],
    requestState: "generating",
    announcement: "Assistant is searching",
  },
  reservation: {
    label: "Reservation cards",
    messages: [fixtureReservation],
    announcement: "Fixture reservation cards displayed",
  },
  "driver-finance": {
    label: "Driver + finance cards",
    messages: [fixtureDriverFinance],
    announcement: "Fixture driver and finance cards displayed",
  },
  "long-response": {
    label: "Long response",
    messages: [
      {
        id: "fixture-long-response",
        role: "assistant",
        parts: [
          { type: "text", text: `${longParagraph}\n\n${longParagraph}\n\n${longParagraph}\n\n${longParagraph}` },
        ],
      },
    ],
    announcement: "Long fixture response complete",
  },
  "long-conversation": {
    label: "Long conversation",
    messages: longConversation,
    announcement: "Long fixture conversation displayed",
  },
  error: {
    label: "Error and retry",
    messages: [
      {
        id: "fixture-error",
        role: "assistant",
        parts: [
          {
            type: "error",
            kind: "network",
            title: "Couldn’t complete that request",
            message: "This is a development fixture for the future recoverable-error state.",
            retryable: true,
          },
        ],
      },
    ],
    requestState: "failed",
    announcement: "Assistant request failed",
  },
  stopped: {
    label: "Stopped response",
    messages: [
      {
        id: "fixture-stopped",
        role: "assistant",
        parts: [{ type: "interrupted", message: "Response stopped" }],
      },
    ],
    announcement: "Assistant response stopped",
  },
};

export const assistantPreviewScenarioOptions = (
  Object.entries(assistantFixtureScenarios) as [AssistantPreviewScenario, FixtureScenario][]
).map(([value, scenario]) => ({ value, label: scenario.label }));
