import { DriverStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activityLog";
import { getDriverAdminAccess } from "@/lib/drivers/access";
import {
  parseFinancialDate,
  parseFinancialNotes,
  parsePaymentMethod,
  parsePositiveMoney,
} from "@/lib/drivers/financialValidation";
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
      { error: "Activate this driver before recording a new payment." },
      { status: 409 },
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  const amount = parsePositiveMoney(input.amount, "Payment amount");
  if (!amount.ok) return NextResponse.json({ error: amount.error }, { status: 400 });
  const paymentDate = parseFinancialDate(input.paymentDate, "Payment date");
  if (!paymentDate.ok) {
    return NextResponse.json({ error: paymentDate.error }, { status: 400 });
  }
  const method = parsePaymentMethod(input.method);
  if (!method.ok) return NextResponse.json({ error: method.error }, { status: 400 });
  const notes = parseFinancialNotes(input.notes);
  if (!notes.ok) return NextResponse.json({ error: notes.error }, { status: 400 });

  try {
    const payment = await prisma.driverPayment.create({
      data: {
        driverId,
        paymentDate: paymentDate.value,
        amount: amount.value,
        method: method.value,
        notes: notes.value,
      },
      select: { id: true, driverId: true, method: true },
    });

    await logActivity({
      action: "driver_payment_created",
      entityType: "driver_payment",
      entityId: payment.id,
      userEmail: access.email,
      metadata: { driverId: payment.driverId, method: payment.method },
    });

    revalidatePath("/drivers");
    revalidatePath(`/drivers/${driverId}`);
    revalidatePath("/drivers/overview");
    revalidatePath("/payments");
    return NextResponse.json({ payment }, { status: 201 });
  } catch (error) {
    console.error("Driver payment creation failed:", error);
    return NextResponse.json({ error: "Could not record the payment." }, { status: 500 });
  }
}
