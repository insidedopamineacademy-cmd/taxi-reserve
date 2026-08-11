import type { Prisma } from "@prisma/client";
import type { ReservationRepositoryQuery } from "./assistant-read-core.ts";

export function buildAssistantReservationWhere(
  query: ReservationRepositoryQuery,
): Prisma.ReservationWhereInput {
  return {
    userEmail: query.ownerEmail,
    isDeleted: false,
    ...(query.startAtGte || query.startAtLt
      ? {
          startAt: {
            ...(query.startAtGte ? { gte: query.startAtGte } : {}),
            ...(query.startAtLt ? { lt: query.startAtLt } : {}),
          },
        }
      : {}),
    ...(query.pickupContains
      ? { pickupText: { contains: query.pickupContains, mode: "insensitive" } }
      : {}),
    ...(query.dropoffContains
      ? { dropoffText: { contains: query.dropoffContains, mode: "insensitive" } }
      : {}),
    ...(query.phoneContains
      ? { phone: { contains: query.phoneContains, mode: "insensitive" } }
      : {}),
    ...(query.driverId
      ? { driverId: query.driverId }
      : query.assigned === true
        ? { driverId: { not: null } }
        : query.assigned === false
          ? { driverId: null }
          : {}),
    ...(query.status ? { status: query.status } : {}),
  };
}
