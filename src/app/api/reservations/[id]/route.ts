import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { parseReservationStatusCode } from "@/lib/reservationStatus";
import { logActivity } from "@/lib/activityLog";
import {
  financialDateFromMadridInstant,
  parsePositiveMoney,
} from "@/lib/drivers/financialValidation";

type RouteContext = { params: Promise<{ id: string }> };

function parseDate(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number" && !(value instanceof Date)) {
    return null;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

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

  const data: Prisma.ReservationUpdateInput = {};
  let parsedStartAt: Date | undefined;

  if ("pickupText" in body) {
    data.pickupText = String(body.pickupText ?? "").slice(0, 500) || null;
  }
  if ("dropoffText" in body) {
    data.dropoffText = String(body.dropoffText ?? "").slice(0, 500) || null;
  }
  if ("startAt" in body) {
    const startAt = parseDate(body.startAt);
    if (!startAt) return NextResponse.json({ error: "Invalid startAt" }, { status: 400 });
    data.startAt = startAt;
    parsedStartAt = startAt;
  }
  if ("endAt" in body) {
    if (!body.endAt) {
      data.endAt = null;
    } else {
      const endAt = parseDate(body.endAt);
      if (!endAt) return NextResponse.json({ error: "Invalid endAt" }, { status: 400 });
      data.endAt = endAt;
    }
  }
  if ("pax" in body) {
    const pax = Number(body.pax);
    if (!Number.isFinite(pax) || pax < 1 || pax > 99) {
      return NextResponse.json({ error: "Invalid pax" }, { status: 400 });
    }
    data.pax = pax;
  }
  if ("priceEuro" in body) {
    const priceEuro = body.priceEuro === "" || body.priceEuro == null ? null : Number(body.priceEuro);
    if (priceEuro !== null && !Number.isFinite(priceEuro)) {
      return NextResponse.json({ error: "Invalid priceEuro" }, { status: 400 });
    }
    data.priceEuro = priceEuro;
  }
  if ("phone" in body) {
    data.phone = String(body.phone ?? "").slice(0, 40) || null;
  }
  if ("flight" in body) {
    data.flight = String(body.flight ?? "").slice(0, 40) || null;
  }
  if ("notes" in body) {
    data.notes = String(body.notes ?? "").slice(0, 2000) || null;
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
          select: { id: true, driverId: true, startAt: true },
        });
        if (!current) throw new ReservationIntegrationError("Not found", 404);

        if (nextDriverId) {
          const nextDriver = await tx.driver.findUnique({
            where: { id: nextDriverId },
            select: { id: true, status: true },
          });
          if (!nextDriver) {
            throw new ReservationIntegrationError("Driver not found.", 400);
          }
          if (nextDriver.status !== "ACTIVE" && nextDriver.id !== current.driverId) {
            throw new ReservationIntegrationError(
              "Inactive drivers cannot receive new reservation assignments.",
              400,
            );
          }
        }

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

        const transactionData: Prisma.ReservationUpdateInput = { ...data };
        if (current.driverId !== nextDriverId) {
          transactionData.driver = nextDriverId
            ? { connect: { id: nextDriverId } }
            : { disconnect: true };
        }

        await tx.reservation.update({ where: { id }, data: transactionData });

        let commissionAction: IntegrationResult["commissionAction"] = null;
        if (nextDriverId && commissionAmount) {
          const changedFields: string[] = [];
          if (linkedCommission?.driverId !== nextDriverId) changedFields.push("driverId");
          if (
            linkedCommission &&
            !linkedCommission.commissionAmount.equals(commissionAmount)
          ) {
            changedFields.push("commissionAmount");
          }

          if (!linkedCommission || changedFields.length > 0) {
            const commission = await tx.commissionEntry.upsert({
              where: { reservationId: id },
              create: {
                driverId: nextDriverId,
                reservationId: id,
                commissionAmount,
                entryDate: financialDateFromMadridInstant(
                  parsedStartAt ?? current.startAt,
                ),
              },
              update: {
                driverId: nextDriverId,
                commissionAmount,
              },
              select: { id: true },
            });
            commissionAction = {
              type: linkedCommission ? "updated" : "created",
              id: commission.id,
              driverId: nextDriverId,
              changedFields: linkedCommission
                ? changedFields
                : ["driverId", "commissionAmount", "reservationId"],
            };
          }
        } else if (linkedCommission) {
          await tx.commissionEntry.delete({ where: { id: linkedCommission.id } });
          commissionAction = {
            type: "removed",
            id: linkedCommission.id,
            driverId: linkedCommission.driverId,
            changedFields: [],
          };
        }

        const driverAction: IntegrationResult["driverAction"] =
          current.driverId === nextDriverId
            ? null
            : current.driverId === null
              ? "assigned"
              : nextDriverId === null
                ? "unassigned"
                : "changed";

        return {
          previousDriverId: current.driverId,
          nextDriverId,
          driverAction,
          commissionAction,
        };
      });
    } catch (error) {
      if (error instanceof ReservationIntegrationError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
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
    await prisma.reservation.update({ where: { id }, data });
  }

  if (!hasDriverIntegration || Object.keys(data).length > 0) {
    await logActivity({
      action: "reservation_updated",
      entityType: "reservation",
      entityId: id,
      userEmail: email,
      metadata: { changedFields: Object.keys(data) },
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
