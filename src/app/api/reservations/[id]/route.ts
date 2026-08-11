import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { parseReservationStatusCode } from "@/lib/reservationStatus";
import { logActivity } from "@/lib/activityLog";
import { parsePositiveMoney } from "@/lib/drivers/financialValidation";
import {
  parseReservationUiUpdate,
  reservationUpdateChangedFields,
  ReservationUpdateInputError,
} from "@/lib/reservations/update-core";
import {
  OwnedReservationConflictError,
  OwnedReservationNotFoundError,
  updateOwnedReservation,
} from "@/lib/reservations/update-service";
import { createPrismaReservationUpdateRepository } from "@/lib/reservations/update-prisma";
import {
  CommissionAwareAssignmentInputError,
  CommissionAwareCommissionRequiredError,
  CommissionAwareConflictError,
  CommissionAwareDriverInactiveError,
  CommissionAwareDriverNotFoundError,
  CommissionAwareInconsistentStateError,
  CommissionAwareReservationNotFoundError,
  CommissionAwareUnexpectedCommissionError,
  changeOwnedReservationDriverAndCommission,
  type CommissionAwareAssignmentOperation,
} from "@/lib/reservations/commission-aware-assignment-core";
import { createPrismaCommissionAwareAssignmentRepository } from "@/lib/reservations/commission-aware-assignment-prisma";

type RouteContext = { params: Promise<{ id: string }> };

async function requireOwnedActiveReservation(id: string) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return { email: null, found: false, isAdmin: false };

  const reservation = await prisma.reservation.findFirst({
    where: { id, userEmail: email, isDeleted: false },
    select: { id: true },
  });

  return {
    email,
    found: Boolean(reservation),
    isAdmin: session?.user?.role === "ADMIN",
  };
}

class ReservationIntegrationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function PATCH(req: Request, { params }: RouteContext) {
  const { id } = await params;
  const { email, found, isAdmin } = await requireOwnedActiveReservation(id);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let reservationPatch;
  try {
    reservationPatch = parseReservationUiUpdate(body as Record<string, unknown>);
  } catch (error) {
    if (error instanceof ReservationUpdateInputError) {
      const field = error.field === "passengers" ? "pax" : error.field;
      return NextResponse.json({ error: `Invalid ${field || "reservation update"}` }, { status: 400 });
    }
    throw error;
  }
  const data: Prisma.ReservationUpdateInput = {};
  if ("priceEuro" in body) {
    const priceEuro = body.priceEuro === "" || body.priceEuro == null ? null : Number(body.priceEuro);
    if (priceEuro !== null && !Number.isFinite(priceEuro)) {
      return NextResponse.json({ error: "Invalid priceEuro" }, { status: 400 });
    }
    data.priceEuro = priceEuro;
  }
  if ("status" in body) {
    const status = parseReservationStatusCode(body.status);
    if (!status) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    data.status = status;
  }

  const hasDriverIntegration = "driverId" in body || "commissionAmount" in body;
  let nextDriverId: string | null = null;
  let commissionAmount: Prisma.Decimal | null = null;
  let confirmCommissionRemoval = false;

  if (hasDriverIntegration) {
    if (!isAdmin) {
      return NextResponse.json(
        { error: "Driver assignment and commissions are restricted to administrators." },
        { status: 403 },
      );
    }
    if (!("driverId" in body) || !("commissionAmount" in body)) {
      return NextResponse.json(
        { error: "Driver and commission values must be submitted together." },
        { status: 400 },
      );
    }

    if (body.driverId === null || body.driverId === "") {
      nextDriverId = null;
    } else if (typeof body.driverId === "string" && body.driverId.trim()) {
      nextDriverId = body.driverId.trim();
    } else {
      return NextResponse.json({ error: "Select a valid driver." }, { status: 400 });
    }

    const hasCommissionAmount =
      body.commissionAmount !== null &&
      body.commissionAmount !== undefined &&
      String(body.commissionAmount).trim() !== "";
    if (hasCommissionAmount) {
      const amount = parsePositiveMoney(body.commissionAmount, "Commission");
      if (!amount.ok) {
        return NextResponse.json({ error: amount.error }, { status: 400 });
      }
      commissionAmount = amount.value;
    }

    if (!nextDriverId && commissionAmount) {
      return NextResponse.json(
        { error: "Select a driver before entering a commission." },
        { status: 400 },
      );
    }

    confirmCommissionRemoval = body.confirmCommissionRemoval === true;
  }

  type IntegrationResult = {
    previousDriverId: string | null;
    nextDriverId: string | null;
    driverAction: "assigned" | "changed" | "unassigned" | null;
    commissionAction: {
      type: "created" | "updated" | "removed";
      id: string;
      driverId: string;
      changedFields: string[];
    } | null;
  };

  let integrationResult: IntegrationResult | null = null;

  if (hasDriverIntegration) {
    try {
      integrationResult = await prisma.$transaction(async (tx) => {
        const current = await tx.reservation.findFirst({
          where: { id, userEmail: email, isDeleted: false },
          select: { id: true, driverId: true },
        });
        if (!current) throw new ReservationIntegrationError("Not found", 404);

        const linkedCommission = await tx.commissionEntry.findUnique({
          where: { reservationId: id },
          select: {
            id: true,
            driverId: true,
            commissionAmount: true,
          },
        });
        const removesLinkedCommission =
          Boolean(linkedCommission) && (!nextDriverId || !commissionAmount);
        if (removesLinkedCommission && !confirmCommissionRemoval) {
          throw new ReservationIntegrationError(
            "Confirm removal of the reservation-linked commission before saving.",
            409,
          );
        }

        if (Object.keys(reservationPatch).length > 0) {
          await updateOwnedReservation(
            { reservationId: id, ownerEmail: email, patch: reservationPatch },
            createPrismaReservationUpdateRepository(tx),
          );
        }

        if (Object.keys(data).length > 0) {
          await tx.reservation.update({ where: { id }, data });
        }

        let operation: CommissionAwareAssignmentOperation;
        if (nextDriverId && commissionAmount) {
          operation =
            current.driverId === nextDriverId &&
              linkedCommission?.driverId === nextDriverId
              ? {
                  kind: "UPDATE_COMMISSION",
                  commissionAmount: commissionAmount.toFixed(2),
                }
              : {
                  kind: "ASSIGN_WITH_COMMISSION",
                  targetDriverId: nextDriverId,
                  commissionAmount: commissionAmount.toFixed(2),
                };
        } else if (nextDriverId && linkedCommission) {
          operation = {
            kind: "ASSIGN_AND_REMOVE_COMMISSION",
            targetDriverId: nextDriverId,
          };
        } else if (nextDriverId) {
          operation = { kind: "ASSIGN_WITHOUT_COMMISSION", targetDriverId: nextDriverId };
        } else if (linkedCommission) {
          operation = { kind: "CLEAR_WITH_COMMISSION" };
        } else {
          operation = { kind: "CLEAR_WITHOUT_COMMISSION" };
        }

        const mutation = await changeOwnedReservationDriverAndCommission(
          {
            reservationId: id,
            ownerEmail: email,
            operation,
          },
          createPrismaCommissionAwareAssignmentRepository(tx),
        );

        let commissionAction: IntegrationResult["commissionAction"] = null;
        if (mutation.commissionMutation !== "NONE") {
          const commission = mutation.after.linkedCommission ?? mutation.before.linkedCommission!;
          const changedFields = mutation.commissionMutation === "CREATED"
            ? ["driverId", "commissionAmount", "reservationId"]
            : mutation.commissionMutation === "MOVED"
              ? [
                  "driverId",
                  ...(mutation.before.linkedCommission?.commissionAmount !==
                  mutation.after.linkedCommission?.commissionAmount
                    ? ["commissionAmount"]
                    : []),
                ]
              : mutation.commissionMutation === "UPDATED"
                ? ["commissionAmount"]
                : [];
          commissionAction = {
            type: mutation.commissionMutation === "CREATED"
              ? "created"
              : mutation.commissionMutation === "REMOVED"
                ? "removed"
                : "updated",
            id: commission.id,
            driverId: commission.driverId,
            changedFields,
          };
        }

        const driverAction: IntegrationResult["driverAction"] =
          mutation.before.driverId === mutation.after.driverId
            ? null
            : mutation.before.driverId === null
              ? "assigned"
              : mutation.after.driverId === null
                ? "unassigned"
                : "changed";

        return {
          previousDriverId: mutation.before.driverId,
          nextDriverId: mutation.after.driverId,
          driverAction,
          commissionAction,
        };
      });
    } catch (error) {
      if (error instanceof ReservationIntegrationError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      if (error instanceof OwnedReservationNotFoundError) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      if (error instanceof OwnedReservationConflictError) {
        return NextResponse.json({ error: "Reservation changed. Refresh and try again." }, { status: 409 });
      }
      if (error instanceof CommissionAwareReservationNotFoundError) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      if (error instanceof CommissionAwareDriverNotFoundError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (error instanceof CommissionAwareDriverInactiveError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (
        error instanceof CommissionAwareConflictError ||
        error instanceof CommissionAwareCommissionRequiredError ||
        error instanceof CommissionAwareUnexpectedCommissionError ||
        error instanceof CommissionAwareInconsistentStateError
      ) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      if (error instanceof CommissionAwareAssignmentInputError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return NextResponse.json(
          { error: "This reservation already has a linked commission. Refresh and try again." },
          { status: 409 },
        );
      }

      console.error("Reservation driver integration failed:", error);
      return NextResponse.json(
        { error: "Could not save the driver assignment and commission." },
        { status: 500 },
      );
    }
  } else {
    try {
      await prisma.$transaction(async (tx) => {
        if (Object.keys(reservationPatch).length > 0) {
          await updateOwnedReservation(
            { reservationId: id, ownerEmail: email, patch: reservationPatch },
            createPrismaReservationUpdateRepository(tx),
          );
        }
        if (Object.keys(data).length > 0) {
          await tx.reservation.update({ where: { id }, data });
        }
      });
    } catch (error) {
      if (error instanceof OwnedReservationNotFoundError) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      if (error instanceof OwnedReservationConflictError) {
        return NextResponse.json({ error: "Reservation changed. Refresh and try again." }, { status: 409 });
      }
      throw error;
    }
  }

  const changedFields = [
    ...reservationUpdateChangedFields(reservationPatch),
    ...Object.keys(data),
  ];
  if (!hasDriverIntegration || changedFields.length > 0) {
    await logActivity({
      action: "reservation_updated",
      entityType: "reservation",
      entityId: id,
      userEmail: email,
      metadata: { changedFields },
    });
  }

  if (integrationResult?.driverAction) {
    await logActivity({
      action: `reservation_driver_${integrationResult.driverAction}`,
      entityType: "reservation",
      entityId: id,
      userEmail: email,
      metadata: {
        previousDriverId: integrationResult.previousDriverId,
        driverId: integrationResult.nextDriverId,
      },
    });
  }

  if (integrationResult?.commissionAction) {
    const commission = integrationResult.commissionAction;
    await logActivity({
      action: `reservation_commission_${commission.type}`,
      entityType: "commission",
      entityId: commission.id,
      userEmail: email,
      metadata: {
        reservationId: id,
        driverId: commission.driverId,
        ...(commission.changedFields.length > 0
          ? { changedFields: commission.changedFields }
          : {}),
      },
    });
  }

  revalidatePath("/reservations");
  if (integrationResult) {
    revalidatePath("/drivers");
    revalidatePath("/drivers/overview");
    revalidatePath("/commissions");
    if (integrationResult.previousDriverId) {
      revalidatePath(`/drivers/${integrationResult.previousDriverId}`);
    }
    if (integrationResult.nextDriverId) {
      revalidatePath(`/drivers/${integrationResult.nextDriverId}`);
    }
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  const { id } = await params;
  const { email, found } = await requireOwnedActiveReservation(id);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.reservation.update({
    where: { id },
    data: { isDeleted: true },
  });

  await logActivity({
    action: "reservation_deleted",
    entityType: "reservation",
    entityId: id,
    userEmail: email,
    metadata: { deletionType: "soft" },
  });

  revalidatePath("/reservations");
  return NextResponse.json({ ok: true, message: "Moved to deleted list" });
}
