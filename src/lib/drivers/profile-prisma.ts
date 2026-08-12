import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DriverProfileRepository } from "./profile-core";

const driverProfileSelect = {
  id: true,
  name: true,
  licenseNumber: true,
  vehicleType: true,
  subscriptionExempt: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.DriverSelect;

type DriverDatabase = PrismaClient | Prisma.TransactionClient;

export function createPrismaDriverProfileRepository(
  database: DriverDatabase = prisma,
): DriverProfileRepository {
  return {
    findByIdentity(input) {
      return database.driver.findFirst({
        where: {
          name: { equals: input.name, mode: "insensitive" },
          licenseNumber: { equals: input.licenseNumber, mode: "insensitive" },
        },
        select: driverProfileSelect,
      });
    },

    create(profile) {
      return database.driver.create({ data: profile, select: driverProfileSelect });
    },
  };
}
