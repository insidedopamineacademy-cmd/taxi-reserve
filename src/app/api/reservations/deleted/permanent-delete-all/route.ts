import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";

export async function DELETE() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;

  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await prisma.reservation.deleteMany({
      where: {
        userEmail: email,
        isDeleted: true,
      },
    });

    if (result.count > 0) {
      await logActivity({
        action: "reservation_deleted",
        entityType: "reservation",
        userEmail: email,
        metadata: { deletionType: "permanent_bulk", count: result.count },
      });
    }

    return NextResponse.json({ ok: true, deleted: result.count });
  } catch (error) {
    console.error("Permanent delete failed:", error);
    return NextResponse.json(
      { error: "Failed to permanently delete reservations" },
      { status: 500 },
    );
  }
}
