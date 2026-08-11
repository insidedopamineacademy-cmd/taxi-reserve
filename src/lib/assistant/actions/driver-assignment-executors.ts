import type { AiActionExecutor } from "./core.ts";
import type { JsonObject } from "./contracts.ts";
import {
  DriverAssignmentCommissionConflictError,
  DriverAssignmentConflictError,
  DriverAssignmentInactiveError,
  DriverAssignmentInputError,
  DriverAssignmentReservationNotFoundError,
  DriverAssignmentTargetNotFoundError,
  changeOwnedReservationDriver,
  matchesDriverAssignmentPrecondition,
  type DriverAssignmentExpectedState,
  type DriverAssignmentRepository,
} from "../../reservations/driver-assignment-core.ts";
import { formatMadridDate, formatMadridTime } from "../../time/madrid.ts";

type StoredDriverAssignmentAction = {
  actionType: "ASSIGN_DRIVER" | "CLEAR_DRIVER";
  reservationId: string;
  targetDriverId: string | null;
  ownerUserId: string;
  ownerEmail: string;
  expected: DriverAssignmentExpectedState;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}

function boundedId(value: unknown) {
  return typeof value === "string" && Boolean(value.trim()) && value.length <= 100
    ? value
    : null;
}

function canonicalTimestamp(value: unknown) {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value ? date : null;
}

function parseStoredDriverState(value: unknown) {
  if (value === null) return null;
  if (!isRecord(value) || !hasExactKeys(value, ["id", "updatedAt"])) return undefined;
  const id = boundedId(value.id);
  const updatedAt = canonicalTimestamp(value.updatedAt);
  return id && updatedAt ? { id, updatedAt } : undefined;
}

function parseStoredTargetState(value: unknown) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["id", "status", "updatedAt"]) ||
    value.status !== "ACTIVE"
  ) {
    return null;
  }
  const id = boundedId(value.id);
  const updatedAt = canonicalTimestamp(value.updatedAt);
  return id && updatedAt ? { id, status: "ACTIVE" as const, updatedAt } : null;
}

function parseStoredDriverAssignmentAction(
  actionType: "ASSIGN_DRIVER" | "CLEAR_DRIVER",
  payload: JsonObject,
  precondition: JsonObject,
): StoredDriverAssignmentAction {
  const payloadKeys = actionType === "ASSIGN_DRIVER"
    ? ["reservationId", "targetDriverId"] as const
    : ["reservationId"] as const;
  const preconditionKeys = actionType === "ASSIGN_DRIVER"
    ? [
        "reservationId",
        "reservationUpdatedAt",
        "ownerUserId",
        "ownerEmail",
        "isDeleted",
        "currentDriverId",
        "currentDriver",
        "linkedCommission",
        "targetDriver",
      ] as const
    : [
        "reservationId",
        "reservationUpdatedAt",
        "ownerUserId",
        "ownerEmail",
        "isDeleted",
        "currentDriverId",
        "currentDriver",
        "linkedCommission",
      ] as const;
  const reservationId = boundedId(payload.reservationId);
  const expectedReservationId = boundedId(precondition.reservationId);
  const ownerUserId = boundedId(precondition.ownerUserId);
  const ownerEmail = typeof precondition.ownerEmail === "string"
    ? precondition.ownerEmail.trim().toLowerCase()
    : "";
  const reservationUpdatedAt = canonicalTimestamp(precondition.reservationUpdatedAt);
  const currentDriverId = precondition.currentDriverId === null
    ? null
    : boundedId(precondition.currentDriverId);
  const currentDriver = parseStoredDriverState(precondition.currentDriver);
  const targetDriverId = actionType === "ASSIGN_DRIVER"
    ? boundedId(payload.targetDriverId)
    : null;
  const targetDriver = actionType === "ASSIGN_DRIVER"
    ? parseStoredTargetState(precondition.targetDriver)
    : undefined;

  if (
    !hasExactKeys(payload, payloadKeys) ||
    !hasExactKeys(precondition, preconditionKeys) ||
    !reservationId ||
    reservationId !== expectedReservationId ||
    !ownerUserId ||
    !ownerEmail ||
    ownerEmail.length > 320 ||
    precondition.isDeleted !== false ||
    !reservationUpdatedAt ||
    precondition.linkedCommission !== null ||
    currentDriver === undefined ||
    (currentDriverId === null) !== (currentDriver === null)
  ) {
    throw new Error(`Invalid ${actionType} payload or precondition.`);
  }
  if (currentDriver && currentDriver.id !== currentDriverId) {
    throw new Error(`Invalid ${actionType} current-driver precondition.`);
  }
  if (
    actionType === "ASSIGN_DRIVER" &&
    (!targetDriverId ||
      !targetDriver ||
      targetDriver.id !== targetDriverId ||
      currentDriverId === targetDriverId)
  ) {
    throw new Error("Invalid ASSIGN_DRIVER target precondition.");
  }
  if (actionType === "CLEAR_DRIVER" && currentDriverId === null) {
    throw new Error("Invalid CLEAR_DRIVER current-driver precondition.");
  }

  return {
    actionType,
    reservationId,
    targetDriverId,
    ownerUserId,
    ownerEmail,
    expected: {
      reservationUpdatedAt,
      currentDriverId,
      currentDriver,
      linkedCommission: null,
      ...(targetDriver ? { targetDriver } : {}),
    },
  };
}

function actorMatches(
  actor: { userId: string; email: string; role: "USER" | "ADMIN" },
  stored: StoredDriverAssignmentAction,
) {
  return actor.role === "ADMIN" &&
    actor.userId === stored.ownerUserId &&
    actor.email.trim().toLowerCase() === stored.ownerEmail;
}

function conflictCode(error: unknown) {
  if (error instanceof DriverAssignmentCommissionConflictError) {
    return "ACTION_COMMISSION_STATE_CHANGED";
  }
  if (error instanceof DriverAssignmentInactiveError) {
    return "ACTION_DRIVER_INACTIVE";
  }
  if (error instanceof DriverAssignmentTargetNotFoundError) {
    return "ACTION_DRIVER_UNAVAILABLE";
  }
  if (
    error instanceof DriverAssignmentConflictError ||
    error instanceof DriverAssignmentReservationNotFoundError
  ) {
    return "ACTION_ASSIGNMENT_STALE";
  }
  return null;
}

export function createDriverAssignmentExecutor<Transaction>(
  actionType: "ASSIGN_DRIVER" | "CLEAR_DRIVER",
  createRepository: (transaction: Transaction) => DriverAssignmentRepository,
): AiActionExecutor<Transaction> {
  return {
    async checkPreconditions({ transaction, action, actor }) {
      let stored: StoredDriverAssignmentAction;
      try {
        stored = parseStoredDriverAssignmentAction(
          actionType,
          action.payload,
          action.precondition,
        );
      } catch {
        return { kind: "CONFLICTED", code: "ACTION_INVALID_PAYLOAD" };
      }
      if (action.actionType !== actionType || !actorMatches(actor, stored)) {
        return { kind: "CONFLICTED", code: "ACTION_AUTHORIZATION_CHANGED" };
      }

      const repository = createRepository(transaction);
      const current = await repository.findById(stored.reservationId);
      if (
        !current ||
        current.isDeleted ||
        current.userEmail.trim().toLowerCase() !== stored.ownerEmail
      ) {
        return { kind: "CONFLICTED", code: "ACTION_RESERVATION_UNAVAILABLE" };
      }
      if (!matchesDriverAssignmentPrecondition(current, stored.expected)) {
        return { kind: "CONFLICTED", code: "ACTION_ASSIGNMENT_STALE" };
      }

      if (stored.expected.targetDriver) {
        const target = await repository.findDriver(stored.expected.targetDriver.id);
        if (!target) {
          return { kind: "CONFLICTED", code: "ACTION_DRIVER_UNAVAILABLE" };
        }
        if (
          target.status !== "ACTIVE" ||
          target.updatedAt.getTime() !== stored.expected.targetDriver.updatedAt.getTime()
        ) {
          return { kind: "CONFLICTED", code: "ACTION_DRIVER_STATE_CHANGED" };
        }
      }
      return { kind: "VALID" };
    },

    async execute({ transaction, action, actor }) {
      let stored: StoredDriverAssignmentAction;
      try {
        stored = parseStoredDriverAssignmentAction(
          actionType,
          action.payload,
          action.precondition,
        );
      } catch {
        return { kind: "FAILED", code: "ACTION_INVALID_PAYLOAD" };
      }
      if (action.actionType !== actionType || !actorMatches(actor, stored)) {
        return { kind: "CONFLICTED", code: "ACTION_AUTHORIZATION_CHANGED" };
      }

      try {
        const assignment = await changeOwnedReservationDriver(
          {
            reservationId: stored.reservationId,
            ownerEmail: stored.ownerEmail,
            nextDriverId: stored.targetDriverId,
            commissionPolicy: "BLOCK_LINKED",
            expected: stored.expected,
          },
          createRepository(transaction),
        );
        if (!assignment.changed) {
          return { kind: "CONFLICTED", code: "ACTION_ASSIGNMENT_STALE" };
        }

        const reservation = assignment.reservation;
        const dateTime = `${formatMadridDate(reservation.startAt)} · ${formatMadridTime(reservation.startAt)}`;
        const route = `${reservation.pickupText || "Not provided"} → ${reservation.dropoffText || "Not provided"}`;
        const assigned = actionType === "ASSIGN_DRIVER";
        const driverName = assignment.nextDriver?.name || "Unassigned";

        return {
          kind: "EXECUTED",
          result: {
            title: assigned ? "Driver assigned" : "Driver removed",
            message: `${dateTime} · ${route} · ${assigned ? `Driver: ${driverName}` : "Status: Unassigned"}`.slice(0, 500),
            reference: {
              label: "Open reservation",
              href: `/reservations/${encodeURIComponent(reservation.id)}/edit`,
            },
          },
          audit: {
            action: assigned
              ? assignment.previousDriver
                ? "reservation_driver_changed"
                : "reservation_driver_assigned"
              : "reservation_driver_unassigned",
            entityType: "reservation",
            entityId: reservation.id,
            metadata: {
              reservationId: reservation.id,
              beforeDriverId: assignment.previousDriver?.id ?? null,
              beforeDriverName: assignment.previousDriver?.name ?? null,
              afterDriverId: assignment.nextDriver?.id ?? null,
              afterDriverName: assignment.nextDriver?.name ?? null,
            },
          },
        };
      } catch (error) {
        const code = conflictCode(error);
        if (code) return { kind: "CONFLICTED", code };
        if (error instanceof DriverAssignmentInputError) {
          return { kind: "FAILED", code: "ACTION_INVALID_PAYLOAD" };
        }
        return { kind: "FAILED", code: "ACTION_EXECUTOR_FAILED" };
      }
    },
  };
}
