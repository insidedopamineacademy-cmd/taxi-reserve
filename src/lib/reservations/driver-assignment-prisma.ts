import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type {
  DriverAssignmentRepository,
  ReservationDriverAssignmentSnapshot,
} from "./driver-assignment-core";

const assignmentDriverSelect = {
  id: true,
  name: true,
  status: true,
  vehicleType: true,
  updatedAt: true,
} satisfies Prisma.DriverSelect;

const assignmentReservationSelect = {
  id: true,
  userEmail: true,
  isDeleted: true,
  updatedAt: true,
  startAt: true,
  pickupText: true,
  dropoffText: true,
  driverId: true,
  driver: { select: assignmentDriverSelect },
  commissionEntries: {
    take: 1,
    select: {
      id: true,
      driverId: true,
      reservationId: true,
      commissionAmount: true,
      entryDate: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.ReservationSelect;

type AssignmentReservationRow = Prisma.ReservationGetPayload<{
  select: typeof assignmentReservationSelect;
}>;
type AssignmentDb = PrismaClient | Prisma.TransactionClient;

function mapReservation(
  row: AssignmentReservationRow,
): ReservationDriverAssignmentSnapshot {
  return {
    id: row.id,
    userEmail: row.userEmail,
    isDeleted: row.isDeleted,
    updatedAt: row.updatedAt,
    startAt: row.startAt,
    pickupText: row.pickupText,
    dropoffText: row.dropoffText,
    driverId: row.driverId,
    driver: row.driver,
    linkedCommission: row.commissionEntries[0]
      ? {
          ...row.commissionEntries[0],
          reservationId: row.commissionEntries[0].reservationId ?? row.id,
          commissionAmount: row.commissionEntries[0].commissionAmount.toFixed(2),
        }
      : null,
  };
}

export function createPrismaDriverAssignmentRepository(
  database: AssignmentDb = prisma,
): DriverAssignmentRepository {
  return {
    async findOwnedActive(input) {
      const row = await database.reservation.findFirst({
        where: {
          id: input.reservationId,
          userEmail: input.ownerEmail,
          isDeleted: false,
        },
        select: assignmentReservationSelect,
      });
      return row ? mapReservation(row) : null;
    },
    async findById(reservationId) {
      const row = await database.reservation.findUnique({
        where: { id: reservationId },
        select: assignmentReservationSelect,
      });
      return row ? mapReservation(row) : null;
    },
    findDriver(driverId) {
      return database.driver.findUnique({
        where: { id: driverId },
        select: assignmentDriverSelect,
      });
    },
    async updateOwnedActiveDriver(input) {
      const result = await database.reservation.updateMany({
        where: {
          id: input.reservationId,
          userEmail: input.ownerEmail,
          isDeleted: false,
          updatedAt: input.expectedUpdatedAt,
          driverId: input.expectedDriverId,
          ...(input.requireNoLinkedCommission
            ? { commissionEntries: { none: {} } }
            : {}),
        },
        data: { driverId: input.nextDriverId },
      });
      return result.count === 1;
    },
  };
}
