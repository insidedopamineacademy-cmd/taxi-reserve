import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { getDriverAdminAccess } from "@/lib/drivers/access";
import {
  createDriverProfile,
  DriverProfileInputError,
  normalizeDriverProfileInput,
} from "@/lib/drivers/profile-core";
import { createPrismaDriverProfileRepository } from "@/lib/drivers/profile-prisma";
import { prisma } from "@/lib/prisma";

function duplicateDriverResponse() {
  return NextResponse.json(
    { error: "A driver with this name and license number already exists." },
    { status: 409 },
  );
}

export async function POST(request: Request) {
  const access = await getDriverAdminAccess();
  if (!access.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!access.authorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  let profile;
  try {
    profile = normalizeDriverProfileInput(body as Record<string, unknown>);
  } catch (error) {
    if (error instanceof DriverProfileInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  try {
    const driver = await prisma.$transaction(async (transaction) => {
      const created = await createDriverProfile(
        profile,
        createPrismaDriverProfileRepository(transaction),
      );
      await transaction.activityLog.create({
        data: {
          action: "driver_created",
          entityType: "driver",
          entityId: created.id,
          userEmail: access.email,
          metadata: {
            status: created.status,
            vehicleType: created.vehicleType,
            subscriptionExempt: created.subscriptionExempt,
          },
        },
      });
      return created;
    });

    revalidatePath("/drivers");
    revalidatePath("/drivers/overview");
    revalidatePath("/commissions");
    revalidatePath("/payments");
    return NextResponse.json({ driver }, { status: 201 });
  } catch (error) {
    if (error instanceof DriverProfileInputError) return duplicateDriverResponse();
    console.error("Driver creation failed:", error);
    return NextResponse.json({ error: "Could not create the driver." }, { status: 500 });
  }
}
