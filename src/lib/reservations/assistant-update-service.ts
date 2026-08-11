import "server-only";

import type { ReservationAccessContext } from "./assistant-read-core";
import type { PrepareReservationUpdateArguments } from "./update-core";
import {
  prepareReservationUpdateProposal,
  type PrepareReservationUpdateResult,
} from "./assistant-update-core";
import { createPrismaReservationUpdateRepository } from "./update-prisma";
import { prepareAssistantAction } from "../assistant/actions/service";

export type { PrepareReservationUpdateResult } from "./assistant-update-core";

export function prepareReservationUpdateAction(
  context: ReservationAccessContext,
  input: PrepareReservationUpdateArguments,
): Promise<PrepareReservationUpdateResult> {
  const repository = createPrismaReservationUpdateRepository();
  return prepareReservationUpdateProposal(context, input, {
    findOwnedActive: repository.findOwnedActive,
    prepareAction: prepareAssistantAction,
  });
}
