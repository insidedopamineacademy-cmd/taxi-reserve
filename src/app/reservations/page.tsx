export const runtime = "nodejs";
export const revalidate = 0;

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import ReservationsListView from "@/components/ReservationsList"; // alias to avoid name clash
import type { Prisma } from "@prisma/client";

type SortMode = "asc" | "desc";
type Search = { from?: string; to?: string; sort?: SortMode };

function getSortMode(value: string | undefined): SortMode {
  return value === "desc" ? "desc" : "asc";
}

const reservationListSelect = {
  id: true,
  startAt: true,
  endAt: true,
  pickupText: true,
  dropoffText: true,
  pax: true,
  priceEuro: true,
  phone: true,
  flight: true,
  notes: true,
  status: true,
} satisfies Prisma.ReservationSelect;

export default async function ReservationsPage({
  searchParams,
}: {
  searchParams?: Promise<Search>;
}) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) redirect("/login");

  const params = (await searchParams) ?? {};
  const baseWhere: Prisma.ReservationWhereInput = { userEmail: email, isDeleted: false };
  const fromDate = params.from ? new Date(params.from + "T00:00:00") : null;
  const toDate = params.to ? new Date(params.to + "T23:59:59") : null;
  const dateRange: Prisma.DateTimeFilter = {};

  if (fromDate && Number.isFinite(fromDate.getTime())) {
    dateRange.gte = fromDate;
  }
  if (toDate && Number.isFinite(toDate.getTime())) {
    dateRange.lte = toDate;
  }

  const sort = getSortMode(params.sort);
  const where: Prisma.ReservationWhereInput =
    Object.keys(dateRange).length > 0
      ? { ...baseWhere, startAt: dateRange }
      : baseWhere;

  const reservations = await prisma.reservation.findMany({
    where,
    orderBy: { startAt: sort },
    take: 500,
    select: reservationListSelect,
  });

  const items = reservations.map((r) => ({
    id: r.id,
    startAt: r.startAt.getTime(), // epoch ms for client
    endAt: r.endAt ? r.endAt.getTime() : null,
    pickupText: r.pickupText,
    dropoffText: r.dropoffText,
    pax: r.pax,
    priceEuro: r.priceEuro,
    phone: r.phone,
    flight: r.flight,
    notes: r.notes,
    status: r.status,
  }));

  return (
    <div className="mx-auto max-w-2xl p-4">
      <h1 className="mb-4 text-2xl font-semibold">Reservations</h1>
      <ReservationsListView items={items} />
    </div>
  );
}
