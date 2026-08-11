import "server-only";

import { randomUUID } from "node:crypto";
import { cancelAssistantAction, prepareAssistantAction } from "../assistant/actions/service";
import type {
  ParseReservationTextArguments,
} from "../assistant/tools/reservation-creation-contracts";
import type { ReservationAccessContext } from "./assistant-read-core";
import {
  applyReservationDraftClarification,
  parseReservationTextDraft,
  prepareCreateReservationProposal,
} from "./assistant-creation-core";
import type {
  PrepareCreateReservationArguments,
  ReservationDraftUpdateArguments,
} from "./reservation-draft-core";
import { toPublicReservationDraft } from "./reservation-draft-core";
import { reservationDraftStore } from "./reservation-draft-store";
import { createPrismaReservationCreationRepository } from "./creation-prisma";

const draftDependencies = {
  store: reservationDraftStore,
  createId: randomUUID,
  cancelPendingAction: cancelAssistantAction,
};

export function parseReservationTextAction(
  context: ReservationAccessContext,
  input: ParseReservationTextArguments,
) {
  return parseReservationTextDraft(context, input.booking_text, draftDependencies);
}

export function updateReservationDraftAction(
  context: ReservationAccessContext,
  input: ReservationDraftUpdateArguments,
) {
  return applyReservationDraftClarification(context, input, draftDependencies);
}

export function prepareCreateReservationAction(
  context: ReservationAccessContext,
  input: PrepareCreateReservationArguments,
) {
  return prepareCreateReservationProposal(context, input, {
    store: reservationDraftStore,
    repository: createPrismaReservationCreationRepository(),
    prepareAction: prepareAssistantAction,
    cancelPendingAction: cancelAssistantAction,
  });
}

export async function getCurrentReservationDraft(context: ReservationAccessContext) {
  const loaded = await reservationDraftStore.load(context);
  return loaded.kind === "ACTIVE" ? toPublicReservationDraft(loaded.draft) : null;
}
