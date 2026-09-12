import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { getDriverAdminAccess } from "@/lib/drivers/access";
import {
  deleteDriverPayment,
  DriverPaymentError,
  editDriverPaymentMetadata,
} from "@/lib/drivers/paymentAllocationCore";
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
    const payment = await editDriverPaymentMetadata(prisma, access.email!, driverId, {
      paymentId,
      amount: amount.value,
      paymentDate: paymentDate.value,
      method: method.value,
      notes: notes.value,
    });

    revalidateDriverLedger(driverId);
    return NextResponse.json({ payment });
  } catch (error) {
    if (error instanceof DriverPaymentError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
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
    const result = await deleteDriverPayment(prisma, access.email!, driverId, paymentId);

    revalidateDriverLedger(driverId);
    return NextResponse.json({ ok: true, changed: result.changed });
  } catch (error) {
    if (error instanceof DriverPaymentError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Driver payment deletion failed:", error);
    return NextResponse.json({ error: "Could not delete the payment." }, { status: 500 });
  }
}
