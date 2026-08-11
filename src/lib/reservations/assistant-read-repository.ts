import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type {
  ReservationReadRepository,
  ReservationReadRow,
} from "./assistant-read-core";
import { buildAssistantReservationWhere } from "./assistant-read-prisma";

const assistantReservationSelect = {
  id: true,
  startAt: true,
  pickupText: true,
  dropoffText: true,
  pax: true,
  phone: true,
  flight: true,
  status: true,
  driverId: true,
  driver: { select: { id: true, name: true } },
} satisfies Prisma.ReservationSelect;

export const prismaAssistantReservationRepository: ReservationReadRepository = {
  async search(query) {
    const where = buildAssistantReservationWhere(query);

    return prisma.reservation.findMany({
      where,
      orderBy: [{ startAt: "asc" }, { id: "asc" }],
      take: query.limit,
      select: assistantReservationSelect,
    }) as Promise<ReservationReadRow[]>;
  },

  async getById({ ownerEmail, reservationId }) {
    return prisma.reservation.findFirst({
      where: {
        id: reservationId,
        userEmail: ownerEmail,
        isDeleted: false,
      },
      select: assistantReservationSelect,
    }) as Promise<ReservationReadRow | null>;
  },
};
