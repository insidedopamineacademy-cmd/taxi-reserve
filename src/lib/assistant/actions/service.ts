import "server-only";

import { randomUUID } from "node:crypto";
import {
  cancelAiPendingAction,
  confirmAiPendingAction,
  prepareAiPendingAction,
  type AiSessionIdentity,
} from "./core";
import type { AiActionPreview, AiActionType, JsonObject } from "./contracts";
import { aiActionExecutors } from "./executors";
import { prismaAiPendingActionStore } from "./prisma-store";

export function prepareAssistantAction(input: {
  session: AiSessionIdentity;
  actionType: AiActionType;
  payload: JsonObject;
  preview: AiActionPreview;
  precondition: JsonObject;
  confirmationLabel: string;
}) {
  return prepareAiPendingAction(input, {
    store: prismaAiPendingActionStore,
    createIdempotencyKey: randomUUID,
  });
}

export function confirmAssistantAction(input: {
  session: AiSessionIdentity;
  actionId: string;
}) {
  return confirmAiPendingAction(input, {
    store: prismaAiPendingActionStore,
    executors: aiActionExecutors,
  });
}

export function cancelAssistantAction(input: {
  session: AiSessionIdentity;
  actionId: string;
}) {
  return cancelAiPendingAction(input, { store: prismaAiPendingActionStore });
}
