import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { AssistantTransportError } from "../src/lib/assistant/errors.ts";
import {
  parsePrepareUpdateReservationArguments,
  prepareUpdateReservationTool,
} from "../src/lib/assistant/tools/reservation-update-contract.ts";
import {
  buildReservationAssistantPatch,
  parseReservationUiUpdate,
  reservationUpdateChangedFields,
  ReservationUpdateInputError,
  type PrepareReservationUpdateArguments,
  type ReservationUpdatePatch,
  type ReservationUpdateSnapshot,
} from "../src/lib/reservations/update-core.ts";
import {
  prepareReservationUpdateProposal,
} from "../src/lib/reservations/assistant-update-core.ts";
import {
  OwnedReservationConflictError,
  OwnedReservationNotFoundError,
  updateOwnedReservation,
  type OwnedReservationUpdateRepository,
} from "../src/lib/reservations/update-service.ts";
import { createUpdateReservationExecutor } from "../src/lib/assistant/actions/reservation-update-executor.ts";
import type {
  AiActionPreview,
  AiActionPublic,
  JsonObject,
} from "../src/lib/assistant/actions/contracts.ts";
import type {
  AiCanonicalActor,
  AiPendingActionRecord,
} from "../src/lib/assistant/actions/core.ts";
import {
  runReservationAssistantToolLoop,
  type AssistantModelResult,
  type AssistantToolLoopDependencies,
} from "../src/lib/assistant/tool-loop.ts";
import type { AssistantStreamEvent } from "../src/lib/assistant/stream-protocol.ts";

const owner = {
  userId: "user-1",
  email: "owner@example.com",
  role: "USER" as const,
};

function snapshot(patch: Partial<ReservationUpdateSnapshot> = {}): ReservationUpdateSnapshot {
  return {
    id: "reservation-1",
    userEmail: owner.email,
    isDeleted: false,
    updatedAt: new Date("2026-08-11T09:00:00.000Z"),
    pickupText: "El Prat",
    dropoffText: "Sabadell",
    startAt: new Date("2026-11-21T08:50:00.000Z"),
    endAt: null,
    pax: 8,
    phone: "+34 600 123 456",
    flight: "VY100",
    notes: "Require 2 vans",
    ...patch,
  };
}

const emptyArguments: PrepareReservationUpdateArguments = {
  reservation_id: "reservation-1",
  pickup: null,
  dropoff: null,
  service_date: null,
  pickup_time: null,
  end_date: null,
  end_time: null,
  passengers: null,
  phone: null,
  flight: null,
  notes: null,
};

const preview: AiActionPreview = {
  title: "Update reservation",
  sections: [
    {
      heading: "Changes",
      facts: [{ label: "Passengers", previousValue: "8", value: "15" }],
    },
  ],
};

function publicAction(actionPreview = preview): AiActionPublic {
  return {
    actionId: "action-1",
    actionType: "UPDATE_RESERVATION",
    riskLevel: "WRITE",
    status: "PENDING",
    expiresAt: "2026-08-11T10:10:00.000Z",
    preview: actionPreview,
    confirmationLabel: "Confirm changes",
  };
}

function cloneSnapshot(value: ReservationUpdateSnapshot) {
  return {
    ...structuredClone(value),
    updatedAt: new Date(value.updatedAt),
    startAt: new Date(value.startAt),
    endAt: value.endAt ? new Date(value.endAt) : null,
  };
}

class MemoryReservationRepository implements OwnedReservationUpdateRepository {
  row: ReservationUpdateSnapshot | null;
  writes = 0;
  failUpdate = false;

  constructor(row: ReservationUpdateSnapshot | null = snapshot()) {
    this.row = row ? cloneSnapshot(row) : null;
  }

  async findOwnedActive(input: { reservationId: string; ownerEmail: string }) {
    const row = this.row;
    return row &&
      row.id === input.reservationId &&
      row.userEmail.toLowerCase() === input.ownerEmail.toLowerCase() &&
      !row.isDeleted
      ? cloneSnapshot(row)
      : null;
  }

  async updateOwnedActive(input: {
    reservationId: string;
    ownerEmail: string;
    patch: ReservationUpdatePatch;
    expectedUpdatedAt?: Date;
  }) {
    if (this.failUpdate) throw new Error("fixture database failure");
    const row = this.row;
    if (
      !row ||
      row.id !== input.reservationId ||
      row.userEmail.toLowerCase() !== input.ownerEmail.toLowerCase() ||
      row.isDeleted ||
      (input.expectedUpdatedAt && row.updatedAt.getTime() !== input.expectedUpdatedAt.getTime())
    ) {
      return false;
    }
    this.writes += 1;
    this.row = {
      ...row,
      ...structuredClone(input.patch),
      startAt: input.patch.startAt ? new Date(input.patch.startAt) : row.startAt,
      endAt: "endAt" in input.patch
        ? input.patch.endAt
          ? new Date(input.patch.endAt)
          : null
        : row.endAt,
      updatedAt: new Date("2026-08-11T09:01:00.000Z"),
    };
    return true;
  }

  async findById(reservationId: string) {
    return this.row?.id === reservationId ? cloneSnapshot(this.row) : null;
  }
}

test("prepare_update_reservation has an exact strict allowlist with no identity, price, status, driver, or finance input", () => {
  assert.equal(prepareUpdateReservationTool.strict, true);
  assert.deepEqual(Object.keys(prepareUpdateReservationTool.parameters.properties), [
    "reservation_id",
    "pickup",
    "dropoff",
    "service_date",
    "pickup_time",
    "end_date",
    "end_time",
    "passengers",
    "phone",
    "flight",
    "notes",
  ]);
  assert.equal(prepareUpdateReservationTool.parameters.additionalProperties, false);

  const valid = parsePrepareUpdateReservationArguments(
    JSON.stringify({ ...emptyArguments, passengers: 15 }),
  );
  assert.equal(valid.passengers, 15);

  for (const forbidden of ["priceEuro", "status", "driverId", "commission", "userId", "updatedAt"]) {
    assert.throws(
      () => parsePrepareUpdateReservationArguments(
        JSON.stringify({ ...emptyArguments, [forbidden]: "forged" }),
      ),
      (error: unknown) =>
        error instanceof AssistantTransportError && error.code === "TOOL_VALIDATION_FAILED",
    );
  }
  assert.throws(() => parsePrepareUpdateReservationArguments(JSON.stringify({ ...emptyArguments, passengers: 1.5 })));
  assert.throws(() => parsePrepareUpdateReservationArguments(JSON.stringify({ ...emptyArguments, notes: "x".repeat(2001) })));
});

test("normal UI and assistant inputs share the same field normalization and integer passenger rule", () => {
  const ui = parseReservationUiUpdate({
    pickupText: "Airport",
    dropoffText: "City",
    startAt: "2026-11-21T09:30:00.000Z",
    endAt: "",
    pax: "15",
    phone: "+44 20 1234 5678",
    flight: "BA123",
    notes: "Plain text",
  });
  assert.deepEqual(reservationUpdateChangedFields(ui), [
    "pickupText",
    "dropoffText",
    "startAt",
    "endAt",
    "pax",
    "phone",
    "flight",
    "notes",
  ]);
  assert.equal(ui.phone, "+44 20 1234 5678");
  assert.equal(ui.endAt, null);
  assert.throws(() => parseReservationUiUpdate({ pax: 1.5 }), ReservationUpdateInputError);
  assert.throws(() => parseReservationUiUpdate({ pax: 0 }), ReservationUpdateInputError);
  assert.throws(() => parseReservationUiUpdate({ pax: 100 }), ReservationUpdateInputError);
});

test("Madrid components create stored instants, reject spring DST gaps, and accept the autumn overlap", () => {
  const current = snapshot();
  const patch = buildReservationAssistantPatch(current, {
    ...emptyArguments,
    service_date: "2026-11-21",
    pickup_time: "10:30",
    end_date: "2026-11-21",
    end_time: "11:15",
  });
  assert.equal(patch.startAt?.toISOString(), "2026-11-21T09:30:00.000Z");
  assert.equal(patch.endAt?.toISOString(), "2026-11-21T10:15:00.000Z");
  assert.throws(
    () => buildReservationAssistantPatch(current, {
      ...emptyArguments,
      service_date: "2026-03-29",
      pickup_time: "02:30",
    }),
    ReservationUpdateInputError,
  );
  assert.doesNotThrow(() => buildReservationAssistantPatch(current, {
    ...emptyArguments,
    service_date: "2026-10-25",
    pickup_time: "02:30",
  }));
  assert.throws(() => buildReservationAssistantPatch(current, {
    ...emptyArguments,
    service_date: "2026-02-30",
    pickup_time: "10:00",
  }));
  assert.throws(() => buildReservationAssistantPatch(current, {
    ...emptyArguments,
    service_date: "2026-11-21",
  }));
});

test("proposal preparation resolves one owned active reservation, captures exact before-values, and never mutates it", async () => {
  const repository = new MemoryReservationRepository();
  const preparedInputs: Array<Record<string, unknown>> = [];
  const result = await prepareReservationUpdateProposal(
    owner,
    { ...emptyArguments, pickup_time: "10:30", service_date: "2026-11-21", passengers: 15, notes: "15 passengers, 2 vans required" },
    {
      findOwnedActive: repository.findOwnedActive.bind(repository),
      async prepareAction(input) {
        preparedInputs.push(input);
        return { ok: true, action: publicAction(input.preview) };
      },
    },
  );
  assert.equal(result.kind, "ACTION_PREVIEW");
  assert.equal(repository.writes, 0);
  assert.equal(preparedInputs.length, 1);
  const action = preparedInputs[0];
  assert.deepEqual(action.payload, {
    reservationId: "reservation-1",
    changes: {
      startAt: "2026-11-21T09:30:00.000Z",
      pax: 15,
      notes: "15 passengers, 2 vans required",
    },
  });
  assert.deepEqual(action.precondition, {
    reservationId: "reservation-1",
    updatedAt: "2026-08-11T09:00:00.000Z",
    ownerUserId: "user-1",
    ownerEmail: "owner@example.com",
    isDeleted: false,
    before: {
      startAt: "2026-11-21T08:50:00.000Z",
      pax: 8,
      notes: "Require 2 vans",
    },
  });
  assert.equal(JSON.stringify(result).includes("\"payload\""), false);
  assert.equal(JSON.stringify(result).includes("\"precondition\""), false);
  assert.equal(JSON.stringify(result).includes("15 passengers, 2 vans required"), true);
});

test("inaccessible/deleted reservations and normalized no-ops create no pending action", async () => {
  for (const row of [null, snapshot({ isDeleted: true })]) {
    let prepareCalls = 0;
    const repository = new MemoryReservationRepository(row);
    const result = await prepareReservationUpdateProposal(owner, emptyArguments, {
      findOwnedActive: repository.findOwnedActive.bind(repository),
      async prepareAction() {
        prepareCalls += 1;
        return { ok: true, action: publicAction() };
      },
    });
    assert.equal(result.kind, "NOT_FOUND");
    assert.equal(prepareCalls, 0);
  }

  let prepareCalls = 0;
  const current = snapshot();
  const repository = new MemoryReservationRepository(current);
  const result = await prepareReservationUpdateProposal(
    owner,
    { ...emptyArguments, pickup: current.pickupText, passengers: current.pax },
    {
      findOwnedActive: repository.findOwnedActive.bind(repository),
      async prepareAction() {
        prepareCalls += 1;
        return { ok: true, action: publicAction() };
      },
    },
  );
  assert.deepEqual(result, { kind: "NO_CHANGES", message: "No changes are needed." });
  assert.equal(prepareCalls, 0);
});

test("the shared update service enforces ownership, active state, and optimistic updatedAt", async () => {
  const repository = new MemoryReservationRepository();
  const updated = await updateOwnedReservation(
    {
      reservationId: "reservation-1",
      ownerEmail: owner.email,
      patch: { phone: "+33 1 23 45 67 89", pax: 9 },
      expectedUpdatedAt: new Date("2026-08-11T09:00:00.000Z"),
    },
    repository,
  );
  assert.equal(updated.phone, "+33 1 23 45 67 89");
  assert.equal(updated.pax, 9);
  assert.equal(repository.writes, 1);

  await assert.rejects(
    () => updateOwnedReservation({ reservationId: "reservation-1", ownerEmail: "other@example.com", patch: { pax: 10 } }, repository),
    OwnedReservationNotFoundError,
  );
  await assert.rejects(
    () => updateOwnedReservation({ reservationId: "reservation-1", ownerEmail: owner.email, patch: { pax: 10 }, expectedUpdatedAt: new Date("2026-08-11T09:00:00.000Z") }, repository),
    OwnedReservationConflictError,
  );
  await assert.rejects(
    () => updateOwnedReservation({
      reservationId: "reservation-1",
      ownerEmail: owner.email,
      patch: { priceEuro: 100 } as unknown as ReservationUpdatePatch,
    }, repository),
    ReservationUpdateInputError,
  );
  repository.row = snapshot({ isDeleted: true });
  await assert.rejects(
    () => updateOwnedReservation({ reservationId: "reservation-1", ownerEmail: owner.email, patch: { pax: 10 } }, repository),
    OwnedReservationNotFoundError,
  );
});

function storedAction(
  patch: {
    payload?: JsonObject;
    precondition?: JsonObject;
  } = {},
): AiPendingActionRecord {
  return {
    id: "action-1",
    userId: owner.userId,
    actionType: "UPDATE_RESERVATION",
    riskLevel: "WRITE",
    status: "EXECUTING",
    payload: patch.payload ?? {
      reservationId: "reservation-1",
      changes: { pax: 15, notes: "15 passengers" },
    },
    preview,
    precondition: patch.precondition ?? {
      reservationId: "reservation-1",
      updatedAt: "2026-08-11T09:00:00.000Z",
      ownerUserId: owner.userId,
      ownerEmail: owner.email,
      isDeleted: false,
      before: { pax: 8, notes: "Require 2 vans" },
    },
    confirmationLabel: "Confirm changes",
    idempotencyKey: "idempotency-1",
    expiresAt: new Date("2026-08-11T10:10:00.000Z"),
    confirmedAt: new Date("2026-08-11T10:00:00.000Z"),
    executedAt: null,
    result: null,
    failureCode: null,
    createdAt: new Date("2026-08-11T10:00:00.000Z"),
    updatedAt: new Date("2026-08-11T10:00:00.000Z"),
  };
}

test("UPDATE_RESERVATION executor rechecks actor, updatedAt, before-values, ownership, and deletion", async () => {
  const transaction = {};
  const repository = new MemoryReservationRepository();
  const executor = createUpdateReservationExecutor(() => repository);
  assert.deepEqual(
    await executor.checkPreconditions({ transaction, action: storedAction(), actor: owner as AiCanonicalActor }),
    { kind: "VALID" },
  );

  repository.row = snapshot({ updatedAt: new Date("2026-08-11T09:00:01.000Z") });
  assert.deepEqual(
    await executor.checkPreconditions({ transaction, action: storedAction(), actor: owner as AiCanonicalActor }),
    { kind: "CONFLICTED", code: "ACTION_RESERVATION_STALE" },
  );
  repository.row = snapshot({ pax: 9 });
  assert.deepEqual(
    await executor.checkPreconditions({ transaction, action: storedAction(), actor: owner as AiCanonicalActor }),
    { kind: "CONFLICTED", code: "ACTION_RESERVATION_STALE" },
  );
  repository.row = snapshot({ userEmail: "other@example.com" });
  assert.deepEqual(
    await executor.checkPreconditions({ transaction, action: storedAction(), actor: owner as AiCanonicalActor }),
    { kind: "CONFLICTED", code: "ACTION_RESERVATION_UNAVAILABLE" },
  );
  repository.row = snapshot({ isDeleted: true });
  assert.deepEqual(
    await executor.checkPreconditions({ transaction, action: storedAction(), actor: owner as AiCanonicalActor }),
    { kind: "CONFLICTED", code: "ACTION_RESERVATION_UNAVAILABLE" },
  );
  repository.row = snapshot();
  assert.deepEqual(
    await executor.checkPreconditions({
      transaction,
      action: storedAction(),
      actor: { ...owner, email: "changed@example.com" } as AiCanonicalActor,
    }),
    { kind: "CONFLICTED", code: "ACTION_AUTHORIZATION_CHANGED" },
  );
});

test("UPDATE_RESERVATION executor performs one deterministic update and returns bounded result/audit facts", async () => {
  const repository = new MemoryReservationRepository();
  const executor = createUpdateReservationExecutor(() => repository);
  const outcome = await executor.execute({
    transaction: {},
    action: storedAction(),
    actor: owner as AiCanonicalActor,
  });
  assert.equal(outcome.kind, "EXECUTED");
  assert.equal(repository.writes, 1);
  assert.equal(repository.row?.pax, 15);
  assert.equal(repository.row?.notes, "15 passengers");
  if (outcome.kind === "EXECUTED") {
    assert.equal(outcome.result.title, "Reservation updated");
    assert.equal(outcome.result.reference?.href, "/reservations/reservation-1/edit");
    assert.deepEqual(outcome.audit.metadata, {
      reservationId: "reservation-1",
      changedFields: ["pax", "notes"],
      before: { pax: 8, notes: "Require 2 vans" },
      after: { pax: 15, notes: "15 passengers" },
    });
  }

  const failedRepository = new MemoryReservationRepository();
  failedRepository.failUpdate = true;
  const failed = await createUpdateReservationExecutor(() => failedRepository).execute({
    transaction: {},
    action: storedAction(),
    actor: owner as AiCanonicalActor,
  });
  assert.deepEqual(failed, { kind: "FAILED", code: "ACTION_EXECUTOR_FAILED" });
});

function call(name: string, args: Record<string, unknown>) {
  return {
    type: "function_call",
    name,
    call_id: `call-${name}`,
    arguments: JSON.stringify(args),
  };
}

function toolLoopDependencies(
  results: AssistantModelResult[],
  patch: Partial<AssistantToolLoopDependencies> = {},
): AssistantToolLoopDependencies {
  let round = 0;
  return {
    async streamModel(request) {
      const result = results[round++];
      for (const delta of (result as AssistantModelResult & { text?: string }).text ?? "") {
        request.onTextDelta(delta);
      }
      return result;
    },
    searchReservations: async () => [],
    getReservation: async () => null,
    searchDrivers: async () => ({ drivers: [], count: 0, hasMore: false, nextCursor: null }),
    getDriverLedgerSummary: async () => null,
    getDriverTransactions: async () => null,
    ...patch,
  };
}

async function runToolLoop(
  dependencies: AssistantToolLoopDependencies,
  message: string,
) {
  const events: AssistantStreamEvent[] = [];
  await runReservationAssistantToolLoop(
    {
      message,
      context: [],
      authContext: owner,
      signal: new AbortController().signal,
      emit(event) { events.push(event); },
    },
    dependencies,
  );
  return events;
}

test("tool loop exact-match scenario emits one action preview and performs no reservation write", async () => {
  let prepareCalls = 0;
  const events = await runToolLoop(
    toolLoopDependencies(
      [
        { output: [call("search_reservations", { date: "2026-08-12", date_from: null, date_to: null, time_from: "09:30", time_to: "10:30", pickup: null, dropoff: "Sabadell", phone: null, driver_id: null, assigned: null, status: null, limit: 10 })] },
        { output: [call("prepare_update_reservation", { ...emptyArguments, service_date: "2026-08-12", pickup_time: "10:30" })] },
        { output: [{ type: "message" }] },
      ],
      {
        searchReservations: async () => [{
          id: "reservation-1",
          serviceDate: "2026-08-12",
          pickupTime: "10:00",
          pickup: "Airport",
          dropoff: "Sabadell",
          phone: null,
          passengerCount: 2,
          flightNumber: null,
          status: "ASSIGNED",
        }],
        async prepareUpdateReservation() {
          prepareCalls += 1;
          return { kind: "ACTION_PREVIEW", action: publicAction() };
        },
      },
    ),
    "Change tomorrow's 10:00 Sabadell reservation to 10:30.",
  );
  assert.equal(prepareCalls, 1);
  assert.equal(events.filter((event) => event.type === "assistant.action_preview").length, 1);
});

test("tool loop ambiguity and out-of-scope requests create no action", async () => {
  for (const scenario of [
    "Two reservations matched; which one do you mean?",
    "Price updates are not available here.",
    "Driver assignment is not available in this phase.",
  ]) {
    let prepareCalls = 0;
    await runToolLoop(
      toolLoopDependencies(
        [{ output: [{ type: "message" }] }],
        { async prepareUpdateReservation() { prepareCalls += 1; return { kind: "NO_CHANGES", message: "No changes are needed." }; } },
      ),
      scenario,
    );
    assert.equal(prepareCalls, 0);
  }
});

test("a multi-result search cannot be followed by preparation without exact re-identification", async () => {
  let prepareCalls = 0;
  const events = await runToolLoop(
    toolLoopDependencies(
      [
        { output: [call("search_reservations", { date: "2026-08-12", date_from: null, date_to: null, time_from: "09:30", time_to: "10:30", pickup: null, dropoff: null, phone: null, driver_id: null, assigned: null, status: null, limit: 10 })] },
        { output: [call("prepare_update_reservation", { ...emptyArguments, service_date: "2026-08-12", pickup_time: "10:30" })] },
        { output: [{ type: "message" }] },
      ],
      {
        searchReservations: async () => [
          { id: "reservation-1", serviceDate: "2026-08-12", pickupTime: "10:00", pickup: "Airport", dropoff: "Sabadell", phone: null, passengerCount: 2, flightNumber: null, status: "ASSIGNED" },
          { id: "reservation-2", serviceDate: "2026-08-12", pickupTime: "10:05", pickup: "Airport", dropoff: "Sabadell", phone: null, passengerCount: 3, flightNumber: null, status: "ASSIGNED" },
        ],
        async prepareUpdateReservation() {
          prepareCalls += 1;
          return { kind: "ACTION_PREVIEW", action: publicAction() };
        },
      },
    ),
    "Change the 10am reservation.",
  );
  assert.equal(prepareCalls, 0);
  assert.equal(events.some((event) => event.type === "assistant.action_preview"), false);
});

test("model attempts to call a direct execution tool are rejected", async () => {
  await assert.rejects(
    () => runToolLoop(
      toolLoopDependencies([{ output: [call("execute_update_reservation", { reservation_id: "reservation-1" })] }]),
      "Execute it directly",
    ),
    (error: unknown) =>
      error instanceof AssistantTransportError && error.code === "UNKNOWN_TOOL",
  );
});

test("confirm-side source has no OpenAI dependency and registry contains exactly six executors", () => {
  const executorRegistry = readFileSync(
    new URL("../src/lib/assistant/actions/executors.ts", import.meta.url),
    "utf8",
  );
  const confirmService = readFileSync(
    new URL("../src/lib/assistant/actions/service.ts", import.meta.url),
    "utf8",
  );
  assert.match(executorRegistry, /UPDATE_RESERVATION: updateReservationExecutor/);
  assert.match(executorRegistry, /ASSIGN_DRIVER: assignDriverExecutor/);
  assert.match(executorRegistry, /CLEAR_DRIVER: clearDriverExecutor/);
  assert.match(
    executorRegistry,
    /UPDATE_RESERVATION_COMMISSION: updateReservationCommissionExecutor/,
  );
  assert.match(executorRegistry, /CREATE_RESERVATION: createReservationExecutor/);
  assert.match(executorRegistry, /IMPORT_DRIVERS: importDriversExecutor/);
  assert.equal((executorRegistry.match(/UPDATE_RESERVATION:/g) ?? []).length, 1);
  assert.equal((executorRegistry.match(/ASSIGN_DRIVER:/g) ?? []).length, 1);
  assert.equal((executorRegistry.match(/CLEAR_DRIVER:/g) ?? []).length, 1);
  assert.equal((executorRegistry.match(/UPDATE_RESERVATION_COMMISSION:/g) ?? []).length, 1);
  assert.equal((executorRegistry.match(/CREATE_RESERVATION:/g) ?? []).length, 1);
  assert.equal((executorRegistry.match(/IMPORT_DRIVERS:/g) ?? []).length, 1);
  for (const forbidden of ["RECORD_DRIVER_PAYMENT:"]) {
    assert.equal(executorRegistry.includes(forbidden), false);
  }
  assert.doesNotMatch(confirmService, /from ["']openai["']|assistant\/openai/);
});

test("reservation action card retains narrow-screen wrapping and 44px confirmation controls", () => {
  const card = readFileSync(
    new URL("../src/components/assistant/AssistantActionPreviewCard.tsx", import.meta.url),
    "utf8",
  );
  assert.match(card, /overflow-hidden/);
  assert.match(card, /min-w-0 break-words/);
  assert.match(card, /grid-cols-\[minmax\(0,0\.42fr\)_minmax\(0,0\.58fr\)\]/);
  assert.equal((card.match(/min-h-11/g) ?? []).length >= 3, true);
  assert.doesNotMatch(card, /onKeyDown|onKeyPress/);
});
