// src/app/reservations/[id]/edit/page.tsx
export const revalidate = 0; // always fetch fresh data

import { prisma } from "@/lib/prisma";
import { DriverStatus } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
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

  const driverAdmin =
    session?.user?.role === "ADMIN"
      ? await (async () => {
          const [drivers, linkedCommission] = await Promise.all([
            prisma.driver.findMany({
              where: reservation.driverId
                ? {
                    OR: [
                      { status: DriverStatus.ACTIVE },
                      { id: reservation.driverId },
                    ],
                  }
                : { status: DriverStatus.ACTIVE },
              orderBy: [{ name: "asc" }, { licenseNumber: "asc" }],
              select: {
                id: true,
                name: true,
                licenseNumber: true,
                status: true,
              },
            }),
            prisma.commissionEntry.findUnique({
              where: { reservationId: reservation.id },
              select: { id: true, commissionAmount: true },
            }),
          ]);

          return {
            currentDriverId: reservation.driverId,
            commissionAmount: linkedCommission?.commissionAmount.toFixed(2) ?? "",
            hasLinkedCommission: Boolean(linkedCommission),
            drivers,
          };
        })()
      : undefined;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Edit Reservation</h1>
          <p className="mt-1 break-all text-xs text-neutral-500">
            Reservation {reservation.id}
          </p>
        </div>
        <Link
          href="/reservations"
          className="inline-flex h-11 items-center justify-center self-start rounded-md border border-white/10 px-4 text-sm font-medium text-neutral-200 hover:bg-white/5 sm:self-auto"
        >
          Back to reservations
        </Link>
      </header>
      <EditReservationForm initial={initial} driverAdmin={driverAdmin} />
    </div>
  );
}
