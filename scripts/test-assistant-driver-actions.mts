import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { AssistantTransportError } from "../src/lib/assistant/errors.ts";
import {
  parsePrepareAssignDriverArguments,
  parsePrepareClearDriverArguments,
  prepareAssignDriverTool,
  prepareClearDriverTool,
} from "../src/lib/assistant/tools/driver-assignment-contracts.ts";
import {
  DRIVER_ASSIGNMENT_COMMISSION_BLOCK_MESSAGE,
  prepareAssignDriverProposal,
  prepareClearDriverProposal,
} from "../src/lib/reservations/assistant-driver-assignment-core.ts";
import {
  DriverAssignmentCommissionConflictError,
  changeOwnedReservationDriver,
  type AssignmentDriverSnapshot,
  type DriverAssignmentRepository,
  type ReservationDriverAssignmentSnapshot,
} from "../src/lib/reservations/driver-assignment-core.ts";
import { createDriverAssignmentExecutor } from "../src/lib/assistant/actions/driver-assignment-executors.ts";
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

const admin = {
  userId: "admin-1",
  email: "owner@example.com",
  role: "ADMIN" as const,
};
const user = { ...admin, role: "USER" as const };
const actor: AiCanonicalActor = admin;

function driver(
  id: string,
  name: string,
  patch: Partial<AssignmentDriverSnapshot> = {},
): AssignmentDriverSnapshot {
  return {
    id,
    name,
    status: "ACTIVE",
    vehicleType: "VAN",
    updatedAt: new Date("2026-08-11T08:00:00.000Z"),
    ...patch,
  };
}

const ahmed = driver("driver-ahmed", "Ahmed");
const bilawal = driver("driver-bilawal", "Bilawal", { vehicleType: "SEDAN" });

function reservation(
  patch: Partial<ReservationDriverAssignmentSnapshot> = {},
): ReservationDriverAssignmentSnapshot {
  return {
    id: "reservation-1",
    userEmail: admin.email,
    isDeleted: false,
    updatedAt: new Date("2026-08-11T09:00:00.000Z"),
    startAt: new Date("2026-08-14T08:30:00.000Z"),
    pickupText: "BCN Airport",
    dropoffText: "Sabadell",
    driverId: null,
    driver: null,
    linkedCommission: null,
    ...patch,
  };
}

function cloneDriver(value: AssignmentDriverSnapshot | null) {
  return value ? { ...structuredClone(value), updatedAt: new Date(value.updatedAt) } : null;
}

function cloneReservation(value: ReservationDriverAssignmentSnapshot) {
  return {
    ...structuredClone(value),
    updatedAt: new Date(value.updatedAt),
    startAt: new Date(value.startAt),
    driver: cloneDriver(value.driver),
    linkedCommission: value.linkedCommission
      ? { ...structuredClone(value.linkedCommission), updatedAt: new Date(value.linkedCommission.updatedAt) }
      : null,
  };
}

class MemoryAssignmentRepository implements DriverAssignmentRepository {
  row: ReservationDriverAssignmentSnapshot | null;
  drivers = new Map<string, AssignmentDriverSnapshot>();
  reads = 0;
  writes = 0;
  failUpdate = false;

  constructor(
    row: ReservationDriverAssignmentSnapshot | null = reservation(),
    drivers: AssignmentDriverSnapshot[] = [ahmed, bilawal],
  ) {
    this.row = row ? cloneReservation(row) : null;
    drivers.forEach((item) => this.drivers.set(item.id, cloneDriver(item)!));
  }

  async findOwnedActive(input: { reservationId: string; ownerEmail: string }) {
    this.reads += 1;
    const row = this.row;
    return row &&
      row.id === input.reservationId &&
      row.userEmail.toLowerCase() === input.ownerEmail.toLowerCase() &&
      !row.isDeleted
      ? cloneReservation(row)
      : null;
  }

  async findById(reservationId: string) {
    this.reads += 1;
    return this.row?.id === reservationId ? cloneReservation(this.row) : null;
  }

  async findDriver(driverId: string) {
    this.reads += 1;
    return cloneDriver(this.drivers.get(driverId) ?? null);
  }

  async updateOwnedActiveDriver(input: {
    reservationId: string;
    ownerEmail: string;
    expectedUpdatedAt: Date;
    expectedDriverId: string | null;
    nextDriverId: string | null;
    requireNoLinkedCommission: boolean;
  }) {
    if (this.failUpdate) throw new Error("fixture database failure");
    const row = this.row;
    if (
      !row ||
      row.id !== input.reservationId ||
      row.userEmail.toLowerCase() !== input.ownerEmail.toLowerCase() ||
      row.isDeleted ||
      row.updatedAt.getTime() !== input.expectedUpdatedAt.getTime() ||
      row.driverId !== input.expectedDriverId ||
      (input.requireNoLinkedCommission && row.linkedCommission)
    ) {
      return false;
    }
    this.writes += 1;
    this.row = {
      ...row,
      driverId: input.nextDriverId,
      driver: input.nextDriverId
        ? cloneDriver(this.drivers.get(input.nextDriverId) ?? null)
        : null,
      updatedAt: new Date(row.updatedAt.getTime() + 1_000),
    };
    return true;
  }
}

const assignPreview: AiActionPreview = {
  title: "Assign driver",
  sections: [{ heading: "New driver", facts: [{ label: "Driver", value: "Ahmed" }] }],
};

function publicAction(
  actionType: "ASSIGN_DRIVER" | "CLEAR_DRIVER",
  preview = assignPreview,
): AiActionPublic {
  return {
    actionId: "action-1",
    actionType,
    riskLevel: "WRITE",
    status: "PENDING",
    expiresAt: "2026-08-11T10:10:00.000Z",
    preview,
    confirmationLabel: actionType === "ASSIGN_DRIVER"
      ? "Confirm assignment"
      : "Confirm removal",
  };
}

test("prepare driver tools are strict exact proposal contracts with no identity or finance inputs", () => {
  assert.equal(prepareAssignDriverTool.strict, true);
  assert.equal(prepareClearDriverTool.strict, true);
  assert.deepEqual(Object.keys(prepareAssignDriverTool.parameters.properties), [
    "reservation_id",
    "driver_id",
  ]);
  assert.deepEqual(Object.keys(prepareClearDriverTool.parameters.properties), [
    "reservation_id",
  ]);
  assert.equal(prepareAssignDriverTool.parameters.additionalProperties, false);
  assert.equal(prepareClearDriverTool.parameters.additionalProperties, false);
  assert.deepEqual(
    parsePrepareAssignDriverArguments(
      JSON.stringify({ reservation_id: "reservation-1", driver_id: "driver-ahmed" }),
    ),
    { reservation_id: "reservation-1", driver_id: "driver-ahmed" },
  );
  assert.deepEqual(
    parsePrepareClearDriverArguments(JSON.stringify({ reservation_id: "reservation-1" })),
    { reservation_id: "reservation-1" },
  );

  for (const forbidden of ["userId", "role", "email", "commissionAmount", "payload", "where"]) {
    assert.throws(
      () => parsePrepareAssignDriverArguments(JSON.stringify({
        reservation_id: "reservation-1",
        driver_id: "driver-ahmed",
        [forbidden]: "forged",
      })),
      (error: unknown) =>
        error instanceof AssistantTransportError && error.code === "TOOL_VALIDATION_FAILED",
    );
  }
  assert.throws(() => parsePrepareAssignDriverArguments("{"));
  assert.throws(() => parsePrepareClearDriverArguments(JSON.stringify({ reservation_id: "" })));
});

test("valid assign proposal is write-free and captures owner, reservation, current driver, commission, and ACTIVE target state", async () => {
  const repository = new MemoryAssignmentRepository(
    reservation({ driverId: bilawal.id, driver: bilawal }),
  );
  const prepared: Array<Record<string, unknown>> = [];
  const result = await prepareAssignDriverProposal(
    admin,
    { reservation_id: "reservation-1", driver_id: ahmed.id },
    {
      findOwnedActive: repository.findOwnedActive.bind(repository),
      findDriver: repository.findDriver.bind(repository),
      async prepareAction(input) {
        prepared.push(input);
        return { ok: true, code: "ACTION_PREPARED", action: publicAction("ASSIGN_DRIVER", input.preview) };
      },
    },
  );
  assert.equal(result.kind, "ACTION_PREVIEW");
  assert.equal(repository.writes, 0);
  assert.equal(prepared.length, 1);
  assert.deepEqual(prepared[0].payload, {
    reservationId: "reservation-1",
    targetDriverId: ahmed.id,
  });
  assert.deepEqual(prepared[0].precondition, {
    reservationId: "reservation-1",
    reservationUpdatedAt: "2026-08-11T09:00:00.000Z",
    ownerUserId: admin.userId,
    ownerEmail: admin.email,
    isDeleted: false,
    currentDriverId: bilawal.id,
    currentDriver: {
      id: bilawal.id,
      updatedAt: bilawal.updatedAt.toISOString(),
    },
    linkedCommission: null,
    targetDriver: {
      id: ahmed.id,
      status: "ACTIVE",
      updatedAt: ahmed.updatedAt.toISOString(),
    },
  });
  assert.equal(JSON.stringify(result).includes("commissionAmount"), false);
  assert.match(JSON.stringify(result), /BCN Airport/);
  assert.match(JSON.stringify(result), /Bilawal/);
  assert.match(JSON.stringify(result), /Ahmed/);
});

test("prepare authorization is checked before repository access and checked again by pending-action preparation", async () => {
  const repository = new MemoryAssignmentRepository();
  let actionCalls = 0;
  const forbidden = await prepareAssignDriverProposal(
    user,
    { reservation_id: "reservation-1", driver_id: ahmed.id },
    {
      findOwnedActive: repository.findOwnedActive.bind(repository),
      findDriver: repository.findDriver.bind(repository),
      async prepareAction() {
        actionCalls += 1;
        return { ok: true, action: publicAction("ASSIGN_DRIVER") };
      },
    },
  );
  assert.equal(forbidden.kind, "FORBIDDEN");
  assert.equal(repository.reads, 0);
  assert.equal(actionCalls, 0);

  const canonicalRoleChanged = await prepareAssignDriverProposal(
    admin,
    { reservation_id: "reservation-1", driver_id: ahmed.id },
    {
      findOwnedActive: repository.findOwnedActive.bind(repository),
      findDriver: repository.findDriver.bind(repository),
      async prepareAction() {
        return { ok: false, code: "ACTION_FORBIDDEN" };
      },
    },
  );
  assert.equal(canonicalRoleChanged.kind, "FORBIDDEN");
});

test("assign preparation handles missing, inactive, same-driver, replacement, and linked-commission states without mutation", async (t) => {
  const cases: Array<{
    name: string;
    repository: MemoryAssignmentRepository;
    driverId: string;
    kind: string;
    message?: RegExp;
    prepareCalls?: number;
  }> = [
    {
      name: "inaccessible reservation",
      repository: new MemoryAssignmentRepository(null),
      driverId: ahmed.id,
      kind: "NOT_FOUND",
    },
    {
      name: "missing driver",
      repository: new MemoryAssignmentRepository(reservation(), []),
      driverId: "missing-driver",
      kind: "NOT_FOUND",
    },
    {
      name: "inactive driver",
      repository: new MemoryAssignmentRepository(reservation(), [driver("inactive", "Inactive", { status: "INACTIVE" })]),
      driverId: "inactive",
      kind: "INACTIVE_DRIVER",
    },
    {
      name: "same driver no-op",
      repository: new MemoryAssignmentRepository(reservation({ driverId: ahmed.id, driver: ahmed })),
      driverId: ahmed.id,
      kind: "NO_CHANGES",
      message: /Ahmed is already assigned/,
    },
    {
      name: "linked commission block",
      repository: new MemoryAssignmentRepository(reservation({
        driverId: bilawal.id,
        driver: bilawal,
        linkedCommission: {
          id: "commission-1",
          driverId: bilawal.id,
          updatedAt: new Date("2026-08-11T08:30:00.000Z"),
        },
      })),
      driverId: ahmed.id,
      kind: "COMMISSION_BLOCKED",
      message: /commission-aware workflow/,
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      let prepareCalls = 0;
      const result = await prepareAssignDriverProposal(
        admin,
        { reservation_id: "reservation-1", driver_id: fixture.driverId },
        {
          findOwnedActive: fixture.repository.findOwnedActive.bind(fixture.repository),
          findDriver: fixture.repository.findDriver.bind(fixture.repository),
          async prepareAction() {
            prepareCalls += 1;
            return { ok: true, action: publicAction("ASSIGN_DRIVER") };
          },
        },
      );
      assert.equal(result.kind, fixture.kind);
      if (fixture.message && "message" in result) assert.match(result.message, fixture.message);
      assert.equal(prepareCalls, 0);
      assert.equal(fixture.repository.writes, 0);
    });
  }
});

test("clear preparation creates an exact preview, but no-ops unassigned and blocks linked commissions", async () => {
  const assigned = new MemoryAssignmentRepository(
    reservation({ driverId: ahmed.id, driver: ahmed }),
  );
  let stored: Record<string, unknown> | undefined;
  const valid = await prepareClearDriverProposal(
    admin,
    { reservation_id: "reservation-1" },
    {
      findOwnedActive: assigned.findOwnedActive.bind(assigned),
      findDriver: assigned.findDriver.bind(assigned),
      async prepareAction(input) {
        stored = input;
        return { ok: true, action: publicAction("CLEAR_DRIVER", input.preview) };
      },
    },
  );
  assert.equal(valid.kind, "ACTION_PREVIEW");
  assert.deepEqual(stored?.payload, { reservationId: "reservation-1" });
  assert.equal("targetDriver" in (stored?.precondition as JsonObject), false);
  assert.match(JSON.stringify(valid), /Unassigned/);
  assert.equal(assigned.writes, 0);

  const unassigned = new MemoryAssignmentRepository();
  const noOp = await prepareClearDriverProposal(admin, { reservation_id: "reservation-1" }, {
    findOwnedActive: unassigned.findOwnedActive.bind(unassigned),
    findDriver: unassigned.findDriver.bind(unassigned),
    async prepareAction() { throw new Error("must not prepare"); },
  });
  assert.deepEqual(noOp, { kind: "NO_CHANGES", message: "This reservation is already unassigned." });

  const withCommission = new MemoryAssignmentRepository(reservation({
    driverId: ahmed.id,
    driver: ahmed,
    linkedCommission: {
      id: "commission-1",
      driverId: ahmed.id,
      updatedAt: new Date("2026-08-11T08:30:00.000Z"),
    },
  }));
  const blocked = await prepareClearDriverProposal(admin, { reservation_id: "reservation-1" }, {
    findOwnedActive: withCommission.findOwnedActive.bind(withCommission),
    findDriver: withCommission.findDriver.bind(withCommission),
    async prepareAction() { throw new Error("must not prepare"); },
  });
  assert.deepEqual(blocked, {
    kind: "COMMISSION_BLOCKED",
    message: DRIVER_ASSIGNMENT_COMMISSION_BLOCK_MESSAGE,
  });
});

test("shared assignment service changes only Reservation.driverId and atomically blocks linked commissions", async () => {
  const repository = new MemoryAssignmentRepository();
  const assigned = await changeOwnedReservationDriver({
    reservationId: "reservation-1",
    ownerEmail: admin.email,
    nextDriverId: ahmed.id,
    commissionPolicy: "BLOCK_LINKED",
  }, repository);
  assert.equal(assigned.changed, true);
  assert.equal(repository.row?.driverId, ahmed.id);
  assert.equal(repository.row?.linkedCommission, null);
  assert.equal(repository.writes, 1);

  const cleared = await changeOwnedReservationDriver({
    reservationId: "reservation-1",
    ownerEmail: admin.email,
    nextDriverId: null,
    commissionPolicy: "BLOCK_LINKED",
  }, repository);
  assert.equal(cleared.changed, true);
  assert.equal(repository.row?.driverId, null);
  assert.equal(repository.row?.linkedCommission, null);
  assert.equal(repository.writes, 2);

  repository.row = reservation({
    driverId: bilawal.id,
    driver: bilawal,
    linkedCommission: {
      id: "commission-1",
      driverId: bilawal.id,
      updatedAt: new Date("2026-08-11T08:30:00.000Z"),
    },
  });
  const beforeCommission = structuredClone(repository.row.linkedCommission);
  await assert.rejects(
    () => changeOwnedReservationDriver({
      reservationId: "reservation-1",
      ownerEmail: admin.email,
      nextDriverId: ahmed.id,
      commissionPolicy: "BLOCK_LINKED",
    }, repository),
    DriverAssignmentCommissionConflictError,
  );
  assert.deepEqual(repository.row.linkedCommission, beforeCommission);
  assert.equal(repository.row.driverId, bilawal.id);
});

function assignStoredAction(
  patch: { payload?: JsonObject; precondition?: JsonObject; actionType?: "ASSIGN_DRIVER" | "CLEAR_DRIVER" } = {},
): AiPendingActionRecord {
  const actionType = patch.actionType ?? "ASSIGN_DRIVER";
  const base = reservation({ driverId: bilawal.id, driver: bilawal });
  const common: JsonObject = {
    reservationId: base.id,
    reservationUpdatedAt: base.updatedAt.toISOString(),
    ownerUserId: admin.userId,
    ownerEmail: admin.email,
    isDeleted: false,
    currentDriverId: bilawal.id,
    currentDriver: { id: bilawal.id, updatedAt: bilawal.updatedAt.toISOString() },
    linkedCommission: null,
  };
  const precondition = actionType === "ASSIGN_DRIVER"
    ? {
        ...common,
        targetDriver: {
          id: ahmed.id,
          status: "ACTIVE",
          updatedAt: ahmed.updatedAt.toISOString(),
        },
      }
    : common;
  return {
    id: "action-1",
    userId: admin.userId,
    actionType,
    riskLevel: "WRITE",
    status: "EXECUTING",
    payload: patch.payload ?? (actionType === "ASSIGN_DRIVER"
      ? { reservationId: base.id, targetDriverId: ahmed.id }
      : { reservationId: base.id }),
    preview: assignPreview,
    precondition: patch.precondition ?? precondition,
    confirmationLabel: actionType === "ASSIGN_DRIVER" ? "Confirm assignment" : "Confirm removal",
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

test("ASSIGN_DRIVER and CLEAR_DRIVER executors return deterministic result and bounded audit facts", async () => {
  const assignRepository = new MemoryAssignmentRepository(
    reservation({ driverId: bilawal.id, driver: bilawal }),
  );
  const assignExecutor = createDriverAssignmentExecutor("ASSIGN_DRIVER", () => assignRepository);
  assert.deepEqual(
    await assignExecutor.checkPreconditions({ transaction: {}, action: assignStoredAction(), actor }),
    { kind: "VALID" },
  );
  const assigned = await assignExecutor.execute({ transaction: {}, action: assignStoredAction(), actor });
  assert.equal(assigned.kind, "EXECUTED");
  if (assigned.kind === "EXECUTED") {
    assert.equal(assigned.result.title, "Driver assigned");
    assert.match(assigned.result.message ?? "", /Ahmed/);
    assert.deepEqual(assigned.audit.metadata, {
      reservationId: "reservation-1",
      beforeDriverId: bilawal.id,
      beforeDriverName: "Bilawal",
      afterDriverId: ahmed.id,
      afterDriverName: "Ahmed",
    });
  }
  assert.equal(assignRepository.writes, 1);

  const clearRepository = new MemoryAssignmentRepository(
    reservation({ driverId: bilawal.id, driver: bilawal }),
  );
  const clearExecutor = createDriverAssignmentExecutor("CLEAR_DRIVER", () => clearRepository);
  const clearAction = assignStoredAction({ actionType: "CLEAR_DRIVER" });
  assert.deepEqual(
    await clearExecutor.checkPreconditions({ transaction: {}, action: clearAction, actor }),
    { kind: "VALID" },
  );
  const cleared = await clearExecutor.execute({ transaction: {}, action: clearAction, actor });
  assert.equal(cleared.kind, "EXECUTED");
  if (cleared.kind === "EXECUTED") {
    assert.equal(cleared.result.title, "Driver removed");
    assert.match(cleared.result.message ?? "", /Status: Unassigned/);
    assert.equal(cleared.audit.metadata?.afterDriverId, null);
  }
  assert.equal(clearRepository.writes, 1);
});

test("driver executor database failure returns a deterministic failure without a driver write", async () => {
  const repository = new MemoryAssignmentRepository(
    reservation({ driverId: bilawal.id, driver: bilawal }),
  );
  repository.failUpdate = true;
  const executor = createDriverAssignmentExecutor("ASSIGN_DRIVER", () => repository);
  assert.deepEqual(
    await executor.checkPreconditions({ transaction: {}, action: assignStoredAction(), actor }),
    { kind: "VALID" },
  );
  assert.deepEqual(
    await executor.execute({ transaction: {}, action: assignStoredAction(), actor }),
    { kind: "FAILED", code: "ACTION_EXECUTOR_FAILED" },
  );
  assert.equal(repository.writes, 0);
  assert.equal(repository.row?.driverId, bilawal.id);
});

test("driver executors conflict on authorization, ownership, deletion, stale assignment, commission, or target state", async (t) => {
  const fixtures: Array<{
    name: string;
    mutate(repository: MemoryAssignmentRepository): AiCanonicalActor;
    code: string;
  }> = [
    {
      name: "actor loses ADMIN",
      mutate() { return { ...actor, role: "USER" }; },
      code: "ACTION_AUTHORIZATION_CHANGED",
    },
    {
      name: "ownership changes",
      mutate(repository) { repository.row!.userEmail = "other@example.com"; return actor; },
      code: "ACTION_RESERVATION_UNAVAILABLE",
    },
    {
      name: "reservation deleted",
      mutate(repository) { repository.row!.isDeleted = true; return actor; },
      code: "ACTION_RESERVATION_UNAVAILABLE",
    },
    {
      name: "updatedAt changes",
      mutate(repository) { repository.row!.updatedAt = new Date("2026-08-11T09:01:00.000Z"); return actor; },
      code: "ACTION_ASSIGNMENT_STALE",
    },
    {
      name: "current driver changes",
      mutate(repository) { repository.row!.driverId = ahmed.id; repository.row!.driver = ahmed; return actor; },
      code: "ACTION_ASSIGNMENT_STALE",
    },
    {
      name: "linked commission appears",
      mutate(repository) {
        repository.row!.linkedCommission = {
          id: "commission-1",
          driverId: bilawal.id,
          updatedAt: new Date("2026-08-11T09:00:30.000Z"),
        };
        return actor;
      },
      code: "ACTION_ASSIGNMENT_STALE",
    },
    {
      name: "target becomes inactive",
      mutate(repository) { repository.drivers.get(ahmed.id)!.status = "INACTIVE"; return actor; },
      code: "ACTION_DRIVER_STATE_CHANGED",
    },
    {
      name: "target updatedAt changes",
      mutate(repository) { repository.drivers.get(ahmed.id)!.updatedAt = new Date("2026-08-11T08:01:00.000Z"); return actor; },
      code: "ACTION_DRIVER_STATE_CHANGED",
    },
  ];

  for (const fixture of fixtures) {
    await t.test(fixture.name, async () => {
      const repository = new MemoryAssignmentRepository(
        reservation({ driverId: bilawal.id, driver: bilawal }),
      );
      const canonicalActor = fixture.mutate(repository);
      const executor = createDriverAssignmentExecutor("ASSIGN_DRIVER", () => repository);
      assert.deepEqual(
        await executor.checkPreconditions({
          transaction: {},
          action: assignStoredAction(),
          actor: canonicalActor,
        }),
        { kind: "CONFLICTED", code: fixture.code },
      );
      assert.equal(repository.writes, 0);
    });
  }
});

function modelCall(name: string, args: unknown, id = `call-${name}`) {
  return {
    type: "function_call",
    name,
    call_id: id,
    arguments: typeof args === "string" ? args : JSON.stringify(args),
  };
}

const searchReservationArgs = {
  date: "2026-08-14",
  date_from: null,
  date_to: null,
  time_from: "10:00",
  time_to: "11:00",
  pickup: null,
  dropoff: "Sabadell",
  phone: null,
  driver_id: null,
  assigned: null,
  status: null,
  limit: 10,
};

const searchDriverArgs = {
  query: "Ahmed",
  status: "ACTIVE",
  vehicle_type: "ANY",
  balance_position: "ANY",
  limit: 10,
  cursor: null,
};

function toolLoopDependencies(
  rounds: AssistantModelResult[],
  patch: Partial<AssistantToolLoopDependencies> = {},
) {
  const queue = [...rounds];
  return {
    streamModel: async (request) => {
      const next = queue.shift();
      if (!next) throw new Error("No scripted model response.");
      if (next.output.every((item) => item.type !== "function_call")) {
        request.onTextDelta("Done");
      }
      return next;
    },
    searchReservations: async () => [{
      id: "reservation-1",
      serviceDate: "2026-08-14",
      pickupTime: "10:30",
      pickup: "BCN Airport",
      dropoff: "Sabadell",
      phone: null,
      passengerCount: 4,
      flightNumber: null,
      status: "PENDING" as const,
      driver: { id: bilawal.id, name: bilawal.name },
    }],
    getReservation: async () => ({
      id: "reservation-1",
      serviceDate: "2026-08-14",
      pickupTime: "10:30",
      pickup: "BCN Airport",
      dropoff: "Sabadell",
      phone: null,
      passengerCount: 4,
      flightNumber: null,
      status: "PENDING" as const,
      driver: { id: bilawal.id, name: bilawal.name },
    }),
    searchDrivers: async () => ({
      drivers: [{
        id: ahmed.id,
        name: ahmed.name,
        status: "ACTIVE" as const,
        vehicleType: ahmed.vehicleType,
        href: `/drivers/${ahmed.id}`,
        balance: "0.00",
        balancePosition: "SETTLED" as const,
        currency: "EUR" as const,
      }],
      count: 1,
      hasMore: false,
      nextCursor: null,
    }),
    getDriverLedgerSummary: async () => null,
    getDriverTransactions: async () => null,
    ...patch,
  } satisfies AssistantToolLoopDependencies;
}

async function runToolLoop(
  dependencies: AssistantToolLoopDependencies,
  message = "Assign Ahmed to tomorrow's 10:30 Sabadell job.",
) {
  const events: AssistantStreamEvent[] = [];
  await runReservationAssistantToolLoop({
    message,
    context: [],
    authContext: admin,
    signal: new AbortController().signal,
    emit: (event) => events.push(event),
  }, dependencies);
  return events;
}

test("tool loop requires exact reservation plus exact ACTIVE driver before assign preview", async () => {
  let prepareCalls = 0;
  const events = await runToolLoop(toolLoopDependencies([
    { output: [modelCall("search_reservations", searchReservationArgs, "reservation-search")] },
    { output: [modelCall("search_drivers", searchDriverArgs, "driver-search")] },
    { output: [modelCall("prepare_assign_driver", { reservation_id: "reservation-1", driver_id: ahmed.id }, "prepare")] },
    { output: [{ type: "message" }] },
  ], {
    async prepareAssignDriver() {
      prepareCalls += 1;
      return { kind: "ACTION_PREVIEW", action: publicAction("ASSIGN_DRIVER") };
    },
  }));
  assert.equal(prepareCalls, 1);
  assert.equal(events.filter((event) => event.type === "assistant.action_preview").length, 1);
});

test("ambiguous or inactive driver search cannot reach assignment preparation", async () => {
  for (const drivers of [
    [
      { id: "driver-a", name: "Ahmed A", status: "ACTIVE" as const },
      { id: "driver-b", name: "Ahmed B", status: "ACTIVE" as const },
    ],
    [{ id: "driver-inactive", name: "Ahmed", status: "INACTIVE" as const }],
  ]) {
    let prepareCalls = 0;
    const cards = drivers.map((item) => ({
      ...item,
      vehicleType: "VAN" as const,
      href: `/drivers/${item.id}`,
      balance: "0.00",
      balancePosition: "SETTLED" as const,
      currency: "EUR" as const,
    }));
    const targetId = cards[0].id;
    const events = await runToolLoop(toolLoopDependencies([
      { output: [modelCall("search_reservations", searchReservationArgs)] },
      { output: [modelCall("search_drivers", searchDriverArgs)] },
      { output: [modelCall("prepare_assign_driver", { reservation_id: "reservation-1", driver_id: targetId })] },
      { output: [{ type: "message" }] },
    ], {
      searchDrivers: async () => ({
        drivers: cards,
        count: cards.length,
        hasMore: false,
        nextCursor: null,
      }),
      async prepareAssignDriver() {
        prepareCalls += 1;
        return { kind: "ACTION_PREVIEW", action: publicAction("ASSIGN_DRIVER") };
      },
    }));
    assert.equal(prepareCalls, 0);
    assert.equal(events.some((event) => event.type === "assistant.action_preview"), false);
  }
});

test("tool loop prepares clear from one exact reservation and rejects direct or commission mutation tools", async () => {
  let clearCalls = 0;
  const clearEvents = await runToolLoop(toolLoopDependencies([
    { output: [modelCall("get_reservation", { reservation_id: "reservation-1" })] },
    { output: [modelCall("prepare_clear_driver", { reservation_id: "reservation-1" })] },
    { output: [{ type: "message" }] },
  ], {
    async prepareClearDriver() {
      clearCalls += 1;
      return { kind: "ACTION_PREVIEW", action: publicAction("CLEAR_DRIVER") };
    },
  }), "Remove the driver from this reservation.");
  assert.equal(clearCalls, 1);
  assert.equal(clearEvents.filter((event) => event.type === "assistant.action_preview").length, 1);

  for (const directTool of ["assign_driver", "clear_driver_directly", "update_reservation_commission", "confirm_action"]) {
    await assert.rejects(
      () => runToolLoop(toolLoopDependencies([
        { output: [modelCall(directTool, {})] },
      ])),
      (error: unknown) =>
        error instanceof AssistantTransportError && error.code === "UNKNOWN_TOOL",
    );
  }
});

test("source regression: normal UI uses the shared commission-aware service while Phase 2C execution remains non-financial", () => {
  const route = readFileSync(
    new URL("../src/app/api/reservations/[id]/route.ts", import.meta.url),
    "utf8",
  );
  const sharedCore = readFileSync(
    new URL("../src/lib/reservations/driver-assignment-core.ts", import.meta.url),
    "utf8",
  );
  const assignmentExecutor = readFileSync(
    new URL("../src/lib/assistant/actions/driver-assignment-executors.ts", import.meta.url),
    "utf8",
  );
  const registry = readFileSync(
    new URL("../src/lib/assistant/actions/executors.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /changeOwnedReservationDriverAndCommission/);
  assert.match(route, /ASSIGN_WITH_COMMISSION/);
  assert.match(route, /CLEAR_WITH_COMMISSION/);
  assert.match(route, /confirmCommissionRemoval/);
  assert.match(assignmentExecutor, /commissionPolicy: "BLOCK_LINKED"/);
  for (const source of [sharedCore, assignmentExecutor]) {
    assert.doesNotMatch(source, /commissionEntry\.(create|update|upsert|delete)/);
    assert.doesNotMatch(source, /payment\.(create|update|upsert|delete)/i);
    assert.doesNotMatch(source, /subscription.*\.(create|update|upsert|delete)/i);
    assert.doesNotMatch(source, /priceEuro|status:\s*"ASSIGNED"/);
  }
  assert.match(registry, /ASSIGN_DRIVER: assignDriverExecutor/);
  assert.match(registry, /CLEAR_DRIVER: clearDriverExecutor/);
  assert.match(
    registry,
    /UPDATE_RESERVATION_COMMISSION: updateReservationCommissionExecutor/,
  );
  for (const forbidden of [
    "ADD_MANUAL_COMMISSION:",
    "RECORD_DRIVER_PAYMENT:",
  ]) {
    assert.equal(registry.includes(forbidden), false);
  }
});
