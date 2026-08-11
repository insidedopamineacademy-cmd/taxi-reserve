import type {
  PrepareAssignDriverArguments,
  PrepareClearDriverArguments,
} from "../assistant/tools/driver-assignment-contracts.ts";
import type {
  AiActionPreview,
  AiActionPublic,
  JsonObject,
} from "../assistant/actions/contracts.ts";
import { formatMadridDate, formatMadridTime } from "../time/madrid.ts";
import type { ReservationAccessContext } from "./assistant-read-core.ts";
import type {
  AssignmentDriverSnapshot,
  ReservationDriverAssignmentSnapshot,
} from "./driver-assignment-core.ts";

export const DRIVER_ASSIGNMENT_COMMISSION_BLOCK_MESSAGE =
  "This reservation has a linked commission. Driver changes for this reservation require the commission-aware workflow.";

export type PrepareDriverAssignmentResult =
  | { kind: "ACTION_PREVIEW"; action: AiActionPublic }
  | { kind: "NO_CHANGES"; message: string }
  | { kind: "NOT_FOUND"; message: string }
  | { kind: "FORBIDDEN"; message: string }
  | { kind: "INACTIVE_DRIVER"; message: string }
  | { kind: "COMMISSION_BLOCKED"; message: string }
  | { kind: "UNAVAILABLE"; message: string };

export type DriverAssignmentProposalDependencies = {
  findOwnedActive(input: {
    reservationId: string;
    ownerEmail: string;
  }): Promise<ReservationDriverAssignmentSnapshot | null>;
  findDriver(driverId: string): Promise<AssignmentDriverSnapshot | null>;
  prepareAction(input: {
    session: { userId: string; email: string };
    actionType: "ASSIGN_DRIVER" | "CLEAR_DRIVER";
    payload: JsonObject;
    precondition: JsonObject;
    preview: AiActionPreview;
    confirmationLabel: string;
  }): Promise<{ ok: boolean; code?: string; action?: AiActionPublic }>;
};

function routeText(reservation: ReservationDriverAssignmentSnapshot) {
  return `${reservation.pickupText || "Not provided"} → ${reservation.dropoffText || "Not provided"}`;
}

function reservationFacts(reservation: ReservationDriverAssignmentSnapshot) {
  return [
    {
      label: "Date and time",
      value: `${formatMadridDate(reservation.startAt)} · ${formatMadridTime(reservation.startAt)}`,
    },
    { label: "Route", value: routeText(reservation).slice(0, 500) },
  ];
}

function currentDriverName(reservation: ReservationDriverAssignmentSnapshot) {
  return reservation.driver?.name || "Unassigned";
}

function targetDriverDescription(driver: AssignmentDriverSnapshot) {
  return driver.vehicleType ? `ACTIVE · ${driver.vehicleType}` : "ACTIVE";
}

function assignmentPreview(
  reservation: ReservationDriverAssignmentSnapshot,
  target: AssignmentDriverSnapshot,
): AiActionPreview {
  return {
    title: "Assign driver",
    summary: "Review this driver assignment before it is applied.",
    sections: [
      { heading: "Reservation", facts: reservationFacts(reservation) },
      {
        heading: "Current driver",
        facts: [{ label: "Driver", value: currentDriverName(reservation) }],
      },
      {
        heading: "New driver",
        facts: [
          { label: "Driver", value: target.name },
          { label: "Status and vehicle", value: targetDriverDescription(target) },
        ],
      },
    ],
  };
}

function clearPreview(
  reservation: ReservationDriverAssignmentSnapshot,
): AiActionPreview {
  return {
    title: "Remove driver",
    summary: "Review this driver removal before it is applied.",
    sections: [
      { heading: "Reservation", facts: reservationFacts(reservation) },
      {
        heading: "Current driver",
        facts: [{ label: "Driver", value: currentDriverName(reservation) }],
      },
      { heading: "After", facts: [{ label: "Driver", value: "Unassigned" }] },
    ],
  };
}

function basePrecondition(
  context: ReservationAccessContext,
  reservation: ReservationDriverAssignmentSnapshot,
): JsonObject {
  return {
    reservationId: reservation.id,
    reservationUpdatedAt: reservation.updatedAt.toISOString(),
    ownerUserId: context.userId,
    ownerEmail: reservation.userEmail.trim().toLowerCase(),
    isDeleted: false,
    currentDriverId: reservation.driverId,
    currentDriver: reservation.driver
      ? {
          id: reservation.driver.id,
          updatedAt: reservation.driver.updatedAt.toISOString(),
        }
      : null,
    linkedCommission: null,
  };
}

function forbidden(): PrepareDriverAssignmentResult {
  return {
    kind: "FORBIDDEN",
    message: "Driver assignment changes are restricted to administrators.",
  };
}

export async function prepareAssignDriverProposal(
  context: ReservationAccessContext,
  input: PrepareAssignDriverArguments,
  dependencies: DriverAssignmentProposalDependencies,
): Promise<PrepareDriverAssignmentResult> {
  if (context.role !== "ADMIN") return forbidden();

  const reservation = await dependencies.findOwnedActive({
    reservationId: input.reservation_id,
    ownerEmail: context.email.trim().toLowerCase(),
  });
  if (!reservation) {
    return { kind: "NOT_FOUND", message: "That reservation is unavailable for this account." };
  }

  const target = await dependencies.findDriver(input.driver_id);
  if (!target) {
    return { kind: "NOT_FOUND", message: "That driver is unavailable." };
  }
  if (reservation.driverId === target.id) {
    return {
      kind: "NO_CHANGES",
      message: `${target.name} is already assigned to this reservation.`,
    };
  }
  if (target.status !== "ACTIVE") {
    return {
      kind: "INACTIVE_DRIVER",
      message: `${target.name} is inactive and cannot receive a new reservation assignment.`,
    };
  }
  if (reservation.linkedCommission) {
    return {
      kind: "COMMISSION_BLOCKED",
      message: DRIVER_ASSIGNMENT_COMMISSION_BLOCK_MESSAGE,
    };
  }

  const prepared = await dependencies.prepareAction({
    session: { userId: context.userId, email: context.email },
    actionType: "ASSIGN_DRIVER",
    payload: {
      reservationId: reservation.id,
      targetDriverId: target.id,
    },
    precondition: {
      ...basePrecondition(context, reservation),
      targetDriver: {
        id: target.id,
        status: "ACTIVE",
        updatedAt: target.updatedAt.toISOString(),
      },
    },
    preview: assignmentPreview(reservation, target),
    confirmationLabel: "Confirm assignment",
  });

  if (prepared.ok && prepared.action) {
    return { kind: "ACTION_PREVIEW", action: prepared.action };
  }
  if (prepared.code === "ACTION_FORBIDDEN") return forbidden();
  return { kind: "UNAVAILABLE", message: "The driver assignment could not be prepared." };
}

export async function prepareClearDriverProposal(
  context: ReservationAccessContext,
  input: PrepareClearDriverArguments,
  dependencies: DriverAssignmentProposalDependencies,
): Promise<PrepareDriverAssignmentResult> {
  if (context.role !== "ADMIN") return forbidden();

  const reservation = await dependencies.findOwnedActive({
    reservationId: input.reservation_id,
    ownerEmail: context.email.trim().toLowerCase(),
  });
  if (!reservation) {
    return { kind: "NOT_FOUND", message: "That reservation is unavailable for this account." };
  }
  if (reservation.driverId === null) {
    return { kind: "NO_CHANGES", message: "This reservation is already unassigned." };
  }
  if (reservation.linkedCommission) {
    return {
      kind: "COMMISSION_BLOCKED",
      message: DRIVER_ASSIGNMENT_COMMISSION_BLOCK_MESSAGE,
    };
  }

  const prepared = await dependencies.prepareAction({
    session: { userId: context.userId, email: context.email },
    actionType: "CLEAR_DRIVER",
    payload: { reservationId: reservation.id },
    precondition: basePrecondition(context, reservation),
    preview: clearPreview(reservation),
    confirmationLabel: "Confirm removal",
  });

  if (prepared.ok && prepared.action) {
    return { kind: "ACTION_PREVIEW", action: prepared.action };
  }
  if (prepared.code === "ACTION_FORBIDDEN") return forbidden();
  return { kind: "UNAVAILABLE", message: "The driver removal could not be prepared." };
}
