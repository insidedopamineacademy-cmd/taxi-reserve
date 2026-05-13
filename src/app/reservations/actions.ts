// src/app/reservations/actions.ts
"use server";

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  parseReservationStatusCode,
  type EditableReservationStatusCode,
  type ReservationStatusLabel,
} from "@/lib/reservationStatus";

export type ReservationStatus = ReservationStatusLabel;

async function getUserEmailBySession() {
  const session = await getServerSession(authOptions);
  return session?.user?.email ?? null;
}

/**
 * Update a single reservation's editable fields.
 * Ownership is validated by userEmail.
 *
 * `status` accepts either UI labels (e.g., "Pending")
 * or DB codes (e.g., "PENDING").
 */
export async function updateReservationField(
  id: string,
  patch: {
    notes?: string | null;
    pax?: number;
    driver?: string | null;
    status?: ReservationStatus | EditableReservationStatusCode | "R_RECEIVED";
  }
) {
  const email = await getUserEmailBySession();
  if (!email) throw new Error("Unauthorized");

  const owned = await prisma.reservation.findFirst({
    where: { id, userEmail: email, isDeleted: false },
    select: { id: true },
  });
  if (!owned) throw new Error("Not found");

  const data: Record<string, unknown> = {};

  if ("notes" in patch) {
    const text = (patch.notes ?? "").toString().slice(0, 2000);
    data.notes = text.length ? text : null;
  }

  if ("pax" in patch) {
    const n = Number(patch.pax);
    if (!Number.isFinite(n) || n < 1 || n > 99) throw new Error("Invalid pax");
    data.pax = n;
  }

  if ("driver" in patch) {
    const v = (patch.driver ?? "").toString().trim();
    if (v.length > 100) throw new Error("Driver too long");
    data.driver = v || null;
  }

  if (typeof patch.status !== "undefined") {
    const asDb = parseReservationStatusCode(patch.status);
    if (!asDb) throw new Error("Invalid status");
    data.status = asDb;
  }

  await prisma.reservation.update({ where: { id }, data });
  return { ok: true };
}
