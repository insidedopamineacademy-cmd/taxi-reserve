import "server-only";

import type { Prisma } from "@prisma/client";
import type { AiActionTransaction } from "../assistant/actions/prisma-store";
import type { DriverImportMutationRepository } from "./import-action-core";
import { createPrismaDriverImportExistingRepository } from "./import-prisma";

const profileSelect = {
  id: true,
  name: true,
  licenseNumber: true,
  vehicleType: true,
  status: true,
  subscriptionExempt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.DriverSelect;

export function createPrismaDriverImportMutationRepository(
  transaction: AiActionTransaction,
): DriverImportMutationRepository {
  const reads = createPrismaDriverImportExistingRepository(transaction);
  return {
    findCandidates: reads.findCandidates,

    create(profile) {
      return transaction.driver.create({ data: profile, select: profileSelect });
    },

    async updateVehicleType(input) {
      const updated = await transaction.driver.updateMany({
        where: {
          id: input.current.id,
          name: input.current.name,
          licenseNumber: input.current.licenseNumber,
          vehicleType: input.current.vehicleType,
          status: input.current.status,
          subscriptionExempt: input.current.subscriptionExempt,
          updatedAt: input.current.updatedAt,
        },
        data: { vehicleType: input.vehicleType },
      });
      if (updated.count !== 1) return null;
      return transaction.driver.findUnique({
        where: { id: input.current.id },
        select: profileSelect,
      });
    },

    async createActivity(input) {
      await transaction.activityLog.create({
        data: {
          action: input.action,
          entityType: "driver",
          entityId: input.driverId,
          userEmail: input.userEmail.trim().toLowerCase(),
          metadata: input.metadata as Prisma.InputJsonObject,
        },
      });
    },
  };
}
