import "server-only";

import type { ReservationAccessContext } from "./assistant-read-core.ts";
import {
  RESERVATION_DRAFT_TTL_MS,
  type ReservationDraftField,
  type ReservationDraftFields,
  type ReservationDraftRecord,
} from "./reservation-draft-core.ts";
import {
  clearAiWorkflowDraft,
  loadAiWorkflowDraft,
  saveAiWorkflowDraft,
  type AiWorkflowDraftRepository,
} from "../assistant/workflow-drafts/core.ts";
import { prismaAiWorkflowDraftRepository } from "../assistant/workflow-drafts/prisma.ts";

export type ReservationDraftLoadResult =
  | { kind: "ACTIVE"; draft: ReservationDraftRecord }
  | { kind: "EXPIRED" }
  | { kind: "MISSING" };

export type ReservationDraftStore = {
  load(
    context: Pick<ReservationAccessContext, "userId" | "email">,
  ): Promise<ReservationDraftLoadResult>;
  save(draft: ReservationDraftRecord): Promise<ReservationDraftRecord>;
  clear(context: Pick<ReservationAccessContext, "userId" | "email">): Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}

function isoDate(value: unknown) {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value ? date : null;
}

function parseField<T extends string | number>(
  value: unknown,
  type: "string" | "number",
): ReservationDraftField<T> | null {
  if (
    !isRecord(value) ||
    !["state", "value", "alternatives", "confirmed"].every((key) => key in value) ||
    Object.keys(value).some((key) => !["state", "value", "alternatives", "confirmed", "message"].includes(key)) ||
    !["EXPLICIT", "INFERRED", "MISSING", "CONFLICT"].includes(String(value.state)) ||
    (value.value !== null && typeof value.value !== type) ||
    !Array.isArray(value.alternatives) ||
    !value.alternatives.every((entry) => typeof entry === type) ||
    typeof value.confirmed !== "boolean" ||
    (value.message !== undefined && typeof value.message !== "string")
  ) return null;
  return value as ReservationDraftField<T>;
}

function parseFields(value: unknown): ReservationDraftFields | null {
  const keys = [
    "pickup",
    "dropoff",
    "phone",
    "serviceDate",
    "pickupTime",
    "passengers",
    "priceEuro",
    "flight",
    "notes",
  ] as const;
  if (!isRecord(value) || !exactKeys(value, keys)) return null;
  const pickup = parseField<string>(value.pickup, "string");
  const dropoff = parseField<string>(value.dropoff, "string");
  const phone = parseField<string>(value.phone, "string");
  const serviceDate = parseField<string>(value.serviceDate, "string");
  const pickupTime = parseField<string>(value.pickupTime, "string");
  const passengers = parseField<number>(value.passengers, "number");
  const priceEuro = parseField<number>(value.priceEuro, "number");
  const flight = parseField<string>(value.flight, "string");
  const notes = parseField<string>(value.notes, "string");
  if (!pickup || !dropoff || !phone || !serviceDate || !pickupTime || !passengers || !priceEuro || !flight || !notes) {
    return null;
  }
  return { pickup, dropoff, phone, serviceDate, pickupTime, passengers, priceEuro, flight, notes };
}

function serializeDraft(draft: ReservationDraftRecord): Record<string, unknown> {
  return {
    id: draft.id,
    ownerUserId: draft.ownerUserId,
    ownerEmail: draft.ownerEmail,
    revision: draft.revision,
    fields: draft.fields,
    completeConfirmed: draft.completeConfirmed,
    duplicateAcknowledged: draft.duplicateAcknowledged,
    pendingActionId: draft.pendingActionId,
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  };
}

function deserializeDraft(
  payload: unknown,
  expiresAt: Date,
): ReservationDraftRecord {
  const keys = [
    "id",
    "ownerUserId",
    "ownerEmail",
    "revision",
    "fields",
    "completeConfirmed",
    "duplicateAcknowledged",
    "pendingActionId",
    "createdAt",
    "updatedAt",
  ] as const;
  if (!isRecord(payload) || !exactKeys(payload, keys)) {
    throw new Error("Stored reservation draft is malformed.");
  }
  const fields = parseFields(payload.fields);
  const createdAt = isoDate(payload.createdAt);
  const updatedAt = isoDate(payload.updatedAt);
  if (
    typeof payload.id !== "string" || !payload.id || payload.id.length > 200 ||
    typeof payload.ownerUserId !== "string" || !payload.ownerUserId ||
    typeof payload.ownerEmail !== "string" || !payload.ownerEmail ||
    !Number.isInteger(payload.revision) || (payload.revision as number) < 1 ||
    !fields ||
    typeof payload.completeConfirmed !== "boolean" ||
    typeof payload.duplicateAcknowledged !== "boolean" ||
    (payload.pendingActionId !== null && typeof payload.pendingActionId !== "string") ||
    !createdAt || !updatedAt
  ) throw new Error("Stored reservation draft is malformed.");
  return {
    id: payload.id,
    ownerUserId: payload.ownerUserId,
    ownerEmail: payload.ownerEmail.trim().toLowerCase(),
    revision: payload.revision as number,
    fields,
    completeConfirmed: payload.completeConfirmed,
    duplicateAcknowledged: payload.duplicateAcknowledged,
    pendingActionId: payload.pendingActionId as string | null,
    createdAt,
    updatedAt,
    expiresAt,
  };
}

export function createDurableReservationDraftStore(
  repository: AiWorkflowDraftRepository,
  options: { now?: () => Date } = {},
): ReservationDraftStore {
  const now = options.now ?? (() => new Date());
  return {
    async load(context) {
      const loaded = await loadAiWorkflowDraft(
        { userId: context.userId, kind: "RESERVATION_CREATE", now: now() },
        repository,
      );
      if (loaded.kind !== "ACTIVE") return loaded;
      const draft = deserializeDraft(loaded.row.payload, loaded.row.expiresAt);
      if (
        draft.ownerUserId !== context.userId ||
        draft.ownerEmail !== context.email.trim().toLowerCase()
      ) return { kind: "MISSING" };
      return { kind: "ACTIVE", draft };
    },

    async save(draft) {
      const current = now();
      const storedDraft = {
        ...structuredClone(draft),
        expiresAt: new Date(current.getTime() + RESERVATION_DRAFT_TTL_MS),
      };
      const row = await saveAiWorkflowDraft(
        {
          userId: draft.ownerUserId,
          kind: "RESERVATION_CREATE",
          payload: serializeDraft(storedDraft),
          now: current,
          ttlMs: RESERVATION_DRAFT_TTL_MS,
        },
        repository,
      );
      return deserializeDraft(row.payload, row.expiresAt);
    },

    async clear(context) {
      const loaded = await this.load(context);
      if (loaded.kind === "ACTIVE") {
        await clearAiWorkflowDraft(
          { userId: context.userId, kind: "RESERVATION_CREATE" },
          repository,
        );
      }
    },
  };
}

export const reservationDraftStore = createDurableReservationDraftStore(
  prismaAiWorkflowDraftRepository,
);
