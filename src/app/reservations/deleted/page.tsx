export const dynamic = "force-dynamic";

// src/app/reservations/deleted/page.tsx
export const runtime = "nodejs";
export const revalidate = 0;

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { redirect } from "next/navigation";
import ReservationsList from "@/components/ReservationsList";

export default async function DeletedReservationsPage() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) redirect("/login");

  // ✅ fetch only deleted reservations
  const reservations = await prisma.reservation.findMany({
    where: { userEmail: email, isDeleted: true },
    orderBy: { startAt: "desc" },
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
  }));

  return (
    <main style={{ padding: "20px" }}>
      <h1 style={{ fontSize: "24px", marginBottom: "10px" }}>🗑️ Deleted Reservations</h1>
      {items.length ? (
        <ReservationsList items={items} />
      ) : (
        <p>No deleted reservations.</p>
      )}
    </main>
  );
}
