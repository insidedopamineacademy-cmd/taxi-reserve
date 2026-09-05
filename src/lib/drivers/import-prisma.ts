import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { sortDriversByName } from "./driverOrder";
import { prisma } from "@/lib/prisma";
import type { DriverImportExistingRepository } from "./import-core";

const importDriverSelect = {
  id: true,
  name: true,
  licenseNumber: true,
  vehicleType: true,
  status: true,
  subscriptionExempt: true,
  updatedAt: true,
} satisfies Prisma.DriverSelect;

type DriverDatabase = PrismaClient | Prisma.TransactionClient;

export function createPrismaDriverImportExistingRepository(
  database: DriverDatabase = prisma,
): DriverImportExistingRepository {
  return {
    async findCandidates(input) {
      const ors: Prisma.DriverWhereInput[] = [
        ...input.licenseNumbers.map((licenseNumber) => ({
          licenseNumber: { equals: licenseNumber, mode: "insensitive" as const },
        })),
        ...input.names.map((name) => ({
          name: { equals: name, mode: "insensitive" as const },
        })),
      ];
      if (ors.length === 0) return [];
      const candidates = await database.driver.findMany({
        where: { OR: ors },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: importDriverSelect,
      });
      return sortDriversByName(candidates).slice(0, 200);
    },
  };
}
