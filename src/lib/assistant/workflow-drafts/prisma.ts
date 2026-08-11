import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma.ts";
import {
  AI_WORKFLOW_DRAFT_KINDS,
  type AiWorkflowDraftKind,
  type AiWorkflowDraftRepository,
} from "./core.ts";

const draftSelect = {
  id: true,
  userId: true,
  kind: true,
  payloadJson: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AiWorkflowDraftSelect;

const kinds = new Set<string>(AI_WORKFLOW_DRAFT_KINDS);

function mapKind(kind: string): AiWorkflowDraftKind {
  if (!kinds.has(kind)) throw new Error("Stored workflow draft kind is invalid.");
  return kind as AiWorkflowDraftKind;
}

export const prismaAiWorkflowDraftRepository: AiWorkflowDraftRepository = {
  async findOwned(input) {
    const row = await prisma.aiWorkflowDraft.findUnique({
      where: { userId_kind: input },
      select: draftSelect,
    });
    return row
      ? { ...row, kind: mapKind(row.kind), payload: row.payloadJson }
      : null;
  },

  async upsertOwned(input) {
    const row = await prisma.aiWorkflowDraft.upsert({
      where: { userId_kind: { userId: input.userId, kind: input.kind } },
      create: {
        userId: input.userId,
        kind: input.kind,
        payloadJson: input.payload as Prisma.InputJsonObject,
        expiresAt: input.expiresAt,
      },
      update: {
        payloadJson: input.payload as Prisma.InputJsonObject,
        expiresAt: input.expiresAt,
      },
      select: draftSelect,
    });
    return { ...row, kind: mapKind(row.kind), payload: row.payloadJson };
  },

  async deleteOwned(input) {
    await prisma.aiWorkflowDraft.deleteMany({ where: input });
  },

  async deleteExpired(now) {
    const result = await prisma.aiWorkflowDraft.deleteMany({
      where: { expiresAt: { lte: now } },
    });
    return result.count;
  },
};
