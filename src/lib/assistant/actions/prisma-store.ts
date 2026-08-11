import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  assertJsonObject,
  parseAiActionPreview,
  parseAiActionResult,
  type JsonObject,
} from "./contracts";
import type {
  AiPendingActionRecord,
  AiPendingActionStore,
  AiPendingActionUpdate,
} from "./core";

export type AiActionTransaction = Prisma.TransactionClient;

const actionSelect = {
  id: true,
  userId: true,
  actionType: true,
  riskLevel: true,
  status: true,
  payloadJson: true,
  previewJson: true,
  preconditionJson: true,
  confirmationLabel: true,
  idempotencyKey: true,
  expiresAt: true,
  confirmedAt: true,
  executedAt: true,
  resultJson: true,
  failureCode: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AiPendingActionSelect;

type ActionRow = Prisma.AiPendingActionGetPayload<{ select: typeof actionSelect }>;

function mapAction(row: ActionRow): AiPendingActionRecord {
  assertJsonObject(row.payloadJson, "Stored AI action payload");
  assertJsonObject(row.preconditionJson, "Stored AI action precondition");
  return {
    id: row.id,
    userId: row.userId,
    actionType: row.actionType,
    riskLevel: row.riskLevel,
    status: row.status,
    payload: row.payloadJson,
    preview: parseAiActionPreview(row.previewJson),
    precondition: row.preconditionJson,
    confirmationLabel: row.confirmationLabel,
    idempotencyKey: row.idempotencyKey,
    expiresAt: row.expiresAt,
    confirmedAt: row.confirmedAt,
    executedAt: row.executedAt,
    result: row.resultJson === null ? null : parseAiActionResult(row.resultJson),
    failureCode: row.failureCode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function updateData(update: AiPendingActionUpdate): Prisma.AiPendingActionUpdateManyMutationInput {
  const data: Prisma.AiPendingActionUpdateManyMutationInput = {};
  if (update.status !== undefined) data.status = update.status;
  if (update.confirmedAt !== undefined) data.confirmedAt = update.confirmedAt;
  if (update.executedAt !== undefined) data.executedAt = update.executedAt;
  if (update.failureCode !== undefined) data.failureCode = update.failureCode;
  if (update.result !== undefined) {
    data.resultJson = update.result === null
      ? Prisma.DbNull
      : (update.result as Prisma.InputJsonObject);
  }
  return data;
}

export const prismaAiPendingActionStore: AiPendingActionStore<AiActionTransaction> = {
  transaction(callback) {
    return prisma.$transaction(callback, { maxWait: 5_000, timeout: 15_000 });
  },

  async findCanonicalActor(transaction, identity) {
    const user = await transaction.user.findFirst({
      where: {
        id: identity.userId,
        email: identity.email.trim().toLowerCase(),
      },
      select: { id: true, email: true, role: true },
    });
    return user
      ? { userId: user.id, email: user.email, role: user.role }
      : null;
  },

  async findAction(transaction, actionId) {
    const row = await transaction.aiPendingAction.findUnique({
      where: { id: actionId },
      select: actionSelect,
    });
    return row ? mapAction(row) : null;
  },

  async createAction(transaction, action) {
    const row = await transaction.aiPendingAction.create({
      data: {
        userId: action.userId,
        actionType: action.actionType,
        riskLevel: action.riskLevel,
        status: action.status,
        payloadJson: action.payload as Prisma.InputJsonObject,
        previewJson: action.preview as Prisma.InputJsonObject,
        preconditionJson: action.precondition as Prisma.InputJsonObject,
        confirmationLabel: action.confirmationLabel,
        idempotencyKey: action.idempotencyKey,
        expiresAt: action.expiresAt,
        confirmedAt: action.confirmedAt,
        executedAt: action.executedAt,
        failureCode: action.failureCode,
      },
      select: actionSelect,
    });
    return mapAction(row);
  },

  async transitionAction(transaction, input) {
    const updated = await transaction.aiPendingAction.updateMany({
      where: {
        id: input.actionId,
        userId: input.userId,
        status: input.from,
        ...(input.expiresAfter ? { expiresAt: { gt: input.expiresAfter } } : {}),
      },
      data: updateData(input.update),
    });
    return updated.count === 1;
  },

  async createActivityLog(transaction, input) {
    await transaction.activityLog.create({
      data: {
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        userEmail: input.userEmail.trim().toLowerCase(),
        metadata: input.metadata as Prisma.InputJsonObject,
      },
    });
  },
};

export function aiActionAuditMetadata(input: JsonObject) {
  assertJsonObject(input, "AI action audit metadata");
  return input;
}
