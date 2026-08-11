import "server-only";

import type { AiActionExecutor, AiActionExecutorRegistry } from "./core";
import type { AiActionTransaction } from "./prisma-store";
import { createUpdateReservationExecutor } from "./reservation-update-executor";
import { createPrismaReservationUpdateRepository } from "../../reservations/update-prisma";
import { createDriverAssignmentExecutor } from "./driver-assignment-executors";
import { createPrismaDriverAssignmentRepository } from "../../reservations/driver-assignment-prisma";
import { createCommissionAwareAssignmentExecutor } from "./commission-aware-assignment-executors";
import { createPrismaCommissionAwareAssignmentRepository } from "../../reservations/commission-aware-assignment-prisma";
import { createReservationCreationExecutor } from "./reservation-creation-executor";
import { createPrismaReservationCreationRepository } from "../../reservations/creation-prisma";
import { createDriverImportExecutor } from "./driver-import-executor";
import { createPrismaDriverImportMutationRepository } from "../../drivers/import-mutation-prisma";

const updateReservationExecutor = createUpdateReservationExecutor(
  createPrismaReservationUpdateRepository,
);
const nonFinancialAssignDriverExecutor = createDriverAssignmentExecutor(
  "ASSIGN_DRIVER",
  createPrismaDriverAssignmentRepository,
);
const nonFinancialClearDriverExecutor = createDriverAssignmentExecutor(
  "CLEAR_DRIVER",
  createPrismaDriverAssignmentRepository,
);
const financialAssignDriverExecutor = createCommissionAwareAssignmentExecutor(
  "ASSIGN_DRIVER",
  createPrismaCommissionAwareAssignmentRepository,
);
const financialClearDriverExecutor = createCommissionAwareAssignmentExecutor(
  "CLEAR_DRIVER",
  createPrismaCommissionAwareAssignmentRepository,
);
const updateReservationCommissionExecutor = createCommissionAwareAssignmentExecutor(
  "UPDATE_RESERVATION_COMMISSION",
  createPrismaCommissionAwareAssignmentRepository,
);
const createReservationExecutor = createReservationCreationExecutor(
  createPrismaReservationCreationRepository,
);
const importDriversExecutor = createDriverImportExecutor(
  createPrismaDriverImportMutationRepository,
);

function assignmentVariantExecutor<Transaction>(input: {
  isFinancial(payload: Record<string, unknown>): boolean;
  nonFinancial: AiActionExecutor<Transaction>;
  financial: AiActionExecutor<Transaction>;
}): AiActionExecutor<Transaction> {
  return {
    checkPreconditions(context) {
      return input.isFinancial(context.action.payload)
        ? input.financial.checkPreconditions(context)
        : input.nonFinancial.checkPreconditions(context);
    },
    execute(context) {
      return input.isFinancial(context.action.payload)
        ? input.financial.execute(context)
        : input.nonFinancial.execute(context);
    },
  };
}

const assignDriverExecutor = assignmentVariantExecutor({
  isFinancial: (payload) => "commissionAmount" in payload,
  nonFinancial: nonFinancialAssignDriverExecutor,
  financial: financialAssignDriverExecutor,
});
const clearDriverExecutor = assignmentVariantExecutor({
  isFinancial: (payload) => "removesCommission" in payload,
  nonFinancial: nonFinancialClearDriverExecutor,
  financial: financialClearDriverExecutor,
});

// These are the complete Phase 2F business executors. Prepare is model-facing;
// confirmation remains application-controlled and is never exposed as a tool.
export const aiActionExecutors: AiActionExecutorRegistry<AiActionTransaction> = {
  UPDATE_RESERVATION: updateReservationExecutor,
  ASSIGN_DRIVER: assignDriverExecutor,
  CLEAR_DRIVER: clearDriverExecutor,
  UPDATE_RESERVATION_COMMISSION: updateReservationCommissionExecutor,
  CREATE_RESERVATION: createReservationExecutor,
  IMPORT_DRIVERS: importDriversExecutor,
};
