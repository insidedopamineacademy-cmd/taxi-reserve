import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type {
  CommissionAwareAssignmentRepository,
  NormalizedCommissionAwareAssignmentOperation,
} from "./commission-aware-assignment-core";
import type { ReservationDriverAssignmentSnapshot } from "./driver-assignment-core";

const driverSelect = {
  id: true,
  name: true,
  status: true,
  vehicleType: true,
  updatedAt: true,
} satisfies Prisma.DriverSelect;

const reservationSelect = {
  id: true,
  userEmail: true,
  isDeleted: true,
  updatedAt: true,
  startAt: true,
  pickupText: true,
  dropoffText: true,
  driverId: true,
  driver: { select: driverSelect },
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

type ReservationRow = Prisma.ReservationGetPayload<{ select: typeof reservationSelect }>;
type AssignmentDb = PrismaClient | Prisma.TransactionClient;

function mapReservation(row: ReservationRow): ReservationDriverAssignmentSnapshot {
  const linked = row.commissionEntries[0];
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
    linkedCommission: linked
      ? {
          id: linked.id,
          driverId: linked.driverId,
          reservationId: linked.reservationId ?? row.id,
          commissionAmount: linked.commissionAmount.toFixed(2),
          entryDate: linked.entryDate,
          updatedAt: linked.updatedAt,
        }
      : null,
  };
}

function targetConnect(targetDriverId: string, targetDriverUpdatedAt: Date) {
  return {
    id: targetDriverId,
    status: "ACTIVE" as const,
    updatedAt: targetDriverUpdatedAt,
  };
}

function operationData(
  operation: NormalizedCommissionAwareAssignmentOperation,
  expected: ReservationDriverAssignmentSnapshot,
): Prisma.ReservationUpdateInput {
  const linked = expected.linkedCommission;
  if (operation.kind === "ASSIGN_WITH_COMMISSION") {
    const driver = targetConnect(
      operation.targetDriverId,
      operation.targetDriverUpdatedAt,
    );
    return {
      driver: { connect: driver },
      commissionEntries: linked
        ? {
            update: {
              where: { id: linked.id },
              data: {
                driver: { connect: driver },
                commissionAmount: new Prisma.Decimal(operation.commissionAmount),
              },
            },
          }
        : {
            create: {
              driver: { connect: driver },
              commissionAmount: new Prisma.Decimal(operation.commissionAmount),
              entryDate: operation.createEntryDate,
            },
          },
    };
  }
  if (operation.kind === "UPDATE_COMMISSION") {
    return {
      commissionEntries: {
        update: {
          where: { id: linked!.id },
          data: { commissionAmount: new Prisma.Decimal(operation.commissionAmount) },
        },
      },
    };
  }
  if (operation.kind === "CLEAR_WITH_COMMISSION") {
    return {
      driver: { disconnect: true },
      commissionEntries: { delete: { id: linked!.id } },
    };
  }
  if (operation.kind === "ASSIGN_WITHOUT_COMMISSION") {
    return {
      driver: {
        connect: targetConnect(
          operation.targetDriverId,
          operation.targetDriverUpdatedAt,
        ),
      },
    };
  }
  if (operation.kind === "ASSIGN_AND_REMOVE_COMMISSION") {
    return {
      driver: {
        connect: targetConnect(
          operation.targetDriverId,
          operation.targetDriverUpdatedAt,
        ),
      },
      commissionEntries: { delete: { id: linked!.id } },
    };
  }
  return { driver: { disconnect: true } };
}

function expectedCommissionWhere(expected: ReservationDriverAssignmentSnapshot) {
  const linked = expected.linkedCommission;
  return linked
    ? {
        some: {
          id: linked.id,
          driverId: linked.driverId,
          reservationId: linked.reservationId,
          commissionAmount: new Prisma.Decimal(linked.commissionAmount),
          entryDate: linked.entryDate,
          updatedAt: linked.updatedAt,
        },
      }
    : { none: {} };
}

export function createPrismaCommissionAwareAssignmentRepository(
  database: AssignmentDb = prisma,
): CommissionAwareAssignmentRepository {
  return {
    async findOwnedActive(input) {
      const row = await database.reservation.findFirst({
        where: {
          id: input.reservationId,
          userEmail: input.ownerEmail,
          isDeleted: false,
        },
        select: reservationSelect,
      });
      return row ? mapReservation(row) : null;
    },

    async findById(reservationId) {
      const row = await database.reservation.findUnique({
        where: { id: reservationId },
        select: reservationSelect,
      });
      return row ? mapReservation(row) : null;
    },

    findDriver(driverId) {
      return database.driver.findUnique({ where: { id: driverId }, select: driverSelect });
    },

    async applyAtomic(input) {
      try {
        const row = await database.reservation.update({
          where: {
            id: input.reservationId,
            userEmail: input.ownerEmail,
            isDeleted: false,
            updatedAt: input.expected.updatedAt,
            driverId: input.expected.driverId,
            commissionEntries: expectedCommissionWhere(input.expected),
          },
          data: operationData(input.operation, input.expected),
          select: reservationSelect,
        });
        return mapReservation(row);
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === "P2002" || error.code === "P2025")
        ) {
          return null;
        }
        throw error;
      }
    },
  };
}
