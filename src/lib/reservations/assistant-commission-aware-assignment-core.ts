import type {
  PrepareAssignDriverWithCommissionArguments,
  PrepareClearDriverAndCommissionArguments,
  PrepareUpdateReservationCommissionArguments,
} from "../assistant/tools/commission-aware-assignment-contracts.ts";
import type {
  AiActionPreview,
  AiActionPublic,
  JsonObject,
} from "../assistant/actions/contracts.ts";
import {
  financialDateFromMadridInstant,
  formatFinancialDateDisplay,
} from "../drivers/financialValidation.ts";
import { formatMadridDate, formatMadridTime } from "../time/madrid.ts";
import type { ReservationAccessContext } from "./assistant-read-core.ts";
import {
  CommissionAwareAssignmentInputError,
  normalizeCommissionAmount,
  type CommissionAwareAssignmentRepository,
} from "./commission-aware-assignment-core.ts";
import type {
  AssignmentDriverSnapshot,
  LinkedCommissionSnapshot,
  ReservationDriverAssignmentSnapshot,
} from "./driver-assignment-core.ts";

export type PrepareCommissionAwareAssignmentResult =
  | { kind: "ACTION_PREVIEW"; action: AiActionPublic }
  | { kind: "NO_CHANGES"; message: string }
  | { kind: "NOT_FOUND"; message: string }
  | { kind: "FORBIDDEN"; message: string }
  | { kind: "INACTIVE_DRIVER"; message: string }
  | { kind: "COMMISSION_REQUIRED"; message: string }
  | { kind: "INVALID_AMOUNT"; message: string }
  | { kind: "INCONSISTENT_STATE"; message: string }
  | { kind: "UNAVAILABLE"; message: string };

export type CommissionAwareProposalDependencies = Pick<
  CommissionAwareAssignmentRepository,
  "findOwnedActive" | "findDriver"
> & {
  prepareAction(input: {
    session: { userId: string; email: string };
    actionType: "ASSIGN_DRIVER" | "CLEAR_DRIVER" | "UPDATE_RESERVATION_COMMISSION";
    payload: JsonObject;
    precondition: JsonObject;
    preview: AiActionPreview;
    confirmationLabel: string;
  }): Promise<{ ok: boolean; code?: string; action?: AiActionPublic }>;
};

function forbidden(): PrepareCommissionAwareAssignmentResult {
  return {
    kind: "FORBIDDEN",
    message: "Driver and linked-commission changes are restricted to administrators.",
  };
}

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

function driverName(reservation: ReservationDriverAssignmentSnapshot) {
  return reservation.driver?.name || "Unassigned";
}

function euro(amount: string) {
  return `€${amount}`;
}

function commissionDate(
  reservation: ReservationDriverAssignmentSnapshot,
  commission: LinkedCommissionSnapshot | null,
) {
  return formatFinancialDateDisplay(
    commission?.entryDate ?? financialDateFromMadridInstant(reservation.startAt),
  );
}

function linkedCommissionPrecondition(commission: LinkedCommissionSnapshot | null) {
  return commission
    ? {
        id: commission.id,
        driverId: commission.driverId,
        reservationId: commission.reservationId,
        commissionAmount: commission.commissionAmount,
        entryDate: commission.entryDate.toISOString(),
        updatedAt: commission.updatedAt.toISOString(),
      }
    : null;
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
    linkedCommission: linkedCommissionPrecondition(reservation.linkedCommission),
  };
}

function assignPreview(
  reservation: ReservationDriverAssignmentSnapshot,
  target: AssignmentDriverSnapshot,
  amount: string,
): AiActionPreview {
  const linked = reservation.linkedCommission;
  const replacing = reservation.driverId !== null && reservation.driverId !== target.id;
  const moving = Boolean(linked && linked.driverId !== target.id);
  return {
    title: replacing ? "Change driver and commission" : "Assign driver and commission",
    summary: "Review the exact driver and financial effect before confirmation.",
    sections: [
      { heading: "Reservation", facts: reservationFacts(reservation) },
      {
        heading: "Driver change",
        facts: [
          { label: "Current driver", value: driverName(reservation) },
          { label: "New driver", value: target.name },
        ],
      },
      {
        heading: "Commission amount and date",
        facts: [
          ...(linked
            ? [{
                label: "Current commission amount",
                value: euro(linked.commissionAmount),
                emphasis: "money" as const,
              }]
            : []),
          {
            label: linked ? "New commission amount" : "Commission amount",
            value: euro(amount),
            emphasis: "money",
          },
          {
            label: "Commission date",
            value: commissionDate(reservation, linked),
          },
        ],
      },
      {
        heading: "Effect",
        facts: [{
          label: "Financial effect",
          value: moving
            ? `The linked commission will move to ${target.name}.`
            : linked
              ? "The linked commission amount will be updated."
              : `A linked commission will be created for ${target.name}.`,
          emphasis: "warning",
        }],
      },
    ],
  };
}

function updatePreview(
  reservation: ReservationDriverAssignmentSnapshot,
  amount: string,
): AiActionPreview {
  const linked = reservation.linkedCommission!;
  return {
    title: "Update reservation commission",
    summary: "Review the exact financial change before confirmation.",
    sections: [
      { heading: "Reservation", facts: reservationFacts(reservation) },
      {
        heading: "Driver",
        facts: [{ label: "Current driver", value: driverName(reservation) }],
      },
      {
        heading: "Commission amount and date",
        facts: [
          {
            label: "Current commission amount",
            value: euro(linked.commissionAmount),
            emphasis: "money",
          },
          { label: "New commission amount", value: euro(amount), emphasis: "money" },
          { label: "Commission date", value: commissionDate(reservation, linked) },
        ],
      },
    ],
  };
}

function clearPreview(reservation: ReservationDriverAssignmentSnapshot): AiActionPreview {
  const linked = reservation.linkedCommission!;
  return {
    title: "Remove driver and commission",
    summary: "Both records will change atomically after confirmation.",
    sections: [
      { heading: "Reservation", facts: reservationFacts(reservation) },
      {
        heading: "Driver",
        facts: [
          { label: "Current driver", value: driverName(reservation) },
          { label: "After confirmation", value: "Unassigned", emphasis: "warning" },
        ],
      },
      {
        heading: "Commission amount and date",
        facts: [
          {
            label: "Linked commission amount",
            value: euro(linked.commissionAmount),
            emphasis: "money",
          },
          { label: "Commission date", value: commissionDate(reservation, linked) },
          { label: "After confirmation", value: "Removed", emphasis: "warning" },
        ],
      },
    ],
  };
}

function normalizeAmountResult(value: string):
  | { ok: true; amount: string }
  | { ok: false; result: PrepareCommissionAwareAssignmentResult } {
  try {
    return { ok: true, amount: normalizeCommissionAmount(value) };
  } catch (error) {
    return {
      ok: false,
      result: {
        kind: "INVALID_AMOUNT",
        message: error instanceof CommissionAwareAssignmentInputError
          ? error.message
          : "The commission amount is invalid.",
      },
    };
  }
}

function preparationFailure(
  prepared: { ok: boolean; code?: string; action?: AiActionPublic },
  message: string,
): PrepareCommissionAwareAssignmentResult {
  if (prepared.code === "ACTION_FORBIDDEN") return forbidden();
  return { kind: "UNAVAILABLE", message };
}

export async function prepareAssignDriverWithCommissionProposal(
  context: ReservationAccessContext,
  input: PrepareAssignDriverWithCommissionArguments,
  dependencies: CommissionAwareProposalDependencies,
): Promise<PrepareCommissionAwareAssignmentResult> {
  if (context.role !== "ADMIN") return forbidden();
  const reservation = await dependencies.findOwnedActive({
    reservationId: input.reservation_id,
    ownerEmail: context.email.trim().toLowerCase(),
  });
  if (!reservation) {
    return { kind: "NOT_FOUND", message: "That reservation is unavailable for this account." };
  }
  const target = await dependencies.findDriver(input.driver_id);
  if (!target) return { kind: "NOT_FOUND", message: "That driver is unavailable." };
  if (target.status !== "ACTIVE") {
    return {
      kind: "INACTIVE_DRIVER",
      message: `${target.name} is inactive and cannot receive a new reservation assignment.`,
    };
  }
  const normalized = normalizeAmountResult(input.commission_amount);
  if (!normalized.ok) return normalized.result;
  if (
    reservation.driverId === target.id &&
    reservation.linkedCommission?.driverId === target.id &&
    reservation.linkedCommission.commissionAmount === normalized.amount
  ) {
    return {
      kind: "NO_CHANGES",
      message: `${target.name} is already assigned with a ${euro(normalized.amount)} commission.`,
    };
  }

  const prepared = await dependencies.prepareAction({
    session: { userId: context.userId, email: context.email },
    actionType: "ASSIGN_DRIVER",
    payload: {
      reservationId: reservation.id,
      targetDriverId: target.id,
      commissionAmount: normalized.amount,
    },
    precondition: {
      ...basePrecondition(context, reservation),
      targetDriver: {
        id: target.id,
        status: "ACTIVE",
        updatedAt: target.updatedAt.toISOString(),
      },
    },
    preview: assignPreview(reservation, target, normalized.amount),
    confirmationLabel: reservation.driverId === target.id
      ? "Confirm commission change"
      : "Confirm assignment",
  });
  if (prepared.ok && prepared.action) {
    return { kind: "ACTION_PREVIEW", action: prepared.action };
  }
  return preparationFailure(prepared, "The driver and commission change could not be prepared.");
}

export async function prepareUpdateReservationCommissionProposal(
  context: ReservationAccessContext,
  input: PrepareUpdateReservationCommissionArguments,
  dependencies: CommissionAwareProposalDependencies,
): Promise<PrepareCommissionAwareAssignmentResult> {
  if (context.role !== "ADMIN") return forbidden();
  const reservation = await dependencies.findOwnedActive({
    reservationId: input.reservation_id,
    ownerEmail: context.email.trim().toLowerCase(),
  });
  if (!reservation) {
    return { kind: "NOT_FOUND", message: "That reservation is unavailable for this account." };
  }
  if (!reservation.driverId || !reservation.driver || !reservation.linkedCommission) {
    return {
      kind: "COMMISSION_REQUIRED",
      message: "This reservation needs an assigned driver and linked commission before its commission amount can be updated.",
    };
  }
  if (reservation.linkedCommission.driverId !== reservation.driverId) {
    return {
      kind: "INCONSISTENT_STATE",
      message: "The linked commission does not match the reservation's current driver.",
    };
  }
  const normalized = normalizeAmountResult(input.commission_amount);
  if (!normalized.ok) return normalized.result;
  if (reservation.linkedCommission.commissionAmount === normalized.amount) {
    return {
      kind: "NO_CHANGES",
      message: `The linked commission is already ${euro(normalized.amount)}.`,
    };
  }

  const prepared = await dependencies.prepareAction({
    session: { userId: context.userId, email: context.email },
    actionType: "UPDATE_RESERVATION_COMMISSION",
    payload: {
      reservationId: reservation.id,
      commissionAmount: normalized.amount,
    },
    precondition: basePrecondition(context, reservation),
    preview: updatePreview(reservation, normalized.amount),
    confirmationLabel: "Confirm commission change",
  });
  if (prepared.ok && prepared.action) {
    return { kind: "ACTION_PREVIEW", action: prepared.action };
  }
  return preparationFailure(prepared, "The commission update could not be prepared.");
}

export async function prepareClearDriverAndCommissionProposal(
  context: ReservationAccessContext,
  input: PrepareClearDriverAndCommissionArguments,
  dependencies: CommissionAwareProposalDependencies,
): Promise<PrepareCommissionAwareAssignmentResult> {
  if (context.role !== "ADMIN") return forbidden();
  const reservation = await dependencies.findOwnedActive({
    reservationId: input.reservation_id,
    ownerEmail: context.email.trim().toLowerCase(),
  });
  if (!reservation) {
    return { kind: "NOT_FOUND", message: "That reservation is unavailable for this account." };
  }
  if (!reservation.driverId || !reservation.driver) {
    return { kind: "NO_CHANGES", message: "This reservation is already unassigned." };
  }
  if (!reservation.linkedCommission) {
    return {
      kind: "COMMISSION_REQUIRED",
      message: "This reservation has no linked commission. Use the non-financial driver removal workflow.",
    };
  }

  const prepared = await dependencies.prepareAction({
    session: { userId: context.userId, email: context.email },
    actionType: "CLEAR_DRIVER",
    payload: { reservationId: reservation.id, removesCommission: true },
    precondition: basePrecondition(context, reservation),
    preview: clearPreview(reservation),
    confirmationLabel: "Confirm removal",
  });
  if (prepared.ok && prepared.action) {
    return { kind: "ACTION_PREVIEW", action: prepared.action };
  }
  return preparationFailure(prepared, "The driver and commission removal could not be prepared.");
}
