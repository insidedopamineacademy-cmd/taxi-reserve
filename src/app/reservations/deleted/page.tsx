export const dynamic = "force-dynamic";

// src/app/reservations/deleted/page.tsx
export const runtime = "nodejs";
export const revalidate = 0;

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import ReservationsList from "@/components/ReservationsList";
import PermanentDeleteAllButton from "@/components/PermanentDeleteAllButton";

export default async function DeletedReservationsPage() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) redirect("/login");

  // ✅ fetch only deleted reservations
  const reservations = await prisma.reservation.findMany({
    where: { userEmail: email, isDeleted: true },
    orderBy: { startAt: "desc" },
    select: {
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
    },
  });

  // ✅ convert Dates to epoch milliseconds
  const items = reservations.map((r) => ({
    id: r.id,
    startAt: r.startAt ? r.startAt.getTime() : Date.now(),
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
    <main className="mx-auto max-w-2xl p-4">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold">Deleted Reservations</h1>
        <PermanentDeleteAllButton deletedCount={items.length} />
      </div>
      {items.length ? (
        <ReservationsList
          items={items}
          showEdit={false}
          showSoftDelete={false}
          showStatus={false}
          showSort={false}
        />
      ) : (
        <p>No deleted reservations.</p>
      )}
    </main>
  );
}
