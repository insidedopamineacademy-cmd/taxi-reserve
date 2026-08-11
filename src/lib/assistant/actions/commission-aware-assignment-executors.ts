import type { AiActionExecutor } from "./core.ts";
import type { JsonObject } from "./contracts.ts";
import {
  CommissionAwareAssignmentInputError,
  CommissionAwareCommissionRequiredError,
  CommissionAwareConflictError,
  CommissionAwareDriverInactiveError,
  CommissionAwareDriverNotFoundError,
  CommissionAwareInconsistentStateError,
  CommissionAwareReservationNotFoundError,
  CommissionAwareUnexpectedCommissionError,
  changeOwnedReservationDriverAndCommission,
  normalizeCommissionAmount,
  type CommissionAwareAssignmentOperation,
  type CommissionAwareAssignmentRepository,
} from "../../reservations/commission-aware-assignment-core.ts";
import {
  matchesDriverAssignmentPrecondition,
  type DriverAssignmentExpectedState,
  type LinkedCommissionSnapshot,
} from "../../reservations/driver-assignment-core.ts";
import { formatMadridDate, formatMadridTime } from "../../time/madrid.ts";

type CommissionAwareActionType =
  | "ASSIGN_DRIVER"
  | "CLEAR_DRIVER"
  | "UPDATE_RESERVATION_COMMISSION";

type StoredCommissionAwareAction = {
  actionType: CommissionAwareActionType;
  reservationId: string;
  ownerUserId: string;
  ownerEmail: string;
  expected: DriverAssignmentExpectedState;
  operation: CommissionAwareAssignmentOperation;
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

function canonicalAmount(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const normalized = normalizeCommissionAmount(value);
    return normalized === value ? value : null;
  } catch {
    return null;
  }
}

function parseDriverState(value: unknown) {
  if (value === null) return null;
  if (!isRecord(value) || !hasExactKeys(value, ["id", "updatedAt"])) return undefined;
  const id = boundedId(value.id);
  const updatedAt = canonicalTimestamp(value.updatedAt);
  return id && updatedAt ? { id, updatedAt } : undefined;
}

function parseTargetState(value: unknown) {
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

function parseCommissionState(value: unknown): LinkedCommissionSnapshot | null | undefined {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "id",
      "driverId",
      "reservationId",
      "commissionAmount",
      "entryDate",
      "updatedAt",
    ])
  ) {
    return undefined;
  }
  const id = boundedId(value.id);
  const driverId = boundedId(value.driverId);
  const reservationId = boundedId(value.reservationId);
  const commissionAmount = canonicalAmount(value.commissionAmount);
  const entryDate = canonicalTimestamp(value.entryDate);
  const updatedAt = canonicalTimestamp(value.updatedAt);
  return id && driverId && reservationId && commissionAmount && entryDate && updatedAt
    ? { id, driverId, reservationId, commissionAmount, entryDate, updatedAt }
    : undefined;
}

function parseStoredCommissionAwareAction(
  actionType: CommissionAwareActionType,
  payload: JsonObject,
  precondition: JsonObject,
): StoredCommissionAwareAction {
  const payloadKeys = actionType === "ASSIGN_DRIVER"
    ? ["reservationId", "targetDriverId", "commissionAmount"] as const
    : actionType === "CLEAR_DRIVER"
      ? ["reservationId", "removesCommission"] as const
      : ["reservationId", "commissionAmount"] as const;
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
  const reservationUpdatedAt = canonicalTimestamp(precondition.reservationUpdatedAt);
  const ownerUserId = boundedId(precondition.ownerUserId);
  const ownerEmail = typeof precondition.ownerEmail === "string"
    ? precondition.ownerEmail.trim().toLowerCase()
    : "";
  const currentDriverId = precondition.currentDriverId === null
    ? null
    : boundedId(precondition.currentDriverId);
  const currentDriver = parseDriverState(precondition.currentDriver);
  const linkedCommission = parseCommissionState(precondition.linkedCommission);
  const targetDriver = actionType === "ASSIGN_DRIVER"
    ? parseTargetState(precondition.targetDriver)
    : undefined;

  if (
    !hasExactKeys(payload, payloadKeys) ||
    !hasExactKeys(precondition, preconditionKeys) ||
    !reservationId ||
    reservationId !== expectedReservationId ||
    !reservationUpdatedAt ||
    !ownerUserId ||
    !ownerEmail ||
    ownerEmail.length > 320 ||
    precondition.isDeleted !== false ||
    currentDriver === undefined ||
    linkedCommission === undefined ||
    (currentDriverId === null) !== (currentDriver === null) ||
    (currentDriver !== null && currentDriver.id !== currentDriverId) ||
    (linkedCommission !== null && linkedCommission.reservationId !== reservationId)
  ) {
    throw new Error(`Invalid ${actionType} payload or precondition.`);
  }

  let operation: CommissionAwareAssignmentOperation;
  if (actionType === "ASSIGN_DRIVER") {
    const targetDriverId = boundedId(payload.targetDriverId);
    const commissionAmount = canonicalAmount(payload.commissionAmount);
    if (
      !targetDriverId ||
      !commissionAmount ||
      !targetDriver ||
      targetDriver.id !== targetDriverId
    ) {
      throw new Error("Invalid commission-aware ASSIGN_DRIVER target.");
    }
    operation = {
      kind: "ASSIGN_WITH_COMMISSION",
      targetDriverId,
      commissionAmount,
    };
  } else if (actionType === "CLEAR_DRIVER") {
    if (
      payload.removesCommission !== true ||
      currentDriverId === null ||
      linkedCommission === null
    ) {
      throw new Error("Invalid commission-aware CLEAR_DRIVER payload.");
    }
    operation = { kind: "CLEAR_WITH_COMMISSION" };
  } else {
    const commissionAmount = canonicalAmount(payload.commissionAmount);
    if (
      !commissionAmount ||
      currentDriverId === null ||
      linkedCommission === null ||
      linkedCommission.driverId !== currentDriverId
    ) {
      throw new Error("Invalid UPDATE_RESERVATION_COMMISSION payload.");
    }
    operation = { kind: "UPDATE_COMMISSION", commissionAmount };
  }

  return {
    actionType,
    reservationId,
    ownerUserId,
    ownerEmail,
    operation,
    expected: {
      reservationUpdatedAt,
      currentDriverId,
      currentDriver,
      linkedCommission,
      ...(targetDriver ? { targetDriver } : {}),
    },
  };
}

function actorMatches(
  actor: { userId: string; email: string; role: "USER" | "ADMIN" },
  stored: StoredCommissionAwareAction,
) {
  return actor.role === "ADMIN" &&
    actor.userId === stored.ownerUserId &&
    actor.email.trim().toLowerCase() === stored.ownerEmail;
}

function conflictCode(error: unknown) {
  if (error instanceof CommissionAwareDriverInactiveError) {
    return "ACTION_DRIVER_STATE_CHANGED";
  }
  if (error instanceof CommissionAwareDriverNotFoundError) {
    return "ACTION_DRIVER_UNAVAILABLE";
  }
  if (
    error instanceof CommissionAwareConflictError ||
    error instanceof CommissionAwareReservationNotFoundError
  ) {
    return "ACTION_FINANCIAL_STATE_CHANGED";
  }
  if (
    error instanceof CommissionAwareCommissionRequiredError ||
    error instanceof CommissionAwareUnexpectedCommissionError ||
    error instanceof CommissionAwareInconsistentStateError
  ) {
    return "ACTION_COMMISSION_STATE_CHANGED";
  }
  return null;
}

export function createCommissionAwareAssignmentExecutor<Transaction>(
  actionType: CommissionAwareActionType,
  createRepository: (transaction: Transaction) => CommissionAwareAssignmentRepository,
): AiActionExecutor<Transaction> {
  return {
    async checkPreconditions({ transaction, action, actor }) {
      let stored: StoredCommissionAwareAction;
      try {
        stored = parseStoredCommissionAwareAction(
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
        return { kind: "CONFLICTED", code: "ACTION_FINANCIAL_STATE_CHANGED" };
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
      let stored: StoredCommissionAwareAction;
      try {
        stored = parseStoredCommissionAwareAction(
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
        const mutation = await changeOwnedReservationDriverAndCommission(
          {
            reservationId: stored.reservationId,
            ownerEmail: stored.ownerEmail,
            operation: stored.operation,
            expected: stored.expected,
          },
          createRepository(transaction),
        );
        if (!mutation.changed) {
          return { kind: "CONFLICTED", code: "ACTION_FINANCIAL_STATE_CHANGED" };
        }

        const after = mutation.after;
        const beforeCommission = mutation.before.linkedCommission;
        const afterCommission = after.linkedCommission;
        const route = `${after.pickupText || "Not provided"} → ${after.dropoffText || "Not provided"}`;
        const dateTime = `${formatMadridDate(after.startAt)} · ${formatMadridTime(after.startAt)}`;
        const clear = actionType === "CLEAR_DRIVER";
        const updateOnly = actionType === "UPDATE_RESERVATION_COMMISSION";
        const resultTitle = clear
          ? "Driver and commission removed"
          : updateOnly
            ? "Commission updated"
            : "Driver and commission updated";
        const resultDetail = clear
          ? "Reservation is now unassigned. Linked commission was removed."
          : `Driver: ${after.driver?.name || "Unassigned"} · Commission: €${afterCommission?.commissionAmount}`;

        return {
          kind: "EXECUTED",
          result: {
            title: resultTitle,
            message: `${dateTime} · ${route} · ${resultDetail}`.slice(0, 500),
            reference: {
              label: "Open reservation",
              href: `/reservations/${encodeURIComponent(after.id)}/edit`,
            },
          },
          audit: {
            action: clear
              ? "reservation_driver_commission_removed"
              : updateOnly
                ? "reservation_commission_updated"
                : "reservation_driver_commission_updated",
            entityType: "reservation",
            entityId: after.id,
            metadata: {
              reservationId: after.id,
              beforeDriverId: mutation.before.driver?.id ?? null,
              beforeDriverName: mutation.before.driver?.name ?? null,
              afterDriverId: after.driver?.id ?? null,
              afterDriverName: after.driver?.name ?? null,
              beforeCommissionAmount: beforeCommission?.commissionAmount ?? null,
              afterCommissionAmount: afterCommission?.commissionAmount ?? null,
              commissionMutation: mutation.commissionMutation.toLowerCase(),
            },
          },
        };
      } catch (error) {
        const code = conflictCode(error);
        if (code) return { kind: "CONFLICTED", code };
        if (error instanceof CommissionAwareAssignmentInputError) {
          return { kind: "FAILED", code: "ACTION_INVALID_PAYLOAD" };
        }
        return { kind: "FAILED", code: "ACTION_EXECUTOR_FAILED" };
      }
    },
  };
}
