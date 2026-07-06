import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type ActivityLogInput = {
  action: string;
  entityType: string;
  entityId?: string | null;
  userEmail?: string | null;
  metadata?: Prisma.InputJsonValue;
};

/**
 * Best-effort activity logging. Audit failures are reported, but never allowed
 * to interrupt the user action that triggered them.
 */
export async function logActivity({
  action,
  entityType,
  entityId,
  userEmail,
  metadata,
}: ActivityLogInput): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        action,
        entityType,
        entityId: entityId ?? null,
        userEmail: userEmail?.trim().toLowerCase() || null,
        ...(metadata === undefined ? {} : { metadata }),
      },
    });
  } catch (error) {
    console.error("Activity logging failed:", error);
  }
}
