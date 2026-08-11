import "server-only";

import type {
  PrepareAssignDriverArguments,
  PrepareClearDriverArguments,
} from "../assistant/tools/driver-assignment-contracts";
import { prepareAssistantAction } from "../assistant/actions/service";
import type { ReservationAccessContext } from "./assistant-read-core";
import {
  prepareAssignDriverProposal,
  prepareClearDriverProposal,
  type PrepareDriverAssignmentResult,
} from "./assistant-driver-assignment-core";
import { createPrismaDriverAssignmentRepository } from "./driver-assignment-prisma";

export type { PrepareDriverAssignmentResult } from "./assistant-driver-assignment-core";

export function prepareAssignDriverAction(
  context: ReservationAccessContext,
  input: PrepareAssignDriverArguments,
): Promise<PrepareDriverAssignmentResult> {
  const repository = createPrismaDriverAssignmentRepository();
  return prepareAssignDriverProposal(context, input, {
    findOwnedActive: repository.findOwnedActive,
    findDriver: repository.findDriver,
    prepareAction: prepareAssistantAction,
  });
}

export function prepareClearDriverAction(
  context: ReservationAccessContext,
  input: PrepareClearDriverArguments,
): Promise<PrepareDriverAssignmentResult> {
  const repository = createPrismaDriverAssignmentRepository();
  return prepareClearDriverProposal(context, input, {
    findOwnedActive: repository.findOwnedActive,
    findDriver: repository.findDriver,
    prepareAction: prepareAssistantAction,
  });
}
