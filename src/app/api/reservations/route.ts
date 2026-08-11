export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  createOwnedReservation,
  normalizeReservationCreationInput,
  ReservationCreationInputError,
} from "@/lib/reservations/creation-core";
import { createPrismaReservationCreationRepository } from "@/lib/reservations/creation-prisma";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email?.trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    let normalized;
    try {
      normalized = normalizeReservationCreationInput(
        body as Record<string, unknown>,
        { allowStatusOverride: true },
      );
    } catch (error) {
      if (error instanceof ReservationCreationInputError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    const created = await prisma.$transaction(async (transaction) => {
      const reservation = await createOwnedReservation(
        { ownerEmail: email, reservation: normalized },
        createPrismaReservationCreationRepository(transaction),
      );
      await transaction.activityLog.create({
        data: {
          action: "reservation_created",
          entityType: "reservation",
          entityId: reservation.id,
          userEmail: email,
          metadata: {
            status: reservation.status,
            pax: reservation.pax,
          },
        },
      });
      return reservation;
    });

    return NextResponse.json({ ok: true, reservation: created }, { status: 201 });
  } catch (error) {
    console.error("POST /api/reservations error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
