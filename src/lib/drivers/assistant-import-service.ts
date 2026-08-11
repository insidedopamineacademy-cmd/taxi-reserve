import "server-only";

import { randomUUID } from "node:crypto";
import { cancelAssistantAction, prepareAssistantAction } from "../assistant/actions/service";
import type { ReservationAccessContext } from "../reservations/assistant-read-core";
import {
  applyDriverImportClarification,
  parseDriverListDraft,
  prepareDriverImportProposal,
} from "./assistant-import-core";
import type {
  DriverImportDraftUpdateArguments,
  PrepareDriverImportArguments,
} from "./import-core";
import { toPublicDriverImportDraft } from "./import-core";
import { createPrismaDriverImportExistingRepository } from "./import-prisma";
import { driverImportDraftStore } from "./import-store";

const repository = createPrismaDriverImportExistingRepository();

const dependencies = {
  store: driverImportDraftStore,
  repository,
  createDraftId: randomUUID,
  createRowId: () => randomUUID(),
  cancelPendingAction: cancelAssistantAction,
};

export function parseDriverListTextAction(
  context: ReservationAccessContext,
  currentUserMessage: string,
) {
  return parseDriverListDraft(context, currentUserMessage, dependencies);
}

export function updateDriverImportDraftAction(
  context: ReservationAccessContext,
  input: DriverImportDraftUpdateArguments,
) {
  return applyDriverImportClarification(context, input, dependencies);
}

export function prepareDriverImportAction(
  context: ReservationAccessContext,
  input: PrepareDriverImportArguments,
) {
  return prepareDriverImportProposal(context, input, {
    ...dependencies,
    prepareAction: prepareAssistantAction,
  });
}

export async function getCurrentDriverImportDraft(context: ReservationAccessContext) {
  const loaded = await driverImportDraftStore.load(context);
  return loaded.kind === "ACTIVE" ? toPublicDriverImportDraft(loaded.draft) : null;
}
