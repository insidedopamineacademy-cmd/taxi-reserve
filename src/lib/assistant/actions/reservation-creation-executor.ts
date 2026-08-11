import type { AiActionExecutor } from "./core.ts";
import type { JsonObject } from "./contracts.ts";
import {
  createOwnedReservation,
  deserializeReservationCreation,
  type ReservationCreationRepository,
} from "../../reservations/creation-core.ts";
import { formatMadridDate, formatMadridTime } from "../../time/madrid.ts";

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}

function parseStoredCreation(payload: JsonObject, precondition: JsonObject) {
  const preconditionKeys = [
    "ownerUserId",
    "ownerEmail",
    "draftId",
    "draftRevision",
    "defaultStatus",
    "preparedAt",
  ] as const;
  const preparedAt = typeof precondition.preparedAt === "string"
    ? new Date(precondition.preparedAt)
    : null;
  if (
    !hasExactKeys(precondition, preconditionKeys) ||
    typeof precondition.ownerUserId !== "string" ||
    !precondition.ownerUserId ||
    typeof precondition.ownerEmail !== "string" ||
    !precondition.ownerEmail.trim() ||
    typeof precondition.draftId !== "string" ||
    !precondition.draftId ||
    !Number.isInteger(precondition.draftRevision) ||
    (precondition.draftRevision as number) < 1 ||
    precondition.defaultStatus !== "ASSIGNED" ||
    !preparedAt ||
    !Number.isFinite(preparedAt.getTime()) ||
    preparedAt.toISOString() !== precondition.preparedAt
  ) {
    throw new Error("Invalid CREATE_RESERVATION precondition.");
  }
  return {
    ownerUserId: precondition.ownerUserId,
    ownerEmail: precondition.ownerEmail.trim().toLowerCase(),
    draftId: precondition.draftId,
    draftRevision: precondition.draftRevision as number,
    preparedAt,
    reservation: deserializeReservationCreation(payload),
  };
}

export function createReservationCreationExecutor<Transaction>(
  createRepository: (transaction: Transaction) => ReservationCreationRepository,
): AiActionExecutor<Transaction> {
  return {
    async checkPreconditions({ action, actor }) {
      let stored;
      try {
        stored = parseStoredCreation(action.payload, action.precondition);
      } catch {
        return { kind: "CONFLICTED", code: "ACTION_INVALID_PAYLOAD" };
      }
      if (
        action.actionType !== "CREATE_RESERVATION" ||
        stored.ownerUserId !== actor.userId ||
        stored.ownerEmail !== actor.email.trim().toLowerCase()
      ) {
        return { kind: "CONFLICTED", code: "ACTION_AUTHORIZATION_CHANGED" };
      }
      return { kind: "VALID" };
    },

    async execute({ transaction, action, actor }) {
      let stored;
      try {
        stored = parseStoredCreation(action.payload, action.precondition);
      } catch {
        return { kind: "FAILED", code: "ACTION_INVALID_PAYLOAD" };
      }
      if (
        action.actionType !== "CREATE_RESERVATION" ||
        stored.ownerUserId !== actor.userId ||
        stored.ownerEmail !== actor.email.trim().toLowerCase()
      ) {
        return { kind: "CONFLICTED", code: "ACTION_AUTHORIZATION_CHANGED" };
      }

      try {
        const created = await createOwnedReservation(
          { ownerEmail: actor.email, reservation: stored.reservation },
          createRepository(transaction),
        );
        const dateTime = `${formatMadridDate(created.startAt)} · ${formatMadridTime(created.startAt)}`;
        const route = `${created.pickupText || "Not provided"} → ${created.dropoffText || "Not provided"}`;
        return {
          kind: "EXECUTED",
          result: {
            title: "Reservation created",
            message: `${dateTime} · ${route}`.slice(0, 500),
            reference: {
              label: "Open reservation",
              href: `/reservations/${encodeURIComponent(created.id)}/edit`,
            },
          },
          audit: {
            action: "reservation_created",
            entityType: "reservation",
            entityId: created.id,
            metadata: {
              reservationId: created.id,
              serviceDate: formatMadridDate(created.startAt),
              pickupTime: formatMadridTime(created.startAt),
              passengers: created.pax,
              hasPrice: created.priceEuro !== null,
              status: created.status,
              draftId: stored.draftId,
              draftRevision: stored.draftRevision,
            },
          },
        };
      } catch {
        return { kind: "FAILED", code: "ACTION_EXECUTOR_FAILED" };
      }
    },
  };
}
