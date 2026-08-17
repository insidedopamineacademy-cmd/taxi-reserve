import assert from "node:assert/strict";
import test from "node:test";
import {
  addCalendarDays,
  formatMadridDate,
  formatMadridDateDisplay,
  getMadridDateContext,
  getMadridDayRange,
  madridDateTimeToInstant,
} from "../src/lib/time/madrid.ts";
import {
  ASSISTANT_RESERVATION_DEFAULT_LIMIT,
  ASSISTANT_RESERVATION_MAX_LIMIT,
  ReservationReadForbiddenError,
  ReservationReadInputError,
  buildReservationRepositoryQuery,
  getReservationForAssistant,
  searchReservationsForAssistant,
  type ReservationAccessContext,
  type ReservationReadRepository,
  type ReservationReadRow,
  type ReservationRepositoryQuery,
} from "../src/lib/reservations/assistant-read-core.ts";
import { buildAssistantReservationWhere } from "../src/lib/reservations/assistant-read-prisma.ts";
import {
  getReservationTool,
  searchReservationsTool,
} from "../src/lib/assistant/tools/reservation-contracts.ts";
import { AssistantTransportError } from "../src/lib/assistant/errors.ts";
import { AssistantSseDecoder } from "../src/lib/assistant/stream-protocol.ts";
import {
  ASSISTANT_MAX_MESSAGE_LENGTH,
  handleAssistantChatRequest,
  type AssistantTransportDependencies,
} from "../src/lib/assistant/transport.ts";
import {
  AssistantConfigurationError,
  getAssistantOpenAIConfig,
  getAssistantRequestTimeoutMs,
} from "../src/lib/assistant/config.ts";

const userContext: ReservationAccessContext = {
  userId: "user-1",
  email: "owner@example.com",
  role: "USER",
};

const adminContext: ReservationAccessContext = {
  userId: "admin-1",
  email: "admin@example.com",
  role: "ADMIN",
};

const reservationRow: ReservationReadRow = {
  id: "reservation-1",
  startAt: new Date("2026-08-12T06:30:00.000Z"),
  pickupText: "Sabadell Centre",
  dropoffText: "Barcelona Airport T1",
  pax: 3,
  phone: "+34 600 123 456",
  flight: "VY1234",
  status: "ASSIGNED",
  driverId: "driver-1",
  driver: { id: "driver-1", name: "Alex Driver" },
};

function repositoryWith(options?: {
  rows?: ReservationReadRow[];
  one?: ReservationReadRow | null;
  onSearch?: (query: ReservationRepositoryQuery) => void;
  onGet?: (query: { ownerEmail: string; reservationId: string }) => void;
}): ReservationReadRepository {
  return {
    async search(query) {
      options?.onSearch?.(query);
      return options?.rows ?? [];
    },
    async getById(query) {
      options?.onGet?.(query);
      return options?.one ?? null;
    },
  };
}

test("Madrid context resolves today and tomorrow across the UTC summer boundary", () => {
  const context = getMadridDateContext(new Date("2026-08-10T22:30:00.000Z"));
  assert.deepEqual(context, {
    timeZone: "Europe/Madrid",
    today: "2026-08-11",
    tomorrow: "2026-08-12",
  });
  assert.equal(addCalendarDays("2026-12-31", 1), "2027-01-01");
});

test("Madrid date formatting handles winter midnight independently of host timezone", () => {
  assert.equal(formatMadridDate(new Date("2026-01-01T22:59:00.000Z")), "2026-01-01");
  assert.equal(formatMadridDate(new Date("2026-01-01T23:00:00.000Z")), "2026-01-02");
  assert.equal(formatMadridDateDisplay(new Date("2026-01-01T23:00:00.000Z")), "02 Jan 2026");
});

test("Madrid day boundaries reflect spring and autumn daylight-saving changes", () => {
  const spring = getMadridDayRange("2026-03-29");
  const autumn = getMadridDayRange("2026-10-25");
  assert.equal(spring.end.getTime() - spring.start.getTime(), 23 * 60 * 60 * 1000);
  assert.equal(autumn.end.getTime() - autumn.start.getTime(), 25 * 60 * 60 * 1000);
});

test("exact date and time filters become absolute Madrid instants", () => {
  const query = buildReservationRepositoryQuery(adminContext, {
    serviceDate: "2026-08-12",
    timeFrom: "08:00",
    timeTo: "10:00",
  });
  assert.equal(query.startAtGte?.toISOString(), "2026-08-12T06:00:00.000Z");
  assert.equal(query.startAtLt?.toISOString(), "2026-08-12T08:00:00.000Z");
  assert.equal(
    madridDateTimeToInstant("2026-08-12", "00:00").toISOString(),
    "2026-08-11T22:00:00.000Z",
  );
});

test("inclusive date ranges use an exclusive next-day boundary", () => {
  const query = buildReservationRepositoryQuery(userContext, {
    dateFrom: "2026-08-12",
    dateTo: "2026-08-14",
  });
  assert.equal(query.startAtGte?.toISOString(), "2026-08-11T22:00:00.000Z");
  assert.equal(query.startAtLt?.toISOString(), "2026-08-14T22:00:00.000Z");
});

test("deterministic search filters are normalized and bounded", () => {
  const query = buildReservationRepositoryQuery(adminContext, {
    pickupQuery: "  Sabadell  ",
    dropoffQuery: " Airport ",
    phone: " 600123 ",
    driverId: " driver-1 ",
    assigned: true,
    status: "ASSIGNED",
    limit: ASSISTANT_RESERVATION_MAX_LIMIT,
  });
  assert.deepEqual(
    {
      pickupContains: query.pickupContains,
      dropoffContains: query.dropoffContains,
      phoneContains: query.phoneContains,
      driverId: query.driverId,
      assigned: query.assigned,
      status: query.status,
      limit: query.limit,
    },
    {
      pickupContains: "Sabadell",
      dropoffContains: "Airport",
      phoneContains: "600123",
      driverId: "driver-1",
      assigned: true,
      status: "ASSIGNED",
      limit: 20,
    },
  );
  assert.equal(
    buildReservationRepositoryQuery(userContext, {}).limit,
    ASSISTANT_RESERVATION_DEFAULT_LIMIT,
  );
});

test("assigned true and false remain authoritative driver relationship filters", () => {
  const assigned = buildAssistantReservationWhere(
    buildReservationRepositoryQuery(adminContext, { assigned: true }),
  );
  const unassigned = buildAssistantReservationWhere(
    buildReservationRepositoryQuery(adminContext, { assigned: false }),
  );
  assert.deepEqual(assigned.driverId, { not: null });
  assert.equal(unassigned.driverId, null);
});

test("Prisma adapter always applies ownership, active rows, and deterministic text filters", () => {
  const where = buildAssistantReservationWhere(
    buildReservationRepositoryQuery(adminContext, {
      pickupQuery: "Sabadell",
      dropoffQuery: "Airport",
      phone: "600123",
      status: "COMPLETED",
    }),
  );
  assert.equal(where.userEmail, "admin@example.com");
  assert.equal(where.isDeleted, false);
  assert.deepEqual(where.pickupText, { contains: "Sabadell", mode: "insensitive" });
  assert.deepEqual(where.dropoffText, { contains: "Airport", mode: "insensitive" });
  assert.deepEqual(where.phone, { contains: "600123", mode: "insensitive" });
  assert.equal(where.status, "COMPLETED");
});

test("invalid ranges, values, and unbounded limits fail before the repository", () => {
  assert.throws(
    () => buildReservationRepositoryQuery(userContext, { timeFrom: "08:00" }),
    ReservationReadInputError,
  );
  assert.throws(
    () =>
      buildReservationRepositoryQuery(adminContext, {
        serviceDate: "2026-08-12",
        timeFrom: "12:00",
        timeTo: "10:00",
      }),
    ReservationReadInputError,
  );
  assert.throws(
    () => buildReservationRepositoryQuery(userContext, { limit: 21 }),
    ReservationReadInputError,
  );
  assert.throws(
    () => buildReservationRepositoryQuery(userContext, { serviceDate: "2026-02-30" }),
    ReservationReadInputError,
  );
});

test("USER cannot request driver assignment filters", () => {
  assert.throws(
    () => buildReservationRepositoryQuery(userContext, { assigned: false }),
    ReservationReadForbiddenError,
  );
  assert.throws(
    () => buildReservationRepositoryQuery(userContext, { driverId: "driver-1" }),
    ReservationReadForbiddenError,
  );
});

test("USER search always carries production ownership and omits driver identity", async () => {
  let captured: ReservationRepositoryQuery | undefined;
  const results = await searchReservationsForAssistant(
    userContext,
    { pickupQuery: "Sabadell" },
    repositoryWith({ rows: [reservationRow], onSearch: (query) => (captured = query) }),
  );

  assert.equal(captured?.ownerEmail, "owner@example.com");
  assert.deepEqual(results, [
    {
      id: "reservation-1",
      serviceDate: "2026-08-12",
      pickupTime: "08:30",
      pickup: "Sabadell Centre",
      dropoff: "Barcelona Airport T1",
      phone: "+34 600 123 456",
      passengerCount: 3,
      flightNumber: "VY1234",
      status: "ASSIGNED",
    },
  ]);
  assert.equal("driver" in results[0], false);
  assert.equal("notes" in results[0], false);
  assert.equal("userEmail" in results[0], false);
});

test("ADMIN remains owner-scoped and receives only minimal driver identity", async () => {
  let capturedOwner = "";
  const results = await searchReservationsForAssistant(
    adminContext,
    { assigned: true },
    repositoryWith({
      rows: [reservationRow],
      onSearch: (query) => (capturedOwner = query.ownerEmail),
    }),
  );
  assert.equal(capturedOwner, "admin@example.com");
  assert.deepEqual(results[0].driver, { id: "driver-1", name: "Alex Driver" });
});

test("search supports no results and multiple capped results", async () => {
  assert.deepEqual(
    await searchReservationsForAssistant(userContext, {}, repositoryWith()),
    [],
  );
  const results = await searchReservationsForAssistant(
    userContext,
    { limit: 2 },
    repositoryWith({
      rows: [reservationRow, { ...reservationRow, id: "reservation-2" }],
    }),
  );
  assert.deepEqual(results.map((item) => item.id), ["reservation-1", "reservation-2"]);
});

test("get reservation uses permission-safe owner-scoped lookup", async () => {
  let lookup: { ownerEmail: string; reservationId: string } | undefined;
  const inaccessible = await getReservationForAssistant(
    userContext,
    "protected-id",
    repositoryWith({ onGet: (query) => (lookup = query) }),
  );
  assert.equal(inaccessible, null);
  assert.deepEqual(lookup, {
    ownerEmail: "owner@example.com",
    reservationId: "protected-id",
  });
});

test("reservation tool schemas are strict, closed, bounded, and contain no auth override", () => {
  assert.equal(searchReservationsTool.strict, true);
  assert.equal(searchReservationsTool.parameters.additionalProperties, false);
  assert.equal(getReservationTool.strict, true);
  assert.equal(getReservationTool.parameters.additionalProperties, false);
  assert.equal(searchReservationsTool.parameters.properties.limit.maximum, 20);
  assert.deepEqual(
    new Set(searchReservationsTool.parameters.required),
    new Set(Object.keys(searchReservationsTool.parameters.properties)),
  );

  const propertyNames = [
    ...Object.keys(searchReservationsTool.parameters.properties),
    ...Object.keys(getReservationTool.parameters.properties),
  ];
  for (const forbidden of ["userId", "user_id", "role"]) {
    assert.equal(propertyNames.includes(forbidden), false);
  }

  const serialized = JSON.stringify([searchReservationsTool, getReservationTool]);
  for (const forbidden of ["Prisma", "SQL", "passenger_name"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

function transportDependencies(
  patch: Partial<AssistantTransportDependencies> = {},
): AssistantTransportDependencies {
  return {
    isEnabled: () => true,
    getAuthContext: async () => userContext,
    run: async ({ emit }) => {
      emit({ type: "assistant.text.delta", delta: "Foundation ready." });
      return { upstreamResponseId: "response-1" };
    },
    getTimeoutMs: () => 100,
    createRequestId: () => "request-1",
    ...patch,
  };
}

function assistantRequest(body: unknown, signal?: AbortSignal) {
  return new Request("http://localhost/api/assistant/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

async function responseBody(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

async function streamEvents(response: Response) {
  const decoder = new AssistantSseDecoder();
  const events = decoder.push(await response.text());
  decoder.finish();
  return events;
}

test("transport rejects unauthenticated requests before feature disclosure", async () => {
  const response = await handleAssistantChatRequest(
    assistantRequest({ message: "hello" }),
    transportDependencies({ getAuthContext: async () => null, isEnabled: () => false }),
  );
  assert.equal(response.status, 401);
  assert.equal((await responseBody(response)).error instanceof Object, true);
});

test("transport rejects disabled, malformed, and oversized requests", async () => {
  const disabled = await handleAssistantChatRequest(
    assistantRequest({ message: "hello" }),
    transportDependencies({ isEnabled: () => false }),
  );
  assert.equal(disabled.status, 404);

  const malformed = await handleAssistantChatRequest(
    new Request("http://localhost/api/assistant/chat", { method: "POST", body: "{" }),
    transportDependencies(),
  );
  assert.equal(malformed.status, 400);

  const oversized = await handleAssistantChatRequest(
    assistantRequest({ message: "x".repeat(ASSISTANT_MAX_MESSAGE_LENGTH + 1) }),
    transportDependencies(),
  );
  assert.equal(oversized.status, 400);
});

test("transport rejects client role and userId instead of trusting them", async () => {
  let generated = false;
  const response = await handleAssistantChatRequest(
    assistantRequest({ message: "hello", role: "ADMIN", userId: "someone-else" }),
    transportDependencies({
      run: async () => {
        generated = true;
        return {};
      },
    }),
  );
  assert.equal(response.status, 400);
  assert.equal(generated, false);
});

test("transport returns a small typed no-store event stream", async () => {
  const response = await handleAssistantChatRequest(
    assistantRequest({ message: " hello " }),
    transportDependencies(),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await streamEvents(response), [
    { type: "assistant.text.delta", delta: "Foundation ready." },
    { type: "assistant.complete", requestId: "request-1" },
  ]);
  assert.equal(response.headers.get("cache-control"), "no-store, no-transform");
  assert.match(response.headers.get("content-type") ?? "", /^text\/event-stream/);
});

test("transport aborts timed-out generation and maps a stable timeout", async () => {
  const response = await handleAssistantChatRequest(
    assistantRequest({ message: "hello" }),
    transportDependencies({
      getTimeoutMs: () => 10,
      run: ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("stopped", "AbortError")),
            { once: true },
          );
        }),
    }),
  );
  assert.equal(response.status, 200);
  const events = await streamEvents(response);
  assert.equal(events.at(-1)?.type, "assistant.error");
  assert.equal(
    events.at(-1)?.type === "assistant.error" ? events.at(-1).error.code : null,
    "REQUEST_TIMEOUT",
  );
});

test("transport propagates caller cancellation and cleans up generation", async () => {
  const controller = new AbortController();
  let generationStarted!: () => void;
  const started = new Promise<void>((resolve) => (generationStarted = resolve));
  const responsePromise = handleAssistantChatRequest(
    assistantRequest({ message: "hello" }, controller.signal),
    transportDependencies({
      run: ({ signal }) =>
        new Promise((_resolve, reject) => {
          generationStarted();
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("stopped", "AbortError")),
            { once: true },
          );
        }),
    }),
  );
  await started;
  controller.abort();
  const response = await responsePromise;
  assert.equal(response.status, 200);
  assert.deepEqual(await streamEvents(response), []);
});

test("transport maps upstream and unknown failures without leaking details", async () => {
  const upstream = await handleAssistantChatRequest(
    assistantRequest({ message: "hello" }),
    transportDependencies({
      run: async () => {
        throw new AssistantTransportError("UPSTREAM_UNAVAILABLE", {
          cause: new Error("secret upstream detail"),
        });
      },
    }),
  );
  assert.equal(upstream.status, 200);
  const upstreamEvents = await streamEvents(upstream);
  assert.equal(upstreamEvents.at(-1)?.type, "assistant.error");
  assert.equal(JSON.stringify(upstreamEvents).includes("secret"), false);

  const internal = await handleAssistantChatRequest(
    assistantRequest({ message: "hello" }),
    transportDependencies({
      run: async () => {
        throw new Error("DATABASE_URL=secret");
      },
    }),
  );
  assert.equal(internal.status, 200);
  const internalEvents = await streamEvents(internal);
  assert.equal(internalEvents.at(-1)?.type, "assistant.error");
  assert.equal(JSON.stringify(internalEvents).includes("DATABASE_URL"), false);
});

test("interrupted upstream streaming preserves partial text before a recoverable error", async () => {
  const response = await handleAssistantChatRequest(
    assistantRequest({ message: "hello" }),
    transportDependencies({
      run: async ({ emit }) => {
        emit({ type: "assistant.text.delta", delta: "Partial answer" });
        throw new AssistantTransportError("UPSTREAM_UNAVAILABLE");
      },
    }),
  );
  const events = await streamEvents(response);
  assert.deepEqual(events.map((event) => event.type), [
    "assistant.text.delta",
    "assistant.error",
  ]);
  assert.equal(
    events[1].type === "assistant.error" ? events[1].error.retryable : false,
    true,
  );
});

test("transport accepts only bounded plain-text recent context", async () => {
  let receivedContext: unknown;
  const response = await handleAssistantChatRequest(
    assistantRequest({
      message: "follow up",
      context: [
        { role: "user", content: "first" },
        { role: "assistant", content: "second" },
      ],
    }),
    transportDependencies({
      run: async ({ context, emit }) => {
        receivedContext = context;
        emit({ type: "assistant.text.delta", delta: "ok" });
        return {};
      },
    }),
  );
  await streamEvents(response);
  assert.deepEqual(receivedContext, [
    { role: "user", content: "first" },
    { role: "assistant", content: "second" },
  ]);

  const unsafe = await handleAssistantChatRequest(
    assistantRequest({
      message: "hello",
      context: [{ role: "assistant", content: "ok", toolPayload: { secret: true } }],
    }),
    transportDependencies(),
  );
  assert.equal(unsafe.status, 400);
});

test("server-only assistant environment config is validated and bounded", () => {
  const original = {
    key: process.env.OPENAI_API_KEY,
    model: process.env.AI_ASSISTANT_MODEL,
    timeout: process.env.AI_ASSISTANT_REQUEST_TIMEOUT_MS,
  };

  try {
    delete process.env.OPENAI_API_KEY;
    process.env.AI_ASSISTANT_MODEL = "test-model";
    assert.throws(() => getAssistantOpenAIConfig(), AssistantConfigurationError);

    process.env.OPENAI_API_KEY = "test-key-not-real";
    process.env.AI_ASSISTANT_MODEL = "test-model";
    process.env.AI_ASSISTANT_REQUEST_TIMEOUT_MS = "999";
    assert.throws(() => getAssistantRequestTimeoutMs(), AssistantConfigurationError);

    process.env.AI_ASSISTANT_REQUEST_TIMEOUT_MS = "1500";
    const config = getAssistantOpenAIConfig();
    assert.equal(config.model, "test-model");
    assert.equal(config.timeoutMs, 1500);
  } finally {
    if (original.key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original.key;
    if (original.model === undefined) delete process.env.AI_ASSISTANT_MODEL;
    else process.env.AI_ASSISTANT_MODEL = original.model;
    if (original.timeout === undefined) delete process.env.AI_ASSISTANT_REQUEST_TIMEOUT_MS;
    else process.env.AI_ASSISTANT_REQUEST_TIMEOUT_MS = original.timeout;
  }
});
