// src/app/reservations/[id]/edit/page.tsx
export const revalidate = 0; // always fetch fresh data

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import EditReservationForm from "./EditReservationForm";

type PageProps = { params: Promise<{ id: string }> };

export default async function EditReservationPage({ params }: PageProps) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) redirect("/login");

  // Security: only fetch if it belongs to the logged-in user
  const reservation = await prisma.reservation.findFirst({
    where: { id, userEmail: email, isDeleted: false },
  });

  if (!reservation) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6">
        <h1 className="text-lg font-semibold">Reservation not found</h1>
      </div>
    );
  }

  // Make props fully serializable for the client form
  const initial = {
    ...reservation,
    startAt: reservation.startAt?.toISOString() ?? null,
    endAt: reservation.endAt ? reservation.endAt.toISOString() : null,
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 space-y-4">
      <h1 className="text-xl font-semibold">Edit Reservation</h1>
      <EditReservationForm initial={initial} />
    </div>
  );
}
