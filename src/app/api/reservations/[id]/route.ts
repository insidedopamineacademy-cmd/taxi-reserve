import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { parseReservationStatusCode } from "@/lib/reservationStatus";

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
  if (!email) return { email: null, found: false };

  const reservation = await prisma.reservation.findFirst({
    where: { id, userEmail: email, isDeleted: false },
    select: { id: true },
  });

  return { email, found: Boolean(reservation) };
}

export async function PATCH(req: Request, { params }: RouteContext) {
  const { id } = await params;
  const { email, found } = await requireOwnedActiveReservation(id);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const data: Prisma.ReservationUpdateInput = {};

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

  await prisma.reservation.update({ where: { id }, data });

  revalidatePath("/reservations");
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

  revalidatePath("/reservations");
  return NextResponse.json({ ok: true, message: "Moved to deleted list" });
}
