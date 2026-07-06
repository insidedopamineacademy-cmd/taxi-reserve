import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(_req: Request, { params }: RouteContext) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;

  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await prisma.reservation.updateMany({
    where: {
      id,
      userEmail: email,
      isDeleted: true,
    },
    data: {
      isDeleted: false,
    },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await logActivity({
    action: "reservation_updated",
    entityType: "reservation",
    entityId: id,
    userEmail: email,
    metadata: { changedFields: ["isDeleted"], operation: "restore" },
  });

  revalidatePath("/reservations");
  revalidatePath("/reservations/deleted");
  return NextResponse.json({ ok: true, restored: result.count });
}
