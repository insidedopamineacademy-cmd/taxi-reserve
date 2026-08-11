export type AssignmentDriverStatus = "ACTIVE" | "INACTIVE";
export type AssignmentDriverVehicleType = "VAN" | "SEDAN" | null;

export type AssignmentDriverSnapshot = {
  id: string;
  name: string;
  status: AssignmentDriverStatus;
  vehicleType: AssignmentDriverVehicleType;
  updatedAt: Date;
};

export type LinkedCommissionSnapshot = {
  id: string;
  driverId: string;
  reservationId: string;
  commissionAmount: string;
  entryDate: Date;
  updatedAt: Date;
};

export type ReservationDriverAssignmentSnapshot = {
  id: string;
  userEmail: string;
  isDeleted: boolean;
  updatedAt: Date;
  startAt: Date;
  pickupText: string | null;
  dropoffText: string | null;
  driverId: string | null;
  driver: AssignmentDriverSnapshot | null;
  linkedCommission: LinkedCommissionSnapshot | null;
};

export type DriverAssignmentExpectedState = {
  reservationUpdatedAt: Date;
  currentDriverId: string | null;
  currentDriver: { id: string; updatedAt: Date } | null;
  linkedCommission: LinkedCommissionSnapshot | null;
  targetDriver?: {
    id: string;
    status: "ACTIVE";
    updatedAt: Date;
  };
};

export type DriverAssignmentRepository = {
  findOwnedActive(input: {
    reservationId: string;
    ownerEmail: string;
  }): Promise<ReservationDriverAssignmentSnapshot | null>;
  findById(reservationId: string): Promise<ReservationDriverAssignmentSnapshot | null>;
  findDriver(driverId: string): Promise<AssignmentDriverSnapshot | null>;
  updateOwnedActiveDriver(input: {
    reservationId: string;
    ownerEmail: string;
    expectedUpdatedAt: Date;
    expectedDriverId: string | null;
    nextDriverId: string | null;
    requireNoLinkedCommission: boolean;
  }): Promise<boolean>;
};

export class DriverAssignmentInputError extends Error {
  constructor(message = "Invalid driver assignment input.") {
    super(message);
    this.name = "DriverAssignmentInputError";
  }
}

export class DriverAssignmentReservationNotFoundError extends Error {
  constructor() {
    super("Reservation not found.");
    this.name = "DriverAssignmentReservationNotFoundError";
  }
}

export class DriverAssignmentTargetNotFoundError extends Error {
  constructor() {
    super("Driver not found.");
    this.name = "DriverAssignmentTargetNotFoundError";
  }
}

export class DriverAssignmentInactiveError extends Error {
  constructor() {
    super("Inactive drivers cannot receive new reservation assignments.");
    this.name = "DriverAssignmentInactiveError";
  }
}

export class DriverAssignmentCommissionConflictError extends Error {
  constructor() {
    super(
      "This reservation has a linked commission. Driver changes for this reservation require the commission-aware workflow.",
    );
    this.name = "DriverAssignmentCommissionConflictError";
  }
}

export class DriverAssignmentConflictError extends Error {
  constructor() {
    super("The reservation or driver assignment changed. Review it and try again.");
    this.name = "DriverAssignmentConflictError";
  }
}

function normalizedId(value: string, label: string) {
  if (typeof value !== "string") throw new DriverAssignmentInputError();
  const normalized = value.trim();
  if (!normalized || normalized.length > 100) {
    throw new DriverAssignmentInputError(`${label} is invalid.`);
  }
  return normalized;
}

function sameInstant(left: Date, right: Date) {
  return left.getTime() === right.getTime();
}

function sameDriverState(
  current: AssignmentDriverSnapshot | null,
  expected: DriverAssignmentExpectedState["currentDriver"],
) {
  if (current === null || expected === null) return current === expected;
  return current.id === expected.id && sameInstant(current.updatedAt, expected.updatedAt);
}

export function sameLinkedCommissionState(
  current: LinkedCommissionSnapshot | null,
  expected: LinkedCommissionSnapshot | null,
) {
  if (current === null || expected === null) return current === expected;
  return current.id === expected.id &&
    current.driverId === expected.driverId &&
    current.reservationId === expected.reservationId &&
    current.commissionAmount === expected.commissionAmount &&
    sameInstant(current.entryDate, expected.entryDate) &&
    sameInstant(current.updatedAt, expected.updatedAt);
}

export function matchesDriverAssignmentPrecondition(
  current: ReservationDriverAssignmentSnapshot,
  expected: DriverAssignmentExpectedState,
) {
  return sameInstant(current.updatedAt, expected.reservationUpdatedAt) &&
    current.driverId === expected.currentDriverId &&
    sameDriverState(current.driver, expected.currentDriver) &&
    sameLinkedCommissionState(current.linkedCommission, expected.linkedCommission);
}

export async function changeOwnedReservationDriver(
  input: {
    reservationId: string;
    ownerEmail: string;
    nextDriverId: string | null;
    commissionPolicy: "BLOCK_LINKED" | "MANAGED_BY_CALLER";
    expected?: DriverAssignmentExpectedState;
  },
  repository: DriverAssignmentRepository,
) {
  const reservationId = normalizedId(input.reservationId, "Reservation ID");
  const ownerEmail = input.ownerEmail.trim().toLowerCase();
  if (!ownerEmail || ownerEmail.length > 320) {
    throw new DriverAssignmentInputError("Owner email is invalid.");
  }
  const nextDriverId = input.nextDriverId === null
    ? null
    : normalizedId(input.nextDriverId, "Driver ID");
  const current = await repository.findOwnedActive({ reservationId, ownerEmail });
  if (!current) throw new DriverAssignmentReservationNotFoundError();
  if (input.expected && !matchesDriverAssignmentPrecondition(current, input.expected)) {
    throw new DriverAssignmentConflictError();
  }

  if (current.driverId === nextDriverId) {
    return {
      changed: false as const,
      reservation: current,
      previousDriver: current.driver,
      nextDriver: current.driver,
    };
  }
  if (input.commissionPolicy === "BLOCK_LINKED" && current.linkedCommission) {
    throw new DriverAssignmentCommissionConflictError();
  }

  let target: AssignmentDriverSnapshot | null = null;
  if (nextDriverId) {
    target = await repository.findDriver(nextDriverId);
    if (!target) throw new DriverAssignmentTargetNotFoundError();
    if (target.status !== "ACTIVE") throw new DriverAssignmentInactiveError();
    if (
      input.expected?.targetDriver &&
      (target.id !== input.expected.targetDriver.id ||
        target.status !== input.expected.targetDriver.status ||
        !sameInstant(target.updatedAt, input.expected.targetDriver.updatedAt))
    ) {
      throw new DriverAssignmentConflictError();
    }
  } else if (input.expected?.targetDriver) {
    throw new DriverAssignmentConflictError();
  }

  const updated = await repository.updateOwnedActiveDriver({
    reservationId,
    ownerEmail,
    expectedUpdatedAt: input.expected?.reservationUpdatedAt ?? current.updatedAt,
    expectedDriverId: current.driverId,
    nextDriverId,
    requireNoLinkedCommission: input.commissionPolicy === "BLOCK_LINKED",
  });
  if (!updated) throw new DriverAssignmentConflictError();

  const result = await repository.findOwnedActive({ reservationId, ownerEmail });
  if (!result) throw new DriverAssignmentReservationNotFoundError();
  if (
    result.driverId !== nextDriverId ||
    (input.commissionPolicy === "BLOCK_LINKED" && result.linkedCommission) ||
    (nextDriverId &&
      (!result.driver ||
        result.driver.status !== "ACTIVE" ||
        (input.expected?.targetDriver &&
          !sameInstant(result.driver.updatedAt, input.expected.targetDriver.updatedAt))))
  ) {
    throw new DriverAssignmentConflictError();
  }

  return {
    changed: true as const,
    reservation: result,
    previousDriver: current.driver,
    nextDriver: result.driver,
  };
}
