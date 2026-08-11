import "server-only";

import type {
  PrepareAssignDriverWithCommissionArguments,
  PrepareClearDriverAndCommissionArguments,
  PrepareUpdateReservationCommissionArguments,
} from "../assistant/tools/commission-aware-assignment-contracts";
import { prepareAssistantAction } from "../assistant/actions/service";
import type { ReservationAccessContext } from "./assistant-read-core";
import {
  prepareAssignDriverWithCommissionProposal,
  prepareClearDriverAndCommissionProposal,
  prepareUpdateReservationCommissionProposal,
  type PrepareCommissionAwareAssignmentResult,
} from "./assistant-commission-aware-assignment-core";
import { createPrismaCommissionAwareAssignmentRepository } from "./commission-aware-assignment-prisma";

export type { PrepareCommissionAwareAssignmentResult } from "./assistant-commission-aware-assignment-core";

function dependencies() {
  const repository = createPrismaCommissionAwareAssignmentRepository();
  return {
    findOwnedActive: repository.findOwnedActive,
    findDriver: repository.findDriver,
    prepareAction: prepareAssistantAction,
  };
}

export function prepareAssignDriverWithCommissionAction(
  context: ReservationAccessContext,
  input: PrepareAssignDriverWithCommissionArguments,
): Promise<PrepareCommissionAwareAssignmentResult> {
  return prepareAssignDriverWithCommissionProposal(context, input, dependencies());
}

export function prepareUpdateReservationCommissionAction(
  context: ReservationAccessContext,
  input: PrepareUpdateReservationCommissionArguments,
): Promise<PrepareCommissionAwareAssignmentResult> {
  return prepareUpdateReservationCommissionProposal(context, input, dependencies());
}

export function prepareClearDriverAndCommissionAction(
  context: ReservationAccessContext,
  input: PrepareClearDriverAndCommissionArguments,
): Promise<PrepareCommissionAwareAssignmentResult> {
  return prepareClearDriverAndCommissionProposal(context, input, dependencies());
}
