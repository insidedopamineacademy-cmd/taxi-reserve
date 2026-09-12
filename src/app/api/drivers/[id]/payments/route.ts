import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { getDriverAdminAccess } from "@/lib/drivers/access";
import { DriverPaymentError, recordDriverPayment } from "@/lib/drivers/paymentAllocationCore";
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
    const result = await recordDriverPayment(prisma, access.email!, {
      driverId,
      paymentDate: paymentDate.value,
      amount: amount.value,
      method: method.value,
      notes: notes.value,
    });

    revalidatePath("/drivers");
    revalidatePath(`/drivers/${driverId}`);
    revalidatePath("/drivers/overview");
    revalidatePath("/payments");
    return NextResponse.json({
      payment: result.payment,
      allocation: {
        subscriptions: result.allocation.subscriptions.map((entry) => ({
          subscriptionChargeId: entry.subscriptionChargeId,
          chargeMonth: entry.chargeMonth.toISOString().slice(0, 7),
          amount: entry.amount.toFixed(2),
        })),
        commissionAmount: result.allocation.commissionAmount.toFixed(2),
      },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof DriverPaymentError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Driver payment creation failed:", error);
    return NextResponse.json({ error: "Could not record the payment." }, { status: 500 });
  }
}
