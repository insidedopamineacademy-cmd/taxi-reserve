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

const fixtureReservationCreation: AssistantMessage[] = [
  {
    id: "fixture-reservation-draft",
    role: "assistant",
    parts: [
      {
        type: "text",
        text: "I found the booking details. I need two details: confirm the date, and is the passenger count 8 or 15?",
      },
      {
        type: "reservation-draft",
        draft: {
          id: "fixture-draft-001",
          revision: 2,
          fields: {
            pickup: {
              state: "EXPLICIT",
              value: "Barcelona-El Prat Airport, Terminal 1 — arrivals meeting point beside the exceptionally long transport desk name",
              alternatives: [],
              confirmed: true,
            },
            dropoff: {
              state: "EXPLICIT",
              value: "Carrer de Llull 170, 6th floor, apartment with a deliberately long access note, Barcelona",
              alternatives: [],
              confirmed: true,
            },
            phone: {
              state: "MISSING",
              value: null,
              alternatives: [],
              confirmed: false,
            },
            serviceDate: {
              state: "INFERRED",
              value: "2026-11-21",
              alternatives: [],
              confirmed: false,
              message: "I interpreted the service date as 21 November 2026. Please confirm it.",
            },
            pickupTime: {
              state: "EXPLICIT",
              value: "09:50",
              alternatives: [],
              confirmed: true,
            },
            passengers: {
              state: "CONFLICT",
              value: null,
              alternatives: [8, 15],
              confirmed: false,
              message: "The form says 8 passengers, but the notes mention 15. Which is correct?",
            },
            priceEuro: {
              state: "MISSING",
              value: null,
              alternatives: [],
              confirmed: false,
            },
            flight: {
              state: "EXPLICIT",
              value: "BA123",
              alternatives: [],
              confirmed: true,
            },
            notes: {
              state: "EXPLICIT",
              value: "Require 2 vans and meet at arrivals. Luggage: 8 large suitcases plus two folding wheelchairs.",
              alternatives: [],
              confirmed: true,
            },
          },
          blockingFields: ["serviceDate", "passengers"],
          completeConfirmed: false,
          duplicateAcknowledged: false,
          readyToPrepare: false,
          question: "I need two details:\n• Confirm 21 November 2026?\n• Is the passenger count 8 or 15?",
          fixture: true,
        },
      },
    ],
  },
  {
    id: "fixture-reservation-draft-answer",
    role: "user",
    parts: [{ type: "text", text: "21 November is correct. 15 passengers. Price €120. Everything is complete." }],
  },
  {
    id: "fixture-reservation-create-preview",
    role: "assistant",
    parts: [
      {
        type: "text",
        text: "Review the final details. No reservation is created until you confirm below.",
      },
      {
        type: "action-preview",
        action: {
          actionId: "fixture-create-reservation-001",
          actionType: "CREATE_RESERVATION",
          riskLevel: "WRITE",
          status: "PENDING",
          expiresAt: "2099-11-21T09:05:00.000Z",
          confirmationLabel: "Confirm & Create",
          preview: {
            title: "Create reservation",
            summary: "No reservation will be created until you tap Confirm & Create.",
            sections: [
              {
                heading: "Date and route",
                facts: [
                  { label: "Date and time", value: "21 Nov 2026 · 09:50" },
                  { label: "Pickup", value: "Barcelona-El Prat Airport, Terminal 1 — arrivals meeting point beside the exceptionally long transport desk name" },
                  { label: "Drop-off", value: "Carrer de Llull 170, 6th floor, apartment with a deliberately long access note, Barcelona" },
                ],
              },
              {
                heading: "Booking details",
                facts: [
                  { label: "Phone", value: "Not provided" },
                  { label: "Passengers", value: "15" },
                  { label: "Price", value: "€120.00", emphasis: "money" },
                  { label: "Flight", value: "BA123" },
                ],
              },
              {
                heading: "Notes",
                facts: [{ label: "Booking notes", value: "Require 2 vans and meet at arrivals. Luggage: 8 large suitcases plus two folding wheelchairs." }],
              },
            ],
            warnings: ["No client phone was provided."],
          },
          fixture: true,
        },
      },
    ],
  },
];

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

const fixtureDriverImport: AssistantMessage[] = [
  {
    id: "fixture-driver-import-draft",
    role: "assistant",
    parts: [
      {
        type: "text",
        text: "I cleaned 31 unique entries. I need clarification on 2.",
      },
      {
        type: "driver-import-draft",
        draft: {
          id: "fixture-driver-import-001",
          revision: 2,
          counts: {
            NEW: 20,
            EXISTING_MATCH: 4,
            EXISTING_UPDATE: 4,
            DUPLICATE_IN_IMPORT: 12,
            NEEDS_REVIEW: 1,
            CONFLICT: 0,
          },
          duplicateRowsSkipped: 12,
          blockingCount: 1,
          completeConfirmed: false,
          readyToPrepare: false,
          question: "I need clarification on 1:\n• Code 5063: should Ford be VAN or SEDAN?",
          rows: [
            {
              id: "fixture-import-row-1",
              name: "Sameer Khan",
              licenseNumber: "10445",
              vehicleRaw: "Volkswagen Caddy",
              vehicleType: "VAN",
              sourceNotes: [],
              possibleNames: [],
              duplicateOccurrences: 1,
              state: "NEW",
              issues: [],
              existing: null,
            },
            {
              id: "fixture-import-row-2",
              name: "Ehsam",
              licenseNumber: "5181",
              vehicleRaw: "Mercedes V-Class",
              vehicleType: "VAN",
              sourceNotes: [],
              possibleNames: [],
              duplicateOccurrences: 0,
              state: "NEW",
              issues: [],
              existing: null,
            },
            {
              id: "fixture-import-row-6",
              name: "Basheer Ahmed",
              licenseNumber: "5181",
              vehicleRaw: "Mercedes V-Class",
              vehicleType: "VAN",
              sourceNotes: [],
              possibleNames: [],
              duplicateOccurrences: 0,
              state: "NEW",
              issues: [],
              existing: null,
            },
            {
              id: "fixture-import-row-3",
              name: "Raja Hadeed",
              licenseNumber: "5063",
              vehicleRaw: "Ford 048",
              vehicleType: null,
              sourceNotes: ["048"],
              possibleNames: [],
              duplicateOccurrences: 0,
              state: "NEEDS_REVIEW",
              issues: ["Should Ford be VAN or SEDAN?"],
              existing: null,
            },
            {
              id: "fixture-import-row-4",
              name: "Ali Tehreem",
              licenseNumber: "5901",
              vehicleRaw: "Mercedes Vito",
              vehicleType: "VAN",
              sourceNotes: ["047", "sin rampa"],
              possibleNames: [],
              duplicateOccurrences: 0,
              state: "EXISTING_UPDATE",
              issues: [],
              existing: {
                id: "fixture-driver-existing-1",
                name: "Ali Tehreem",
                licenseNumber: "5901",
                vehicleType: "SEDAN",
                status: "ACTIVE",
              },
            },
            {
              id: "fixture-import-row-5",
              name: "Qaisar Cheema",
              licenseNumber: "8268",
              vehicleRaw: "Mercedes Vito",
              vehicleType: "VAN",
              sourceNotes: ["047", "noche Sukh Sidhu conductor"],
              possibleNames: [],
              duplicateOccurrences: 0,
              state: "EXISTING_MATCH",
              issues: [],
              existing: {
                id: "fixture-driver-existing-2",
                name: "Qaisar Cheema",
                licenseNumber: "8268",
                vehicleType: "VAN",
                status: "INACTIVE",
              },
            },
          ],
          fixture: true,
        },
      },
    ],
  },
  {
    id: "fixture-driver-import-preview",
    role: "assistant",
    parts: [
      {
        type: "action-preview",
        action: {
          actionId: "fixture-import-drivers-action",
          actionType: "IMPORT_DRIVERS",
          riskLevel: "WRITE",
          status: "PENDING",
          expiresAt: "2099-08-12T12:10:00.000Z",
          confirmationLabel: "Confirm Import",
          preview: {
            title: "Import drivers",
            summary: "No driver is created or updated until you tap Confirm Import.",
            sections: [
              {
                heading: "Import summary",
                facts: [
                  { label: "New drivers", value: "18" },
                  { label: "Existing drivers to update", value: "4" },
                  { label: "Existing unchanged", value: "4" },
                  { label: "Duplicates skipped", value: "12" },
                ],
              },
              {
                heading: "Reviewed vehicle updates",
                facts: [
                  { label: "Ali Tehreem · 5901", previousValue: "SEDAN", value: "VAN" },
                ],
              },
            ],
            warnings: ["Names, codes, status, subscriptions, finance, and reservation assignments will not change."],
          },
          fixture: true,
        },
      },
    ],
  },
];

const fixtureActionPreview: AssistantMessage = {
  id: "fixture-action-preview",
  role: "assistant",
  parts: [
    {
      type: "text",
      text: "Review every detail below. Confirmation is bound to this exact server-owned action.",
    },
    {
      type: "action-preview",
      action: {
        actionId: "fixture-action-001",
        actionType: "RECORD_DRIVER_PAYMENT",
        riskLevel: "FINANCIAL_WRITE",
        status: "PENDING",
        expiresAt: "2099-08-11T12:10:00.000Z",
        confirmationLabel: "Confirm payment",
        preview: {
          title: "Record driver payment",
          summary: "This financial action will only run after explicit confirmation.",
          sections: [
            {
              heading: "Driver",
              facts: [
                { label: "Name", value: "Fixture Driver" },
                { label: "Payment date", value: "11 Aug 2026" },
              ],
            },
            {
              heading: "Payment",
              facts: [
                { label: "Amount", value: "€125.00", emphasis: "money" },
                { label: "Method", value: "Bank transfer" },
                { label: "Reservation", value: "No reservation linked" },
              ],
            },
          ],
          warnings: ["Confirm only after checking the exact driver, amount, and date."],
        },
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
  "reservation-creation": {
    label: "Reservation creation",
    messages: fixtureReservationCreation,
    announcement: "Fixture reservation draft and creation preview displayed",
  },
  "driver-finance": {
    label: "Driver + finance cards",
    messages: [fixtureDriverFinance],
    announcement: "Fixture driver and finance cards displayed",
  },
  "driver-import": {
    label: "Driver import",
    messages: fixtureDriverImport,
    announcement: "Fixture driver import draft and confirmation displayed",
  },
  "action-preview": {
    label: "Action confirmation",
    messages: [fixtureActionPreview],
    announcement: "Fixture action preview displayed",
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
