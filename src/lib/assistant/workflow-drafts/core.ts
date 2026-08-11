export const AI_WORKFLOW_DRAFT_TTL_MS = 15 * 60 * 1_000;
export const AI_WORKFLOW_DRAFT_MAX_JSON_BYTES = 64 * 1_024;

export const AI_WORKFLOW_DRAFT_KINDS = [
  "RESERVATION_CREATE",
  "DRIVER_IMPORT",
] as const;

export type AiWorkflowDraftKind = (typeof AI_WORKFLOW_DRAFT_KINDS)[number];

export type AiWorkflowDraftRow = {
  id: string;
  userId: string;
  kind: AiWorkflowDraftKind;
  payload: unknown;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type AiWorkflowDraftRepository = {
  findOwned(input: {
    userId: string;
    kind: AiWorkflowDraftKind;
  }): Promise<AiWorkflowDraftRow | null>;
  upsertOwned(input: {
    userId: string;
    kind: AiWorkflowDraftKind;
    payload: Record<string, unknown>;
    expiresAt: Date;
  }): Promise<AiWorkflowDraftRow>;
  deleteOwned(input: {
    userId: string;
    kind: AiWorkflowDraftKind;
  }): Promise<void>;
  deleteExpired(now: Date): Promise<number>;
};

export type AiWorkflowDraftLoadResult =
  | { kind: "ACTIVE"; row: AiWorkflowDraftRow }
  | { kind: "EXPIRED" }
  | { kind: "MISSING" };

export class AiWorkflowDraftInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiWorkflowDraftInputError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateJson(value: unknown, depth: number): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (depth >= 10) return false;
  if (Array.isArray(value)) {
    return value.length <= 200 && value.every((entry) => validateJson(entry, depth + 1));
  }
  if (!isRecord(value) || Object.keys(value).length > 200) return false;
  return Object.entries(value).every(
    ([key, entry]) => key.length > 0 && key.length <= 100 && validateJson(entry, depth + 1),
  );
}

export function assertAiWorkflowDraftPayload(
  value: unknown,
): asserts value is Record<string, unknown> {
  if (!isRecord(value) || !validateJson(value, 0)) {
    throw new AiWorkflowDraftInputError("Workflow draft payload is malformed.");
  }
  const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (bytes > AI_WORKFLOW_DRAFT_MAX_JSON_BYTES) {
    throw new AiWorkflowDraftInputError("Workflow draft payload is too large.");
  }
}

function validIdentity(userId: string) {
  if (!userId.trim() || userId.length > 200) {
    throw new AiWorkflowDraftInputError("Workflow draft owner is invalid.");
  }
}

export async function loadAiWorkflowDraft(
  input: {
    userId: string;
    kind: AiWorkflowDraftKind;
    now?: Date;
  },
  repository: AiWorkflowDraftRepository,
): Promise<AiWorkflowDraftLoadResult> {
  validIdentity(input.userId);
  const now = input.now ?? new Date();
  const row = await repository.findOwned({ userId: input.userId, kind: input.kind });
  if (!row) return { kind: "MISSING" };
  if (row.userId !== input.userId || row.kind !== input.kind) {
    return { kind: "MISSING" };
  }
  if (row.expiresAt.getTime() <= now.getTime()) {
    await repository.deleteOwned({ userId: input.userId, kind: input.kind });
    return { kind: "EXPIRED" };
  }
  assertAiWorkflowDraftPayload(row.payload);
  return { kind: "ACTIVE", row };
}

export async function saveAiWorkflowDraft(
  input: {
    userId: string;
    kind: AiWorkflowDraftKind;
    payload: Record<string, unknown>;
    now?: Date;
    ttlMs?: number;
  },
  repository: AiWorkflowDraftRepository,
) {
  validIdentity(input.userId);
  assertAiWorkflowDraftPayload(input.payload);
  const now = input.now ?? new Date();
  const ttlMs = input.ttlMs ?? AI_WORKFLOW_DRAFT_TTL_MS;
  if (!Number.isInteger(ttlMs) || ttlMs < 60_000 || ttlMs > AI_WORKFLOW_DRAFT_TTL_MS) {
    throw new AiWorkflowDraftInputError("Workflow draft TTL is invalid.");
  }
  await repository.deleteExpired(now);
  return repository.upsertOwned({
    userId: input.userId,
    kind: input.kind,
    payload: input.payload,
    expiresAt: new Date(now.getTime() + ttlMs),
  });
}

export async function clearAiWorkflowDraft(
  input: { userId: string; kind: AiWorkflowDraftKind },
  repository: AiWorkflowDraftRepository,
) {
  validIdentity(input.userId);
  await repository.deleteOwned(input);
}
