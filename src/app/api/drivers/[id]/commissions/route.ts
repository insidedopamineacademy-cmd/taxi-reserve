import { DriverStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activityLog";
import { getDriverAdminAccess } from "@/lib/drivers/access";
import {
  parseFinancialDate,
  parseFinancialNotes,
  parsePositiveMoney,
} from "@/lib/drivers/financialValidation";
import { parseManualCommissionRouteText } from "@/lib/drivers/commissionRoute";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const access = await getDriverAdminAccess();
  if (!access.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!access.authorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: driverId } = await params;
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: { id: true, status: true },
  });
  if (!driver) {
    return NextResponse.json({ error: "Driver not found." }, { status: 404 });
  }
  if (driver.status !== DriverStatus.ACTIVE) {
    return NextResponse.json(
      { error: "Activate this driver before adding a new commission." },
      { status: 409 },
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  const amount = parsePositiveMoney(input.amount, "Commission amount");
  if (!amount.ok) return NextResponse.json({ error: amount.error }, { status: 400 });
  const entryDate = parseFinancialDate(input.entryDate, "Entry date");
  if (!entryDate.ok) return NextResponse.json({ error: entryDate.error }, { status: 400 });
  const notes = parseFinancialNotes(input.notes);
  if (!notes.ok) return NextResponse.json({ error: notes.error }, { status: 400 });
  const manualPickupText = parseManualCommissionRouteText(input.manualPickupText, "Pickup");
  if (!manualPickupText.ok) {
    return NextResponse.json({ error: manualPickupText.error }, { status: 400 });
  }
  const manualDropoffText = parseManualCommissionRouteText(
    input.manualDropoffText,
    "Drop-off",
  );
  if (!manualDropoffText.ok) {
    return NextResponse.json({ error: manualDropoffText.error }, { status: 400 });
  }

  try {
    const commission = await prisma.commissionEntry.create({
      data: {
        driverId,
        reservationId: null,
        commissionAmount: amount.value,
        entryDate: entryDate.value,
        notes: notes.value,
        manualPickupText: manualPickupText.value,
        manualDropoffText: manualDropoffText.value,
      },
      select: { id: true, driverId: true },
    });

    await logActivity({
      action: "commission_created",
      entityType: "commission",
      entityId: commission.id,
      userEmail: access.email,
      metadata: { driverId: commission.driverId },
    });

    revalidatePath("/drivers");
    revalidatePath(`/drivers/${driverId}`);
    revalidatePath("/drivers/overview");
    revalidatePath("/commissions");
    return NextResponse.json({ commission }, { status: 201 });
  } catch (error) {
    console.error("Commission creation failed:", error);
    return NextResponse.json({ error: "Could not add the commission." }, { status: 500 });
  }
}
