import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ReservationCreationRepository } from "./creation-core";

const creationSelect = {
  id: true,
  userEmail: true,
  isDeleted: true,
  startAt: true,
  pickupText: true,
  dropoffText: true,
  pax: true,
  priceEuro: true,
  phone: true,
  flight: true,
  notes: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ReservationSelect;

type ReservationDb = PrismaClient | Prisma.TransactionClient;

export function createPrismaReservationCreationRepository(
  database: ReservationDb = prisma,
): ReservationCreationRepository {
  return {
    create(input) {
      return database.reservation.create({
        data: {
          userEmail: input.ownerEmail,
          ...input.reservation,
        },
        select: creationSelect,
      });
    },

    findLikelyDuplicate(input) {
      if (!input.reservation.phone) return Promise.resolve(null);
      return database.reservation.findFirst({
        where: {
          userEmail: input.ownerEmail,
          isDeleted: false,
          startAt: input.reservation.startAt,
          phone: input.reservation.phone,
          pickupText: input.reservation.pickupText,
          dropoffText: input.reservation.dropoffText,
        },
        orderBy: { createdAt: "asc" },
        select: creationSelect,
      });
    },
  };
}
