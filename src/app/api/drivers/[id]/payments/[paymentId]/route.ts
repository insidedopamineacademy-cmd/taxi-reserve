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

type RouteContext = { params: Promise<{ id: string; paymentId: string }> };

function revalidateDriverLedger(driverId: string) {
  revalidatePath("/drivers");
  revalidatePath(`/drivers/${driverId}`);
  revalidatePath("/drivers/overview");
  revalidatePath("/payments");
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const access = await getDriverAdminAccess();
  if (!access.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!access.authorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: driverId, paymentId } = await params;
  const current = await prisma.driverPayment.findFirst({
    where: { id: paymentId, driverId },
    select: { id: true, amount: true, paymentDate: true, method: true, notes: true },
  });
  if (!current) {
    return NextResponse.json({ error: "Payment not found." }, { status: 404 });
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

  const changedFields: string[] = [];
  if (!current.amount.equals(amount.value)) changedFields.push("amount");
  if (current.paymentDate.getTime() !== paymentDate.value.getTime()) {
    changedFields.push("paymentDate");
  }
  if (current.method !== method.value) changedFields.push("method");
  if (current.notes !== notes.value) changedFields.push("notes");

  if (changedFields.length === 0) {
    return NextResponse.json({ payment: { id: current.id, driverId } });
  }

  try {
    const payment = await prisma.driverPayment.update({
      where: { id: current.id },
      data: {
        amount: amount.value,
        paymentDate: paymentDate.value,
        method: method.value,
        notes: notes.value,
      },
      select: { id: true, driverId: true },
    });

    await logActivity({
      action: "driver_payment_updated",
      entityType: "driver_payment",
      entityId: payment.id,
      userEmail: access.email,
      metadata: { driverId, changedFields },
    });

    revalidateDriverLedger(driverId);
    return NextResponse.json({ payment });
  } catch (error) {
    console.error("Driver payment update failed:", error);
    return NextResponse.json({ error: "Could not update the payment." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const access = await getDriverAdminAccess();
  if (!access.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!access.authorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: driverId, paymentId } = await params;

  try {
    const result = await prisma.driverPayment.deleteMany({
      where: { id: paymentId, driverId },
    });
    if (result.count === 0) {
      return NextResponse.json({ error: "Payment not found." }, { status: 404 });
    }

    await logActivity({
      action: "driver_payment_deleted",
      entityType: "driver_payment",
      entityId: paymentId,
      userEmail: access.email,
      metadata: { driverId },
    });

    revalidateDriverLedger(driverId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Driver payment deletion failed:", error);
    return NextResponse.json({ error: "Could not delete the payment." }, { status: 500 });
  }
}
