export const runtime = "nodejs";
export const revalidate = 0;

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { redirect } from "next/navigation";
import ReservationsListView from "@/components/ReservationsList"; // alias to avoid name clash

type Search = { from?: string; to?: string; sort?: "asc" | "desc" };

export default async function ReservationsPage({
  searchParams,
}: {
  searchParams?: Search;
}) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) redirect("/login");

  const params = searchParams ?? {};
  const where: any = { userEmail: email, isDeleted: false }; // ✅ exclude deleted ones

  if (params.from || params.to) {
    where.startAt = {};
    if (params.from) where.startAt.gte = new Date(params.from + "T00:00:00");
    if (params.to) where.startAt.lte = new Date(params.to + "T23:59:59");
  }

  const sortDir: "asc" | "desc" = params.sort === "asc" ? "asc" : "desc";

  const reservations = await prisma.reservation.findMany({
    where,
    orderBy: { startAt: sortDir },
    take: 500,
    select: {
      id: true,
      startAt: true,
      pickupText: true,
      dropoffText: true,
      pax: true,
      priceEuro: true,
      phone: true,
      flight: true,
      notes: true,
    },
  });

  const items = reservations.map((r) => ({
    id: r.id,
    startAt: r.startAt.getTime(), // epoch ms for client
    endAt: null as number | null,
    pickupText: r.pickupText,
    dropoffText: r.dropoffText,
    pax: r.pax,
    priceEuro: r.priceEuro,
    phone: r.phone,
    flight: r.flight,
    notes: r.notes,
  }));

  return (
    <div className="mx-auto max-w-2xl p-4">
      <h1 className="mb-4 text-2xl font-semibold">Reservations</h1>
      <ReservationsListView items={items} />
    </div>
  );
}
