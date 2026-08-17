import type { AiActionExecutor } from "./core.ts";
import {
  deserializeReservationUpdatePatch,
  reservationUpdateChangedFields,
  snapshotMatchesBeforeValues,
  type ReservationUpdatePatch,
} from "../../reservations/update-core.ts";
import {
  OwnedReservationConflictError,
  OwnedReservationNotFoundError,
  updateOwnedReservation,
} from "../../reservations/update-service.ts";
import type { OwnedReservationUpdateRepository } from "../../reservations/update-service.ts";
import { formatMadridDateDisplay, formatMadridTime } from "../../time/madrid.ts";
import type { JsonObject, JsonValue } from "./contracts.ts";

type ParsedReservationAction = {
  reservationId: string;
  changes: ReservationUpdatePatch;
  updatedAt: Date;
  ownerUserId: string;
  ownerEmail: string;
  before: Record<string, JsonValue>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}

function parseStoredIsoTimestamp(value: unknown) {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
    ? parsed
    : null;
}

function parseStoredReservationAction(
  payload: JsonObject,
  precondition: JsonObject,
): ParsedReservationAction {
  const expectedUpdatedAt = parseStoredIsoTimestamp(precondition.updatedAt);
  if (
    !hasExactKeys(payload, ["reservationId", "changes"]) ||
    typeof payload.reservationId !== "string" ||
    !payload.reservationId ||
    !isRecord(payload.changes)
  ) {
    throw new Error("Invalid UPDATE_RESERVATION payload.");
  }
  if (
    !hasExactKeys(precondition, [
      "reservationId",
      "updatedAt",
      "ownerUserId",
      "ownerEmail",
      "isDeleted",
      "before",
    ]) ||
    precondition.reservationId !== payload.reservationId ||
    !expectedUpdatedAt ||
    typeof precondition.ownerUserId !== "string" ||
    !precondition.ownerUserId ||
    typeof precondition.ownerEmail !== "string" ||
    !precondition.ownerEmail ||
    precondition.isDeleted !== false ||
    !isRecord(precondition.before)
  ) {
    throw new Error("Invalid UPDATE_RESERVATION precondition.");
  }
  const before = precondition.before as Record<string, JsonValue>;
  const changes = deserializeReservationUpdatePatch(payload.changes);
  const changedFields = reservationUpdateChangedFields(changes);
  if (
    Object.keys(before).length !== changedFields.length ||
    changedFields.some((field) => !(field in before))
  ) {
    throw new Error("UPDATE_RESERVATION before-values do not match its changes.");
  }
  return {
    reservationId: payload.reservationId,
    changes,
    updatedAt: expectedUpdatedAt,
    ownerUserId: precondition.ownerUserId,
    ownerEmail: precondition.ownerEmail.trim().toLowerCase(),
    before,
  };
}

function boundedAuditValue(value: JsonValue): JsonValue {
  if (typeof value === "string" && value.length > 240) {
    return `${value.slice(0, 239)}…`;
  }
  return value;
}

function auditValues(value: Record<string, JsonValue>): JsonObject {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, boundedAuditValue(item)]),
  );
}

export function createUpdateReservationExecutor<Transaction>(
  createRepository: (transaction: Transaction) => OwnedReservationUpdateRepository,
): AiActionExecutor<Transaction> {
  return {
    async checkPreconditions({ transaction, action, actor }) {
      let stored: ParsedReservationAction;
      try {
        stored = parseStoredReservationAction(action.payload, action.precondition);
      } catch {
        return { kind: "CONFLICTED", code: "ACTION_INVALID_PAYLOAD" };
      }
      if (
        stored.ownerUserId !== actor.userId ||
        stored.ownerEmail !== actor.email.trim().toLowerCase()
      ) {
        return { kind: "CONFLICTED", code: "ACTION_AUTHORIZATION_CHANGED" };
      }

      const current = await createRepository(transaction).findById(
        stored.reservationId,
      );
      if (
        !current ||
        current.isDeleted ||
        current.userEmail.trim().toLowerCase() !== stored.ownerEmail
      ) {
        return { kind: "CONFLICTED", code: "ACTION_RESERVATION_UNAVAILABLE" };
      }
      if (
        current.updatedAt.getTime() !== stored.updatedAt.getTime() ||
        !snapshotMatchesBeforeValues(current, stored.before)
      ) {
        return { kind: "CONFLICTED", code: "ACTION_RESERVATION_STALE" };
      }
      return { kind: "VALID" };
    },

    async execute({ transaction, action, actor }) {
      let stored: ParsedReservationAction;
      try {
        stored = parseStoredReservationAction(action.payload, action.precondition);
      } catch {
        return { kind: "FAILED", code: "ACTION_INVALID_PAYLOAD" };
      }

      try {
        const updated = await updateOwnedReservation(
          {
            reservationId: stored.reservationId,
            ownerEmail: actor.email,
            patch: stored.changes,
            expectedUpdatedAt: stored.updatedAt,
          },
          createRepository(transaction),
        );
        const changedFields = reservationUpdateChangedFields(stored.changes);
        const serializedChanges = action.payload.changes as Record<string, JsonValue>;
        const route = `${updated.pickupText || "Not provided"} → ${updated.dropoffText || "Not provided"}`;
        const summary = [
          `${formatMadridDateDisplay(updated.startAt)} · ${formatMadridTime(updated.startAt)}`,
          route,
          changedFields.includes("pax") ? `Passengers: ${updated.pax}` : null,
        ].filter(Boolean).join(" · ");

        return {
          kind: "EXECUTED",
          result: {
            title: "Reservation updated",
            message: summary.slice(0, 500),
            reference: {
              label: "Open reservation",
              href: `/reservations/${encodeURIComponent(updated.id)}/edit`,
            },
          },
          audit: {
            action: "reservation_updated",
            entityType: "reservation",
            entityId: updated.id,
            metadata: {
              reservationId: updated.id,
              changedFields,
              before: auditValues(stored.before),
              after: auditValues(serializedChanges),
            },
          },
        };
      } catch (error) {
        if (
          error instanceof OwnedReservationConflictError ||
          error instanceof OwnedReservationNotFoundError
        ) {
          return { kind: "CONFLICTED", code: "ACTION_RESERVATION_STALE" };
        }
        return { kind: "FAILED", code: "ACTION_EXECUTOR_FAILED" };
      }
    },
  };
}
