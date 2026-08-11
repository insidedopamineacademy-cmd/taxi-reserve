import {
  financialDateFromMadridInstant,
  parsePositiveMoney,
} from "../drivers/financialValidation.ts";
import {
  type AssignmentDriverSnapshot,
  type DriverAssignmentExpectedState,
  type ReservationDriverAssignmentSnapshot,
  matchesDriverAssignmentPrecondition,
} from "./driver-assignment-core.ts";

export type CommissionAwareAssignmentOperation =
  | {
      kind: "ASSIGN_WITH_COMMISSION";
      targetDriverId: string;
      commissionAmount: unknown;
    }
  | { kind: "UPDATE_COMMISSION"; commissionAmount: unknown }
  | { kind: "CLEAR_WITH_COMMISSION" }
  | { kind: "ASSIGN_WITHOUT_COMMISSION"; targetDriverId: string }
  | { kind: "ASSIGN_AND_REMOVE_COMMISSION"; targetDriverId: string }
  | { kind: "CLEAR_WITHOUT_COMMISSION" };

export type NormalizedCommissionAwareAssignmentOperation =
  | {
      kind: "ASSIGN_WITH_COMMISSION";
      targetDriverId: string;
      targetDriverUpdatedAt: Date;
      commissionAmount: string;
      createEntryDate: Date;
    }
  | { kind: "UPDATE_COMMISSION"; commissionAmount: string }
  | { kind: "CLEAR_WITH_COMMISSION" }
  | {
      kind: "ASSIGN_WITHOUT_COMMISSION";
      targetDriverId: string;
      targetDriverUpdatedAt: Date;
    }
  | {
      kind: "ASSIGN_AND_REMOVE_COMMISSION";
      targetDriverId: string;
      targetDriverUpdatedAt: Date;
    }
  | { kind: "CLEAR_WITHOUT_COMMISSION" };

export type CommissionAwareAssignmentRepository = {
  findOwnedActive(input: {
    reservationId: string;
    ownerEmail: string;
  }): Promise<ReservationDriverAssignmentSnapshot | null>;
  findById(reservationId: string): Promise<ReservationDriverAssignmentSnapshot | null>;
  findDriver(driverId: string): Promise<AssignmentDriverSnapshot | null>;
  applyAtomic(input: {
    reservationId: string;
    ownerEmail: string;
    expected: ReservationDriverAssignmentSnapshot;
    operation: NormalizedCommissionAwareAssignmentOperation;
  }): Promise<ReservationDriverAssignmentSnapshot | null>;
};

export type CommissionAwareMutationKind =
  | "NONE"
  | "CREATED"
  | "MOVED"
  | "UPDATED"
  | "REMOVED";

export class CommissionAwareAssignmentInputError extends Error {
  constructor(message = "Invalid commission-aware assignment input.") {
    super(message);
    this.name = "CommissionAwareAssignmentInputError";
  }
}

export class CommissionAwareReservationNotFoundError extends Error {
  constructor() {
    super("Reservation not found.");
    this.name = "CommissionAwareReservationNotFoundError";
  }
}

export class CommissionAwareDriverNotFoundError extends Error {
  constructor() {
    super("Driver not found.");
    this.name = "CommissionAwareDriverNotFoundError";
  }
}

export class CommissionAwareDriverInactiveError extends Error {
  constructor() {
    super("Inactive drivers cannot receive new reservation assignments.");
    this.name = "CommissionAwareDriverInactiveError";
  }
}

export class CommissionAwareCommissionRequiredError extends Error {
  constructor() {
    super("This reservation does not have a linked commission.");
    this.name = "CommissionAwareCommissionRequiredError";
  }
}

export class CommissionAwareUnexpectedCommissionError extends Error {
  constructor() {
    super("This reservation has a linked commission and requires a commission-aware operation.");
    this.name = "CommissionAwareUnexpectedCommissionError";
  }
}

export class CommissionAwareInconsistentStateError extends Error {
  constructor() {
    super("The linked commission does not match the reservation's current driver.");
    this.name = "CommissionAwareInconsistentStateError";
  }
}

export class CommissionAwareConflictError extends Error {
  constructor() {
    super("The reservation, driver, or linked commission changed. Review it and try again.");
    this.name = "CommissionAwareConflictError";
  }
}

function normalizedId(value: string, label: string) {
  if (typeof value !== "string") throw new CommissionAwareAssignmentInputError();
  const normalized = value.trim();
  if (!normalized || normalized.length > 100) {
    throw new CommissionAwareAssignmentInputError(`${label} is invalid.`);
  }
  return normalized;
}

export function normalizeCommissionAmount(value: unknown) {
  const parsed = parsePositiveMoney(value, "Commission");
  if (!parsed.ok) throw new CommissionAwareAssignmentInputError(parsed.error);
  return parsed.value.toFixed(2);
}

function sameInstant(left: Date, right: Date) {
  return left.getTime() === right.getTime();
}

function mutationKind(
  before: ReservationDriverAssignmentSnapshot,
  after: ReservationDriverAssignmentSnapshot,
): CommissionAwareMutationKind {
  const previous = before.linkedCommission;
  const next = after.linkedCommission;
  if (!previous && !next) return "NONE";
  if (!previous && next) return "CREATED";
  if (previous && !next) return "REMOVED";
  if (previous && next && previous.driverId !== next.driverId) return "MOVED";
  if (previous && next && previous.commissionAmount !== next.commissionAmount) {
    return "UPDATED";
  }
  return "NONE";
}

function targetId(operation: CommissionAwareAssignmentOperation) {
  return "targetDriverId" in operation
    ? normalizedId(operation.targetDriverId, "Driver ID")
    : null;
}

export async function changeOwnedReservationDriverAndCommission(
  input: {
    reservationId: string;
    ownerEmail: string;
    operation: CommissionAwareAssignmentOperation;
    expected?: DriverAssignmentExpectedState;
  },
  repository: CommissionAwareAssignmentRepository,
) {
  const reservationId = normalizedId(input.reservationId, "Reservation ID");
  const ownerEmail = input.ownerEmail.trim().toLowerCase();
  if (!ownerEmail || ownerEmail.length > 320) {
    throw new CommissionAwareAssignmentInputError("Owner email is invalid.");
  }

  const current = await repository.findOwnedActive({ reservationId, ownerEmail });
  if (!current) throw new CommissionAwareReservationNotFoundError();
  if (input.expected && !matchesDriverAssignmentPrecondition(current, input.expected)) {
    throw new CommissionAwareConflictError();
  }

  const nextDriverId = targetId(input.operation);
  let target: AssignmentDriverSnapshot | null = null;
  if (nextDriverId) {
    target = await repository.findDriver(nextDriverId);
    if (!target) throw new CommissionAwareDriverNotFoundError();
    if (target.status !== "ACTIVE") throw new CommissionAwareDriverInactiveError();
    if (
      input.expected?.targetDriver &&
      (input.expected.targetDriver.id !== target.id ||
        input.expected.targetDriver.status !== target.status ||
        !sameInstant(input.expected.targetDriver.updatedAt, target.updatedAt))
    ) {
      throw new CommissionAwareConflictError();
    }
  } else if (input.expected?.targetDriver) {
    throw new CommissionAwareConflictError();
  }

  let normalizedOperation: NormalizedCommissionAwareAssignmentOperation;
  if (input.operation.kind === "ASSIGN_WITH_COMMISSION") {
    const commissionAmount = normalizeCommissionAmount(input.operation.commissionAmount);
    if (
      current.driverId === nextDriverId &&
      current.linkedCommission?.driverId === nextDriverId &&
      current.linkedCommission.commissionAmount === commissionAmount
    ) {
      return {
        changed: false as const,
        before: current,
        after: current,
        commissionMutation: "NONE" as const,
      };
    }
    normalizedOperation = {
      kind: "ASSIGN_WITH_COMMISSION",
      targetDriverId: target!.id,
      targetDriverUpdatedAt: target!.updatedAt,
      commissionAmount,
      createEntryDate: financialDateFromMadridInstant(current.startAt),
    };
  } else if (input.operation.kind === "UPDATE_COMMISSION") {
    if (!current.driverId || !current.driver) {
      throw new CommissionAwareAssignmentInputError(
        "Assign a driver before updating a linked commission.",
      );
    }
    if (!current.linkedCommission) throw new CommissionAwareCommissionRequiredError();
    if (current.linkedCommission.driverId !== current.driverId) {
      throw new CommissionAwareInconsistentStateError();
    }
    const commissionAmount = normalizeCommissionAmount(input.operation.commissionAmount);
    if (current.linkedCommission.commissionAmount === commissionAmount) {
      return {
        changed: false as const,
        before: current,
        after: current,
        commissionMutation: "NONE" as const,
      };
    }
    normalizedOperation = { kind: "UPDATE_COMMISSION", commissionAmount };
  } else if (input.operation.kind === "CLEAR_WITH_COMMISSION") {
    if (!current.driverId || !current.driver) {
      throw new CommissionAwareAssignmentInputError("This reservation is already unassigned.");
    }
    if (!current.linkedCommission) throw new CommissionAwareCommissionRequiredError();
    normalizedOperation = { kind: "CLEAR_WITH_COMMISSION" };
  } else if (input.operation.kind === "ASSIGN_WITHOUT_COMMISSION") {
    if (current.linkedCommission) throw new CommissionAwareUnexpectedCommissionError();
    if (current.driverId === nextDriverId) {
      return {
        changed: false as const,
        before: current,
        after: current,
        commissionMutation: "NONE" as const,
      };
    }
    normalizedOperation = {
      kind: "ASSIGN_WITHOUT_COMMISSION",
      targetDriverId: target!.id,
      targetDriverUpdatedAt: target!.updatedAt,
    };
  } else if (input.operation.kind === "ASSIGN_AND_REMOVE_COMMISSION") {
    if (!current.linkedCommission) throw new CommissionAwareCommissionRequiredError();
    normalizedOperation = {
      kind: "ASSIGN_AND_REMOVE_COMMISSION",
      targetDriverId: target!.id,
      targetDriverUpdatedAt: target!.updatedAt,
    };
  } else {
    if (!current.driverId || !current.driver) {
      return {
        changed: false as const,
        before: current,
        after: current,
        commissionMutation: "NONE" as const,
      };
    }
    if (current.linkedCommission) throw new CommissionAwareUnexpectedCommissionError();
    normalizedOperation = { kind: "CLEAR_WITHOUT_COMMISSION" };
  }

  const after = await repository.applyAtomic({
    reservationId,
    ownerEmail,
    expected: current,
    operation: normalizedOperation,
  });
  if (!after) throw new CommissionAwareConflictError();

  return {
    changed: true as const,
    before: current,
    after,
    commissionMutation: mutationKind(current, after),
  };
}
