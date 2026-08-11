import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { AssistantTransportError } from "../src/lib/assistant/errors.ts";
import {
  parsePrepareAssignDriverWithCommissionArguments,
  parsePrepareClearDriverAndCommissionArguments,
  parsePrepareUpdateReservationCommissionArguments,
  prepareAssignDriverWithCommissionTool,
  prepareClearDriverAndCommissionTool,
  prepareUpdateReservationCommissionTool,
} from "../src/lib/assistant/tools/commission-aware-assignment-contracts.ts";
import {
  prepareAssignDriverWithCommissionProposal,
  prepareClearDriverAndCommissionProposal,
  prepareUpdateReservationCommissionProposal,
} from "../src/lib/reservations/assistant-commission-aware-assignment-core.ts";
import {
  CommissionAwareAssignmentInputError,
  changeOwnedReservationDriverAndCommission,
  type CommissionAwareAssignmentRepository,
  type NormalizedCommissionAwareAssignmentOperation,
} from "../src/lib/reservations/commission-aware-assignment-core.ts";
import {
  matchesDriverAssignmentPrecondition,
  type AssignmentDriverSnapshot,
  type DriverAssignmentExpectedState,
  type LinkedCommissionSnapshot,
  type ReservationDriverAssignmentSnapshot,
} from "../src/lib/reservations/driver-assignment-core.ts";
import { createCommissionAwareAssignmentExecutor } from "../src/lib/assistant/actions/commission-aware-assignment-executors.ts";
import {
  assertAiActionPreviewForRisk,
  deriveAiActionRisk,
  type AiActionPreview,
  type AiActionPublic,
  type JsonObject,
} from "../src/lib/assistant/actions/contracts.ts";
import type {
  AiCanonicalActor,
  AiPendingActionRecord,
} from "../src/lib/assistant/actions/core.ts";
import { calculateDriverFinancialSummary } from "../src/lib/drivers/financialMath.ts";
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

function linkedCommission(
  patch: Partial<LinkedCommissionSnapshot> = {},
): LinkedCommissionSnapshot {
  return {
    id: "commission-1",
    driverId: bilawal.id,
    reservationId: "reservation-1",
    commissionAmount: "25.00",
    entryDate: new Date("2026-08-14T00:00:00.000Z"),
    updatedAt: new Date("2026-08-11T08:30:00.000Z"),
    ...patch,
  };
}

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
    driverId: bilawal.id,
    driver: bilawal,
    linkedCommission: linkedCommission(),
    ...patch,
  };
}

function cloneDriver(value: AssignmentDriverSnapshot | null) {
  return value ? { ...structuredClone(value), updatedAt: new Date(value.updatedAt) } : null;
}

function cloneCommission(value: LinkedCommissionSnapshot | null) {
  return value
    ? {
        ...structuredClone(value),
        entryDate: new Date(value.entryDate),
        updatedAt: new Date(value.updatedAt),
      }
    : null;
}

function cloneReservation(value: ReservationDriverAssignmentSnapshot) {
  return {
    ...structuredClone(value),
    updatedAt: new Date(value.updatedAt),
    startAt: new Date(value.startAt),
    driver: cloneDriver(value.driver),
    linkedCommission: cloneCommission(value.linkedCommission),
  };
}

function expectedState(value: ReservationDriverAssignmentSnapshot): DriverAssignmentExpectedState {
  return {
    reservationUpdatedAt: new Date(value.updatedAt),
    currentDriverId: value.driverId,
    currentDriver: value.driver
      ? { id: value.driver.id, updatedAt: new Date(value.driver.updatedAt) }
      : null,
    linkedCommission: cloneCommission(value.linkedCommission),
  };
}

class MemoryCommissionAwareRepository implements CommissionAwareAssignmentRepository {
  row: ReservationDriverAssignmentSnapshot | null;
  drivers = new Map<string, AssignmentDriverSnapshot>();
  reads = 0;
  atomicWrites = 0;
  failAtomic = false;

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

  async applyAtomic(input: {
    reservationId: string;
    ownerEmail: string;
    expected: ReservationDriverAssignmentSnapshot;
    operation: NormalizedCommissionAwareAssignmentOperation;
  }) {
    const row = this.row;
    if (
      !row ||
      row.id !== input.reservationId ||
      row.userEmail.toLowerCase() !== input.ownerEmail.toLowerCase() ||
      row.isDeleted ||
      !matchesDriverAssignmentPrecondition(row, expectedState(input.expected))
    ) {
      return null;
    }

    const staged = cloneReservation(row);
    const operation = input.operation;
    if ("targetDriverId" in operation) {
      const target = this.drivers.get(operation.targetDriverId);
      if (
        !target ||
        target.status !== "ACTIVE" ||
        target.updatedAt.getTime() !== operation.targetDriverUpdatedAt.getTime()
      ) {
        return null;
      }
      staged.driverId = target.id;
      staged.driver = cloneDriver(target);
    }
    if (this.failAtomic) {
      throw new Error("fixture fails after staging the driver but before atomic commit");
    }

    if (operation.kind === "ASSIGN_WITH_COMMISSION") {
      staged.linkedCommission = staged.linkedCommission
        ? {
            ...staged.linkedCommission,
            driverId: operation.targetDriverId,
            commissionAmount: operation.commissionAmount,
            updatedAt: new Date(staged.linkedCommission.updatedAt.getTime() + 1_000),
          }
        : {
            id: "commission-created",
            driverId: operation.targetDriverId,
            reservationId: staged.id,
            commissionAmount: operation.commissionAmount,
            entryDate: new Date(operation.createEntryDate),
            updatedAt: new Date("2026-08-11T09:00:01.000Z"),
          };
    } else if (operation.kind === "UPDATE_COMMISSION") {
      staged.linkedCommission = {
        ...staged.linkedCommission!,
        commissionAmount: operation.commissionAmount,
        updatedAt: new Date(staged.linkedCommission!.updatedAt.getTime() + 1_000),
      };
    } else if (
      operation.kind === "CLEAR_WITH_COMMISSION" ||
      operation.kind === "ASSIGN_AND_REMOVE_COMMISSION"
    ) {
      staged.linkedCommission = null;
    }
    if (
      operation.kind === "CLEAR_WITH_COMMISSION" ||
      operation.kind === "CLEAR_WITHOUT_COMMISSION"
    ) {
      staged.driverId = null;
      staged.driver = null;
    }
    staged.updatedAt = new Date(staged.updatedAt.getTime() + 1_000);
    this.row = staged;
    this.atomicWrites += 1;
    return cloneReservation(staged);
  }
}

function publicAction(
  actionType: "ASSIGN_DRIVER" | "CLEAR_DRIVER" | "UPDATE_RESERVATION_COMMISSION",
  preview: AiActionPreview,
): AiActionPublic {
  return {
    actionId: "action-1",
    actionType,
    riskLevel: "FINANCIAL_WRITE",
    status: "PENDING",
    expiresAt: "2026-08-11T10:10:00.000Z",
    preview,
    confirmationLabel: "Confirm changes",
  };
}

test("Phase 2D prepare tools are strict, explicit, and contain no identity, date, or generic finance fields", () => {
  assert.deepEqual(Object.keys(prepareAssignDriverWithCommissionTool.parameters.properties), [
    "reservation_id",
    "driver_id",
    "commission_amount",
  ]);
  assert.deepEqual(Object.keys(prepareUpdateReservationCommissionTool.parameters.properties), [
    "reservation_id",
    "commission_amount",
  ]);
  assert.deepEqual(Object.keys(prepareClearDriverAndCommissionTool.parameters.properties), [
    "reservation_id",
  ]);
  for (const tool of [
    prepareAssignDriverWithCommissionTool,
    prepareUpdateReservationCommissionTool,
    prepareClearDriverAndCommissionTool,
  ]) {
    assert.equal(tool.strict, true);
    assert.equal(tool.parameters.additionalProperties, false);
  }
  assert.deepEqual(
    parsePrepareAssignDriverWithCommissionArguments(JSON.stringify({
      reservation_id: "reservation-1",
      driver_id: ahmed.id,
      commission_amount: "25.00",
    })),
    {
      reservation_id: "reservation-1",
      driver_id: ahmed.id,
      commission_amount: "25.00",
    },
  );
  assert.deepEqual(
    parsePrepareUpdateReservationCommissionArguments(JSON.stringify({
      reservation_id: "reservation-1",
      commission_amount: "30",
    })),
    { reservation_id: "reservation-1", commission_amount: "30" },
  );
  assert.deepEqual(
    parsePrepareClearDriverAndCommissionArguments(JSON.stringify({ reservation_id: "reservation-1" })),
    { reservation_id: "reservation-1" },
  );
  for (const forbidden of ["userId", "role", "email", "commissionDate", "payload", "where"]) {
    assert.throws(
      () => parsePrepareAssignDriverWithCommissionArguments(JSON.stringify({
        reservation_id: "reservation-1",
        driver_id: ahmed.id,
        commission_amount: "25.00",
        [forbidden]: "forged",
      })),
      (error: unknown) =>
        error instanceof AssistantTransportError && error.code === "TOOL_VALIDATION_FAILED",
    );
  }
});

test("assign-with-commission preparation captures exact financial state and creates no mutation", async () => {
  const repository = new MemoryCommissionAwareRepository();
  let stored: Record<string, unknown> | undefined;
  const result = await prepareAssignDriverWithCommissionProposal(
    admin,
    {
      reservation_id: "reservation-1",
      driver_id: ahmed.id,
      commission_amount: "30",
    },
    {
      findOwnedActive: repository.findOwnedActive.bind(repository),
      findDriver: repository.findDriver.bind(repository),
      async prepareAction(input) {
        stored = input;
        assertAiActionPreviewForRisk(input.preview, deriveAiActionRisk(input.actionType, input.payload));
        return { ok: true, action: publicAction("ASSIGN_DRIVER", input.preview) };
      },
    },
  );
  assert.equal(result.kind, "ACTION_PREVIEW");
  assert.equal(repository.atomicWrites, 0);
  assert.deepEqual(stored?.payload, {
    reservationId: "reservation-1",
    targetDriverId: ahmed.id,
    commissionAmount: "30.00",
  });
  assert.deepEqual((stored?.precondition as JsonObject).linkedCommission, {
    id: "commission-1",
    driverId: bilawal.id,
    reservationId: "reservation-1",
    commissionAmount: "25.00",
    entryDate: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-11T08:30:00.000Z",
  });
  assert.match(JSON.stringify(result), /€25\.00/);
  assert.match(JSON.stringify(result), /€30\.00/);
  assert.match(JSON.stringify(result), /move to Ahmed/);
});

test("prepare flows cover commission creation, amount update, clear, no-op, authorization, inactive driver, and invalid amounts", async (t) => {
  await t.test("new linked commission", async () => {
    const repository = new MemoryCommissionAwareRepository(
      reservation({ driverId: null, driver: null, linkedCommission: null }),
    );
    const result = await prepareAssignDriverWithCommissionProposal(admin, {
      reservation_id: "reservation-1",
      driver_id: ahmed.id,
      commission_amount: "25,5",
    }, {
      findOwnedActive: repository.findOwnedActive.bind(repository),
      findDriver: repository.findDriver.bind(repository),
      async prepareAction(input) {
        assert.equal(input.payload.commissionAmount, "25.50");
        assert.match(JSON.stringify(input.preview), /created for Ahmed/);
        return { ok: true, action: publicAction("ASSIGN_DRIVER", input.preview) };
      },
    });
    assert.equal(result.kind, "ACTION_PREVIEW");
  });

  await t.test("same-driver amount update and no-op", async () => {
    const repository = new MemoryCommissionAwareRepository();
    let calls = 0;
    const changed = await prepareUpdateReservationCommissionProposal(admin, {
      reservation_id: "reservation-1",
      commission_amount: "35",
    }, {
      findOwnedActive: repository.findOwnedActive.bind(repository),
      findDriver: repository.findDriver.bind(repository),
      async prepareAction(input) {
        calls += 1;
        return { ok: true, action: publicAction("UPDATE_RESERVATION_COMMISSION", input.preview) };
      },
    });
    assert.equal(changed.kind, "ACTION_PREVIEW");
    const noOp = await prepareUpdateReservationCommissionProposal(admin, {
      reservation_id: "reservation-1",
      commission_amount: "25.00",
    }, {
      findOwnedActive: repository.findOwnedActive.bind(repository),
      findDriver: repository.findDriver.bind(repository),
      async prepareAction() { calls += 1; throw new Error("must not prepare"); },
    });
    assert.equal(noOp.kind, "NO_CHANGES");
    assert.equal(calls, 1);
  });

  await t.test("clear with visible removal effect", async () => {
    const repository = new MemoryCommissionAwareRepository();
    const result = await prepareClearDriverAndCommissionProposal(admin, {
      reservation_id: "reservation-1",
    }, {
      findOwnedActive: repository.findOwnedActive.bind(repository),
      findDriver: repository.findDriver.bind(repository),
      async prepareAction(input) {
        assert.deepEqual(input.payload, {
          reservationId: "reservation-1",
          removesCommission: true,
        });
        assert.match(JSON.stringify(input.preview), /Removed/);
        return { ok: true, action: publicAction("CLEAR_DRIVER", input.preview) };
      },
    });
    assert.equal(result.kind, "ACTION_PREVIEW");
  });

  await t.test("forbidden before reads", async () => {
    const repository = new MemoryCommissionAwareRepository();
    const result = await prepareAssignDriverWithCommissionProposal(user, {
      reservation_id: "reservation-1",
      driver_id: ahmed.id,
      commission_amount: "25",
    }, {
      findOwnedActive: repository.findOwnedActive.bind(repository),
      findDriver: repository.findDriver.bind(repository),
      async prepareAction() { throw new Error("must not prepare"); },
    });
    assert.equal(result.kind, "FORBIDDEN");
    assert.equal(repository.reads, 0);
  });

  await t.test("missing commission and inactive driver", async () => {
    const noCommission = new MemoryCommissionAwareRepository(
      reservation({ linkedCommission: null }),
    );
    const update = await prepareUpdateReservationCommissionProposal(admin, {
      reservation_id: "reservation-1",
      commission_amount: "30",
    }, {
      findOwnedActive: noCommission.findOwnedActive.bind(noCommission),
      findDriver: noCommission.findDriver.bind(noCommission),
      async prepareAction() { throw new Error("must not prepare"); },
    });
    assert.equal(update.kind, "COMMISSION_REQUIRED");
    const inactive = driver("inactive", "Inactive", { status: "INACTIVE" });
    const inactiveRepository = new MemoryCommissionAwareRepository(reservation(), [inactive]);
    const assign = await prepareAssignDriverWithCommissionProposal(admin, {
      reservation_id: "reservation-1",
      driver_id: inactive.id,
      commission_amount: "30",
    }, {
      findOwnedActive: inactiveRepository.findOwnedActive.bind(inactiveRepository),
      findDriver: inactiveRepository.findDriver.bind(inactiveRepository),
      async prepareAction() { throw new Error("must not prepare"); },
    });
    assert.equal(assign.kind, "INACTIVE_DRIVER");
  });

  await t.test("inaccessible reservation, missing driver, and same-state assignment", async () => {
    const inaccessibleRepository = new MemoryCommissionAwareRepository(null);
    const inaccessible = await prepareAssignDriverWithCommissionProposal(admin, {
      reservation_id: "reservation-1",
      driver_id: ahmed.id,
      commission_amount: "25.00",
    }, {
      findOwnedActive: inaccessibleRepository.findOwnedActive.bind(inaccessibleRepository),
      findDriver: inaccessibleRepository.findDriver.bind(inaccessibleRepository),
      async prepareAction() { throw new Error("must not prepare"); },
    });
    assert.equal(inaccessible.kind, "NOT_FOUND");

    const missingDriverRepository = new MemoryCommissionAwareRepository(reservation(), []);
    const missingDriver = await prepareAssignDriverWithCommissionProposal(admin, {
      reservation_id: "reservation-1",
      driver_id: "missing-driver",
      commission_amount: "25.00",
    }, {
      findOwnedActive: missingDriverRepository.findOwnedActive.bind(missingDriverRepository),
      findDriver: missingDriverRepository.findDriver.bind(missingDriverRepository),
      async prepareAction() { throw new Error("must not prepare"); },
    });
    assert.equal(missingDriver.kind, "NOT_FOUND");

    const sameStateRepository = new MemoryCommissionAwareRepository();
    const sameState = await prepareAssignDriverWithCommissionProposal(admin, {
      reservation_id: "reservation-1",
      driver_id: bilawal.id,
      commission_amount: "25.00",
    }, {
      findOwnedActive: sameStateRepository.findOwnedActive.bind(sameStateRepository),
      findDriver: sameStateRepository.findDriver.bind(sameStateRepository),
      async prepareAction() { throw new Error("must not prepare"); },
    });
    assert.equal(sameState.kind, "NO_CHANGES");
  });

  await t.test("malformed, negative, zero, and over-precision amounts", async () => {
    for (const amount of ["-1", "0", "abc", "1.234", "999999999.00"]) {
      const repository = new MemoryCommissionAwareRepository();
      const result = await prepareUpdateReservationCommissionProposal(admin, {
        reservation_id: "reservation-1",
        commission_amount: amount,
      }, {
        findOwnedActive: repository.findOwnedActive.bind(repository),
        findDriver: repository.findDriver.bind(repository),
        async prepareAction() { throw new Error("must not prepare"); },
      });
      assert.equal(result.kind, "INVALID_AMOUNT");
    }
  });
});

test("shared service atomically creates, moves, updates, and removes linked commissions while preserving date semantics", async () => {
  const creationRepository = new MemoryCommissionAwareRepository(
    reservation({ driverId: null, driver: null, linkedCommission: null }),
  );
  const created = await changeOwnedReservationDriverAndCommission({
    reservationId: "reservation-1",
    ownerEmail: admin.email,
    operation: {
      kind: "ASSIGN_WITH_COMMISSION",
      targetDriverId: ahmed.id,
      commissionAmount: "25",
    },
  }, creationRepository);
  assert.equal(created.commissionMutation, "CREATED");
  assert.equal(created.after.driverId, ahmed.id);
  assert.equal(created.after.linkedCommission?.commissionAmount, "25.00");
  assert.equal(created.after.linkedCommission?.entryDate.toISOString(), "2026-08-14T00:00:00.000Z");

  const moveRepository = new MemoryCommissionAwareRepository();
  const originalDate = moveRepository.row!.linkedCommission!.entryDate.toISOString();
  const moved = await changeOwnedReservationDriverAndCommission({
    reservationId: "reservation-1",
    ownerEmail: admin.email,
    operation: {
      kind: "ASSIGN_WITH_COMMISSION",
      targetDriverId: ahmed.id,
      commissionAmount: "30",
    },
  }, moveRepository);
  assert.equal(moved.commissionMutation, "MOVED");
  assert.equal(moved.after.linkedCommission?.driverId, ahmed.id);
  assert.equal(moved.after.linkedCommission?.commissionAmount, "30.00");
  assert.equal(moved.after.linkedCommission?.entryDate.toISOString(), originalDate);

  const updated = await changeOwnedReservationDriverAndCommission({
    reservationId: "reservation-1",
    ownerEmail: admin.email,
    operation: { kind: "UPDATE_COMMISSION", commissionAmount: "35" },
  }, moveRepository);
  assert.equal(updated.commissionMutation, "UPDATED");
  assert.equal(updated.after.linkedCommission?.commissionAmount, "35.00");
  assert.equal(updated.after.linkedCommission?.entryDate.toISOString(), originalDate);

  const cleared = await changeOwnedReservationDriverAndCommission({
    reservationId: "reservation-1",
    ownerEmail: admin.email,
    operation: { kind: "CLEAR_WITH_COMMISSION" },
  }, moveRepository);
  assert.equal(cleared.commissionMutation, "REMOVED");
  assert.equal(cleared.after.driverId, null);
  assert.equal(cleared.after.linkedCommission, null);
});

test("single atomic repository call rolls back a simulated halfway failure", async () => {
  const repository = new MemoryCommissionAwareRepository();
  const before = cloneReservation(repository.row!);
  repository.failAtomic = true;
  await assert.rejects(
    () => changeOwnedReservationDriverAndCommission({
      reservationId: "reservation-1",
      ownerEmail: admin.email,
      operation: {
        kind: "ASSIGN_WITH_COMMISSION",
        targetDriverId: ahmed.id,
        commissionAmount: "30",
      },
    }, repository),
    /fixture fails after staging/,
  );
  assert.deepEqual(repository.row, before);
  assert.equal(repository.atomicWrites, 0);
});

function preconditionJson(value: ReservationDriverAssignmentSnapshot, target?: AssignmentDriverSnapshot): JsonObject {
  return {
    reservationId: value.id,
    reservationUpdatedAt: value.updatedAt.toISOString(),
    ownerUserId: admin.userId,
    ownerEmail: admin.email,
    isDeleted: false,
    currentDriverId: value.driverId,
    currentDriver: value.driver
      ? { id: value.driver.id, updatedAt: value.driver.updatedAt.toISOString() }
      : null,
    linkedCommission: value.linkedCommission
      ? {
          id: value.linkedCommission.id,
          driverId: value.linkedCommission.driverId,
          reservationId: value.linkedCommission.reservationId,
          commissionAmount: value.linkedCommission.commissionAmount,
          entryDate: value.linkedCommission.entryDate.toISOString(),
          updatedAt: value.linkedCommission.updatedAt.toISOString(),
        }
      : null,
    ...(target
      ? {
          targetDriver: {
            id: target.id,
            status: "ACTIVE",
            updatedAt: target.updatedAt.toISOString(),
          },
        }
      : {}),
  };
}

function storedAction(
  actionType: "ASSIGN_DRIVER" | "CLEAR_DRIVER" | "UPDATE_RESERVATION_COMMISSION",
  value: ReservationDriverAssignmentSnapshot,
): AiPendingActionRecord {
  const target = actionType === "ASSIGN_DRIVER" ? ahmed : undefined;
  const payload: JsonObject = actionType === "ASSIGN_DRIVER"
    ? { reservationId: value.id, targetDriverId: ahmed.id, commissionAmount: "30.00" }
    : actionType === "CLEAR_DRIVER"
      ? { reservationId: value.id, removesCommission: true }
      : { reservationId: value.id, commissionAmount: "35.00" };
  return {
    id: "action-1",
    userId: admin.userId,
    actionType,
    riskLevel: "FINANCIAL_WRITE",
    status: "EXECUTING",
    payload,
    preview: {
      title: "Commission action",
      sections: [{ heading: "Commission", facts: [{ label: "Amount", value: "€30.00" }] }],
    },
    precondition: preconditionJson(value, target),
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

test("commission-aware executors confirm assign/move, amount update, and clear with deterministic result/audit", async () => {
  for (const actionType of [
    "ASSIGN_DRIVER",
    "UPDATE_RESERVATION_COMMISSION",
    "CLEAR_DRIVER",
  ] as const) {
    const initial = reservation();
    const repository = new MemoryCommissionAwareRepository(initial);
    const executor = createCommissionAwareAssignmentExecutor(actionType, () => repository);
    const action = storedAction(actionType, initial);
    assert.deepEqual(
      await executor.checkPreconditions({ transaction: {}, action, actor }),
      { kind: "VALID" },
    );
    const result = await executor.execute({ transaction: {}, action, actor });
    assert.equal(result.kind, "EXECUTED");
    if (result.kind === "EXECUTED") {
      assert.equal(result.audit.metadata?.reservationId, "reservation-1");
      assert.equal("beforeCommissionAmount" in (result.audit.metadata ?? {}), true);
      assert.equal("afterCommissionAmount" in (result.audit.metadata ?? {}), true);
      assert.equal(result.result.reference?.href, "/reservations/reservation-1/edit");
    }
    assert.equal(repository.atomicWrites, 1);
  }
});

test("confirmation conflicts on stale reservation, commission amount/date/existence, target status, ownership, or ADMIN role", async (t) => {
  const fixtures: Array<{
    name: string;
    mutate(repository: MemoryCommissionAwareRepository): AiCanonicalActor;
    code: string;
  }> = [
    {
      name: "reservation updatedAt",
      mutate(repository) { repository.row!.updatedAt = new Date("2026-08-11T09:01:00.000Z"); return actor; },
      code: "ACTION_FINANCIAL_STATE_CHANGED",
    },
    {
      name: "commission amount",
      mutate(repository) { repository.row!.linkedCommission!.commissionAmount = "26.00"; return actor; },
      code: "ACTION_FINANCIAL_STATE_CHANGED",
    },
    {
      name: "commission date",
      mutate(repository) { repository.row!.linkedCommission!.entryDate = new Date("2026-08-15T00:00:00.000Z"); return actor; },
      code: "ACTION_FINANCIAL_STATE_CHANGED",
    },
    {
      name: "commission removed",
      mutate(repository) { repository.row!.linkedCommission = null; return actor; },
      code: "ACTION_FINANCIAL_STATE_CHANGED",
    },
    {
      name: "target inactive",
      mutate(repository) { repository.drivers.get(ahmed.id)!.status = "INACTIVE"; return actor; },
      code: "ACTION_DRIVER_STATE_CHANGED",
    },
    {
      name: "ownership",
      mutate(repository) { repository.row!.userEmail = "other@example.com"; return actor; },
      code: "ACTION_RESERVATION_UNAVAILABLE",
    },
    {
      name: "ADMIN role",
      mutate() { return { ...actor, role: "USER" }; },
      code: "ACTION_AUTHORIZATION_CHANGED",
    },
  ];
  for (const fixture of fixtures) {
    await t.test(fixture.name, async () => {
      const initial = reservation();
      const repository = new MemoryCommissionAwareRepository(initial);
      const canonicalActor = fixture.mutate(repository);
      const executor = createCommissionAwareAssignmentExecutor("ASSIGN_DRIVER", () => repository);
      assert.deepEqual(
        await executor.checkPreconditions({
          transaction: {},
          action: storedAction("ASSIGN_DRIVER", initial),
          actor: canonicalActor,
        }),
        { kind: "CONFLICTED", code: fixture.code },
      );
      assert.equal(repository.atomicWrites, 0);
    });
  }

  await t.test("commission added after a no-commission preview", async () => {
    const initial = reservation({ driverId: null, driver: null, linkedCommission: null });
    const repository = new MemoryCommissionAwareRepository(initial);
    repository.row!.linkedCommission = linkedCommission();
    const executor = createCommissionAwareAssignmentExecutor("ASSIGN_DRIVER", () => repository);
    assert.deepEqual(
      await executor.checkPreconditions({
        transaction: {},
        action: storedAction("ASSIGN_DRIVER", initial),
        actor,
      }),
      { kind: "CONFLICTED", code: "ACTION_FINANCIAL_STATE_CHANGED" },
    );
    assert.equal(repository.atomicWrites, 0);
  });
});

test("executor failure after staged driver change leaves both assignment and commission unchanged", async () => {
  const initial = reservation();
  const repository = new MemoryCommissionAwareRepository(initial);
  repository.failAtomic = true;
  const executor = createCommissionAwareAssignmentExecutor("ASSIGN_DRIVER", () => repository);
  const result = await executor.execute({
    transaction: {},
    action: storedAction("ASSIGN_DRIVER", initial),
    actor,
  });
  assert.deepEqual(result, { kind: "FAILED", code: "ACTION_EXECUTOR_FAILED" });
  assert.deepEqual(repository.row, initial);
});

test("canonical ledger math reflects exactly one linked commission move and removal", async () => {
  const repository = new MemoryCommissionAwareRepository();
  const ledger = (driverId: string) => {
    const amount = repository.row?.linkedCommission?.driverId === driverId
      ? new Prisma.Decimal(repository.row.linkedCommission.commissionAmount)
      : new Prisma.Decimal(0);
    return calculateDriverFinancialSummary(amount, new Prisma.Decimal(0), new Prisma.Decimal(0));
  };
  assert.equal(ledger(bilawal.id).balance.toFixed(2), "25.00");
  assert.equal(ledger(ahmed.id).balance.toFixed(2), "0.00");
  await changeOwnedReservationDriverAndCommission({
    reservationId: "reservation-1",
    ownerEmail: admin.email,
    operation: {
      kind: "ASSIGN_WITH_COMMISSION",
      targetDriverId: ahmed.id,
      commissionAmount: "30",
    },
  }, repository);
  assert.equal(ledger(bilawal.id).balance.toFixed(2), "0.00");
  assert.equal(ledger(ahmed.id).balance.toFixed(2), "30.00");
  await changeOwnedReservationDriverAndCommission({
    reservationId: "reservation-1",
    ownerEmail: admin.email,
    operation: { kind: "CLEAR_WITH_COMMISSION" },
  }, repository);
  assert.equal(ledger(ahmed.id).balance.toFixed(2), "0.00");
});

function modelCall(name: string, args: unknown, id = `call-${name}`) {
  return {
    type: "function_call",
    name,
    call_id: id,
    arguments: JSON.stringify(args),
  };
}

const reservationSearch = {
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

const driverSearch = {
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

async function runToolLoop(dependencies: AssistantToolLoopDependencies) {
  const events: AssistantStreamEvent[] = [];
  await runReservationAssistantToolLoop({
    message: "Commission-aware driver request",
    context: [],
    authContext: admin,
    signal: new AbortController().signal,
    emit: (event) => events.push(event),
  }, dependencies);
  return events;
}

test("tool loop prepares assign, update, and clear commission previews only after exact resolution", async () => {
  const flows = [
    {
      calls: [
        modelCall("search_reservations", reservationSearch),
        modelCall("search_drivers", driverSearch),
        modelCall("prepare_assign_driver_with_commission", {
          reservation_id: "reservation-1",
          driver_id: ahmed.id,
          commission_amount: "25",
        }),
      ],
      dependency: "prepareAssignDriverWithCommission" as const,
      actionType: "ASSIGN_DRIVER" as const,
    },
    {
      calls: [
        modelCall("get_reservation", { reservation_id: "reservation-1" }),
        modelCall("prepare_update_reservation_commission", {
          reservation_id: "reservation-1",
          commission_amount: "40",
        }),
      ],
      dependency: "prepareUpdateReservationCommission" as const,
      actionType: "UPDATE_RESERVATION_COMMISSION" as const,
    },
    {
      calls: [
        modelCall("get_reservation", { reservation_id: "reservation-1" }),
        modelCall("prepare_clear_driver_and_commission", {
          reservation_id: "reservation-1",
        }),
      ],
      dependency: "prepareClearDriverAndCommission" as const,
      actionType: "CLEAR_DRIVER" as const,
    },
  ];

  for (const flow of flows) {
    let prepares = 0;
    const rounds = [
      ...flow.calls.map((call) => ({ output: [call] })),
      { output: [{ type: "message" }] },
    ];
    const dependency = async () => {
      prepares += 1;
      return {
        kind: "ACTION_PREVIEW" as const,
        action: publicAction(flow.actionType, {
          title: "Financial preview",
          sections: [{ heading: "Commission", facts: [{ label: "Amount", value: "€25.00" }] }],
        }),
      };
    };
    const events = await runToolLoop(toolLoopDependencies(rounds, {
      [flow.dependency]: dependency,
    }));
    assert.equal(prepares, 1);
    assert.equal(events.filter((event) => event.type === "assistant.action_preview").length, 1);
  }
});

test("ambiguous results cannot prepare and direct financial execution tools remain unknown", async () => {
  let prepares = 0;
  await runToolLoop(toolLoopDependencies([
    { output: [modelCall("search_reservations", reservationSearch)] },
    { output: [modelCall("search_drivers", driverSearch)] },
    { output: [modelCall("prepare_assign_driver_with_commission", {
      reservation_id: "reservation-1",
      driver_id: "driver-a",
      commission_amount: "25",
    })] },
    { output: [{ type: "message" }] },
  ], {
    searchDrivers: async () => ({
      drivers: [ahmed, bilawal].map((item) => ({
        id: item.id,
        name: item.name,
        status: item.status,
        vehicleType: item.vehicleType,
        href: `/drivers/${item.id}`,
        balance: "0.00",
        balancePosition: "SETTLED" as const,
        currency: "EUR" as const,
      })),
      count: 2,
      hasMore: false,
      nextCursor: null,
    }),
    async prepareAssignDriverWithCommission() {
      prepares += 1;
      throw new Error("must not prepare");
    },
  }));
  assert.equal(prepares, 0);

  for (const toolName of [
    "execute_assignment_with_commission",
    "execute_commission",
    "confirm_action",
    "edit_finance",
  ]) {
    await assert.rejects(
      () => runToolLoop(toolLoopDependencies([{ output: [modelCall(toolName, {})] }])),
      (error: unknown) =>
        error instanceof AssistantTransportError && error.code === "UNKNOWN_TOOL",
    );
  }
});

test("source proves one nested atomic write, shared UI reuse, no extra finance executors, and mobile financial hierarchy", () => {
  const prismaAdapter = readFileSync(
    new URL("../src/lib/reservations/commission-aware-assignment-prisma.ts", import.meta.url),
    "utf8",
  );
  const route = readFileSync(
    new URL("../src/app/api/reservations/[id]/route.ts", import.meta.url),
    "utf8",
  );
  const registry = readFileSync(
    new URL("../src/lib/assistant/actions/executors.ts", import.meta.url),
    "utf8",
  );
  const card = readFileSync(
    new URL("../src/components/assistant/AssistantActionPreviewCard.tsx", import.meta.url),
    "utf8",
  );
  assert.match(prismaAdapter, /database\.reservation\.update/);
  assert.match(prismaAdapter, /commissionEntries/);
  assert.match(prismaAdapter, /driver: \{ connect/);
  assert.match(prismaAdapter, /commissionAmount/);
  assert.match(route, /changeOwnedReservationDriverAndCommission/);
  assert.doesNotMatch(route, /commissionEntry\.(upsert|delete)/);
  assert.match(registry, /UPDATE_RESERVATION_COMMISSION: updateReservationCommissionExecutor/);
  for (const forbidden of ["ADD_MANUAL_COMMISSION:", "RECORD_DRIVER_PAYMENT:"]) {
    assert.equal(registry.includes(forbidden), false);
  }
  assert.match(card, /FINANCIAL_WRITE/);
  assert.match(card, /Financial write/);
  assert.match(card, /emphasis === "money"/);
  assert.match(card, /min-h-11/);
  assert.match(card, /overflow-hidden/);
  assert.doesNotMatch(card, /onKeyDown|onKeyPress/);
});

test("shared financial service rejects non-canonical invalid input even outside model preparation", async () => {
  const repository = new MemoryCommissionAwareRepository();
  await assert.rejects(
    () => changeOwnedReservationDriverAndCommission({
      reservationId: "reservation-1",
      ownerEmail: admin.email,
      operation: { kind: "UPDATE_COMMISSION", commissionAmount: "1.234" },
    }, repository),
    CommissionAwareAssignmentInputError,
  );
  assert.equal(repository.atomicWrites, 0);
});
