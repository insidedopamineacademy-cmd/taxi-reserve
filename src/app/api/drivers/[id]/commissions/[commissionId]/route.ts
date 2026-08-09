import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activityLog";
import { getDriverAdminAccess } from "@/lib/drivers/access";
import {
  parseFinancialDate,
  parseFinancialNotes,
  parsePositiveMoney,
} from "@/lib/drivers/financialValidation";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string; commissionId: string }> };

function revalidateDriverLedger(driverId: string) {
  revalidatePath("/drivers");
  revalidatePath(`/drivers/${driverId}`);
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const access = await getDriverAdminAccess();
  if (!access.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!access.authorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: driverId, commissionId } = await params;
  const current = await prisma.commissionEntry.findFirst({
    where: { id: commissionId, driverId },
    select: {
      id: true,
      commissionAmount: true,
      entryDate: true,
      notes: true,
    },
  });
  if (!current) {
    return NextResponse.json({ error: "Commission not found." }, { status: 404 });
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

  const changedFields: string[] = [];
  if (!current.commissionAmount.equals(amount.value)) changedFields.push("commissionAmount");
  if (current.entryDate.getTime() !== entryDate.value.getTime()) changedFields.push("entryDate");
  if (current.notes !== notes.value) changedFields.push("notes");

  if (changedFields.length === 0) {
    return NextResponse.json({ commission: { id: current.id, driverId } });
  }

  try {
    const commission = await prisma.commissionEntry.update({
      where: { id: current.id },
      data: {
        commissionAmount: amount.value,
        entryDate: entryDate.value,
        notes: notes.value,
      },
      select: { id: true, driverId: true },
    });

    await logActivity({
      action: "commission_updated",
      entityType: "commission",
      entityId: commission.id,
      userEmail: access.email,
      metadata: { driverId, changedFields },
    });

    revalidateDriverLedger(driverId);
    return NextResponse.json({ commission });
  } catch (error) {
    console.error("Commission update failed:", error);
    return NextResponse.json({ error: "Could not update the commission." }, { status: 500 });
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

  const { id: driverId, commissionId } = await params;

  try {
    const result = await prisma.commissionEntry.deleteMany({
      where: { id: commissionId, driverId },
    });
    if (result.count === 0) {
      return NextResponse.json({ error: "Commission not found." }, { status: 404 });
    }

    await logActivity({
      action: "commission_deleted",
      entityType: "commission",
      entityId: commissionId,
      userEmail: access.email,
      metadata: { driverId },
    });

    revalidateDriverLedger(driverId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Commission deletion failed:", error);
    return NextResponse.json({ error: "Could not delete the commission." }, { status: 500 });
  }
}
