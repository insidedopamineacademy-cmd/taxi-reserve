import "server-only";

import type { PrismaClient } from "@prisma/client";
import { requireUnlockedAdmin } from "../security/adminSecurity.ts";
import type { SessionIdentity } from "../security/sessionCore.ts";
import { SecurityError } from "../security/policy.ts";

export type SoftDeleteDriverResult = {
  driverId: string;
  name: string;
  changed: boolean;
};

/**
 * Admin-only soft delete. Authorization is re-verified against the database
 * inside the transaction (current ADMIN role, ACTIVE account, unlocked Settings
 * PIN, non-revoked device session) — the client-supplied role is never trusted.
 *
 * Setting "deletedAt" hides the driver from every operational surface while
 * preserving all historical commission, payment, subscription and reservation
 * records, whose RESTRICT foreign keys deliberately forbid a hard delete. The
 * operation is idempotent: deleting an already-deleted driver reports no change
 * without writing a second audit entry.
 */
export async function softDeleteDriver(
  db: PrismaClient,
  identity: SessionIdentity,
  driverId: string,
  now = new Date(),
): Promise<SoftDeleteDriverResult> {
  return db.$transaction(async (tx) => {
    const actor = await requireUnlockedAdmin(tx, identity, now);

    // Serialize concurrent deletes of the same driver.
    await tx.$queryRaw`SELECT "id" FROM "Driver" WHERE "id" = ${driverId} FOR UPDATE`;
    const driver = await tx.driver.findUnique({
      where: { id: driverId },
      select: { id: true, name: true, licenseNumber: true, deletedAt: true },
    });
    if (!driver) throw new SecurityError(404, "DRIVER_NOT_FOUND", "Driver not found.");

    if (driver.deletedAt) {
      return { driverId: driver.id, name: driver.name, changed: false };
    }

    await tx.driver.update({ where: { id: driver.id }, data: { deletedAt: now } });
    await tx.activityLog.create({
      data: {
        action: "DRIVER_DELETED",
        entityType: "driver",
        entityId: driver.id,
        userEmail: actor.user.email,
        createdAt: now,
        metadata: {
          driverId: driver.id,
          driverName: driver.name,
          licenseNumber: driver.licenseNumber,
          actorUserId: actor.userId,
          actorEmail: actor.user.email,
          deletedAt: now.toISOString(),
        },
      },
    });

    return { driverId: driver.id, name: driver.name, changed: true };
  });
}
