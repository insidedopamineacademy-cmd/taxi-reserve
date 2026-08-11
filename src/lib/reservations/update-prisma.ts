import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OwnedReservationUpdateRepository } from "./update-service";

const updateSnapshotSelect = {
  id: true,
  userEmail: true,
  isDeleted: true,
  updatedAt: true,
  pickupText: true,
  dropoffText: true,
  startAt: true,
  endAt: true,
  pax: true,
  phone: true,
  flight: true,
  notes: true,
} satisfies Prisma.ReservationSelect;

type ReservationDb = PrismaClient | Prisma.TransactionClient;

export function createPrismaReservationUpdateRepository(
  database: ReservationDb = prisma,
): OwnedReservationUpdateRepository {
  return {
    findOwnedActive(input) {
      return database.reservation.findFirst({
        where: {
          id: input.reservationId,
          userEmail: input.ownerEmail,
          isDeleted: false,
        },
        select: updateSnapshotSelect,
      });
    },
    async updateOwnedActive(input) {
      const data: Prisma.ReservationUpdateManyMutationInput = {
        ...(input.patch as Prisma.ReservationUpdateManyMutationInput),
      };
      const result = await database.reservation.updateMany({
        where: {
          id: input.reservationId,
          userEmail: input.ownerEmail,
          isDeleted: false,
          ...(input.expectedUpdatedAt ? { updatedAt: input.expectedUpdatedAt } : {}),
        },
        data,
      });
      return result.count === 1;
    },
    findById(reservationId) {
      return database.reservation.findUnique({
        where: { id: reservationId },
        select: updateSnapshotSelect,
      });
    },
  };
}
