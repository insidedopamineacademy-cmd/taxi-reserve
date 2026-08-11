import "server-only";

import {
  DRIVER_IMPORT_MAX_ROWS,
  DRIVER_IMPORT_TTL_MS,
  type DriverImportDraftRecord,
  type DriverImportRow,
  type DriverImportRowState,
  type ExistingDriverImportSnapshot,
} from "./import-core.ts";
import type { ReservationAccessContext } from "../reservations/assistant-read-core.ts";
import {
  clearAiWorkflowDraft,
  loadAiWorkflowDraft,
  saveAiWorkflowDraft,
  type AiWorkflowDraftRepository,
} from "../assistant/workflow-drafts/core.ts";
import { prismaAiWorkflowDraftRepository } from "../assistant/workflow-drafts/prisma.ts";

export type DriverImportDraftLoadResult =
  | { kind: "ACTIVE"; draft: DriverImportDraftRecord }
  | { kind: "EXPIRED" }
  | { kind: "MISSING" };

export type DriverImportDraftStore = {
  load(context: Pick<ReservationAccessContext, "userId" | "email">): Promise<DriverImportDraftLoadResult>;
  save(draft: DriverImportDraftRecord): Promise<DriverImportDraftRecord>;
  clear(context: Pick<ReservationAccessContext, "userId" | "email">): Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}

function hasKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return keys.every((key) => key in value);
}

function parseIso(value: unknown) {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value ? date : null;
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

const rowStates = new Set<DriverImportRowState>([
  "NEW",
  "EXISTING_MATCH",
  "EXISTING_UPDATE",
  "DUPLICATE_IN_IMPORT",
  "NEEDS_REVIEW",
  "CONFLICT",
]);

function parseExisting(value: unknown): ExistingDriverImportSnapshot | null | undefined {
  if (value === null) return null;
  const keys = ["id", "name", "licenseNumber", "vehicleType", "status", "subscriptionExempt", "updatedAt"];
  if (!isRecord(value) || !hasKeys(value, keys) || !onlyKeys(value, keys)) return undefined;
  const updatedAt = parseIso(value.updatedAt);
  if (
    !boundedString(value.id, 200) ||
    !boundedString(value.name, 200) ||
    !boundedString(value.licenseNumber, 100) ||
    (value.vehicleType !== null && value.vehicleType !== "VAN" && value.vehicleType !== "SEDAN") ||
    (value.status !== "ACTIVE" && value.status !== "INACTIVE") ||
    typeof value.subscriptionExempt !== "boolean" ||
    !updatedAt
  ) return undefined;
  return {
    id: value.id,
    name: value.name,
    licenseNumber: value.licenseNumber,
    vehicleType: value.vehicleType,
    status: value.status,
    subscriptionExempt: value.subscriptionExempt,
    updatedAt,
  };
}

function parseRow(value: unknown): DriverImportRow | null {
  const keys = [
    "id", "sourceLine", "name", "licenseNumber", "vehicleRaw", "vehicleType",
    "sourceNotes", "possibleNames", "duplicateOccurrences", "state", "issues", "existing",
  ];
  if (!isRecord(value) || !hasKeys(value, keys) || !onlyKeys(value, keys)) return null;
  const existing = parseExisting(value.existing);
  if (
    !boundedString(value.id, 200) ||
    !boundedString(value.sourceLine, 500) ||
    (value.name !== null && !boundedString(value.name, 200)) ||
    (value.licenseNumber !== null && !boundedString(value.licenseNumber, 100)) ||
    (value.vehicleRaw !== null && !boundedString(value.vehicleRaw, 100)) ||
    (value.vehicleType !== null && value.vehicleType !== "VAN" && value.vehicleType !== "SEDAN") ||
    !Array.isArray(value.sourceNotes) || value.sourceNotes.length > 10 ||
    !value.sourceNotes.every((item) => boundedString(item, 300)) ||
    !Array.isArray(value.possibleNames) || value.possibleNames.length > 6 ||
    !value.possibleNames.every((item) => boundedString(item, 200)) ||
    !Number.isInteger(value.duplicateOccurrences) || (value.duplicateOccurrences as number) < 0 ||
    typeof value.state !== "string" || !rowStates.has(value.state as DriverImportRowState) ||
    !Array.isArray(value.issues) || value.issues.length > 10 ||
    !value.issues.every((item) => boundedString(item, 500)) ||
    existing === undefined
  ) return null;
  return {
    id: value.id,
    sourceLine: value.sourceLine,
    name: value.name as string | null,
    licenseNumber: value.licenseNumber as string | null,
    vehicleRaw: value.vehicleRaw as string | null,
    vehicleType: value.vehicleType as "VAN" | "SEDAN" | null,
    sourceNotes: value.sourceNotes as string[],
    possibleNames: value.possibleNames as string[],
    duplicateOccurrences: value.duplicateOccurrences as number,
    state: value.state as DriverImportRowState,
    issues: value.issues as string[],
    existing,
  };
}

function serializeDraft(draft: DriverImportDraftRecord): Record<string, unknown> {
  return {
    id: draft.id,
    ownerUserId: draft.ownerUserId,
    ownerEmail: draft.ownerEmail,
    revision: draft.revision,
    rows: draft.rows.map((row) => ({
      ...row,
      existing: row.existing
        ? { ...row.existing, updatedAt: row.existing.updatedAt.toISOString() }
        : null,
    })),
    duplicateRowsSkipped: draft.duplicateRowsSkipped,
    completeConfirmed: draft.completeConfirmed,
    pendingActionId: draft.pendingActionId,
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  };
}

function deserializeDraft(payload: unknown, expiresAt: Date): DriverImportDraftRecord {
  const keys = [
    "id", "ownerUserId", "ownerEmail", "revision", "rows", "duplicateRowsSkipped",
    "completeConfirmed", "pendingActionId", "createdAt", "updatedAt",
  ];
  if (!isRecord(payload) || !hasKeys(payload, keys) || !onlyKeys(payload, keys)) {
    throw new Error("Stored driver import draft is malformed.");
  }
  const createdAt = parseIso(payload.createdAt);
  const updatedAt = parseIso(payload.updatedAt);
  const rows = Array.isArray(payload.rows) ? payload.rows.map(parseRow) : [];
  if (
    !boundedString(payload.id, 200) ||
    !boundedString(payload.ownerUserId, 200) ||
    !boundedString(payload.ownerEmail, 320) ||
    !Number.isInteger(payload.revision) || (payload.revision as number) < 1 ||
    !Array.isArray(payload.rows) || payload.rows.length === 0 || payload.rows.length > DRIVER_IMPORT_MAX_ROWS ||
    rows.some((row) => row === null) ||
    !Number.isInteger(payload.duplicateRowsSkipped) || (payload.duplicateRowsSkipped as number) < 0 ||
    typeof payload.completeConfirmed !== "boolean" ||
    (payload.pendingActionId !== null && !boundedString(payload.pendingActionId, 200)) ||
    !createdAt || !updatedAt
  ) throw new Error("Stored driver import draft is malformed.");
  return {
    id: payload.id,
    ownerUserId: payload.ownerUserId,
    ownerEmail: payload.ownerEmail.trim().toLowerCase(),
    revision: payload.revision as number,
    rows: rows as DriverImportRow[],
    duplicateRowsSkipped: payload.duplicateRowsSkipped as number,
    completeConfirmed: payload.completeConfirmed,
    pendingActionId: payload.pendingActionId as string | null,
    createdAt,
    updatedAt,
    expiresAt,
  };
}

export function createDurableDriverImportDraftStore(
  repository: AiWorkflowDraftRepository,
  options: { now?: () => Date } = {},
): DriverImportDraftStore {
  const now = options.now ?? (() => new Date());
  return {
    async load(context) {
      const loaded = await loadAiWorkflowDraft(
        { userId: context.userId, kind: "DRIVER_IMPORT", now: now() },
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
        expiresAt: new Date(current.getTime() + DRIVER_IMPORT_TTL_MS),
      };
      const row = await saveAiWorkflowDraft(
        {
          userId: draft.ownerUserId,
          kind: "DRIVER_IMPORT",
          payload: serializeDraft(storedDraft),
          now: current,
          ttlMs: DRIVER_IMPORT_TTL_MS,
        },
        repository,
      );
      return deserializeDraft(row.payload, row.expiresAt);
    },

    async clear(context) {
      const loaded = await this.load(context);
      if (loaded.kind === "ACTIVE") {
        await clearAiWorkflowDraft(
          { userId: context.userId, kind: "DRIVER_IMPORT" },
          repository,
        );
      }
    },
  };
}

export const driverImportDraftStore = createDurableDriverImportDraftStore(
  prismaAiWorkflowDraftRepository,
);
