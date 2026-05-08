export const runtime = "nodejs";
export const revalidate = 0;

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import ReservationsListView from "@/components/ReservationsList"; // alias to avoid name clash
import type { Prisma, ResStatus } from "@prisma/client";

type SortMode = "closest" | "asc" | "desc";
type Search = { from?: string; to?: string; sort?: SortMode };
type ReservationForList = {
  id: string;
  startAt: Date;
  endAt: Date | null;
  pickupText: string | null;
  dropoffText: string | null;
  pax: number;
  priceEuro: number | null;
  phone: string | null;
  flight: string | null;
  notes: string | null;
  status: ResStatus;
};

function getSortMode(value: string | undefined): SortMode {
  return value === "asc" || value === "desc" ? value : "closest";
}

function getStartTime(row: ReservationForList) {
  const time = row.startAt.getTime();
  return Number.isFinite(time) ? time : null;
}

function sortByClosestDate(rows: ReservationForList[]) {
  const now = Date.now();

  return [...rows].sort((a, b) => {
    const aTime = getStartTime(a);
    const bTime = getStartTime(b);

    if (aTime === null && bTime === null) return 0;
    if (aTime === null) return 1;
    if (bTime === null) return -1;

    const aUpcoming = aTime >= now;
    const bUpcoming = bTime >= now;

    if (aUpcoming && bUpcoming) return aTime - bTime;
    if (aUpcoming) return -1;
    if (bUpcoming) return 1;

    return bTime - aTime;
  });
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
  const sortDir: "asc" | "desc" = sort === "desc" ? "desc" : "asc";
  const where: Prisma.ReservationWhereInput =
    Object.keys(dateRange).length > 0
      ? { ...baseWhere, startAt: dateRange }
      : baseWhere;

  const reservations =
    sort === "closest"
      ? await getClosestReservations(baseWhere, dateRange)
      : await prisma.reservation.findMany({
          where,
          orderBy: { startAt: sortDir },
          take: 500,
          select: reservationListSelect,
        });

  const sortedReservations =
    sort === "closest" ? sortByClosestDate(reservations) : reservations;

  const items = sortedReservations.map((r) => ({
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

async function getClosestReservations(
  baseWhere: Prisma.ReservationWhereInput,
  dateRange: Prisma.DateTimeFilter,
) {
  const now = new Date();
  const dateRangeGte = dateRange.gte instanceof Date ? dateRange.gte : null;
  const upcomingStartAt: Prisma.DateTimeFilter = {
    ...dateRange,
    gte: dateRangeGte && dateRangeGte > now ? dateRangeGte : now,
  };
  const pastStartAt: Prisma.DateTimeFilter = {
    ...dateRange,
    lt: now,
  };

  const [upcoming, past] = await Promise.all([
    prisma.reservation.findMany({
      where: { ...baseWhere, startAt: upcomingStartAt },
      orderBy: { startAt: "asc" },
      take: 500,
      select: reservationListSelect,
    }),
    prisma.reservation.findMany({
      where: { ...baseWhere, startAt: pastStartAt },
      orderBy: { startAt: "desc" },
      take: 500,
      select: reservationListSelect,
    }),
  ]);

  return [...upcoming, ...past].slice(0, 500);
}
