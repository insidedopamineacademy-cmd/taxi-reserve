export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import CommissionsList from "@/components/drivers/CommissionsList";
import DriverEntryLauncher from "@/components/drivers/DriverEntryLauncher";
import { requireDriverAdminPage } from "@/lib/drivers/access";
import { resolveCommissionRoute } from "@/lib/drivers/commissionRoute";
import {
  formatFinancialDateDisplay,
  formatFinancialDateInput,
} from "@/lib/drivers/financialValidation";
import { formatEuro } from "@/lib/drivers/financials";
import { prisma } from "@/lib/prisma";

export default async function CommissionsPage() {
  await requireDriverAdminPage();
  const [commissions, activeDrivers] = await Promise.all([
    prisma.commissionEntry.findMany({
      orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        commissionAmount: true,
        entryDate: true,
        notes: true,
        manualPickupText: true,
        manualDropoffText: true,
        driver: { select: { id: true, name: true } },
        reservation: {
          select: { id: true, pickupText: true, dropoffText: true },
        },
      },
    }),
    prisma.driver.findMany({
      where: { status: "ACTIVE" },
      orderBy: [{ name: "asc" }, { licenseNumber: "asc" }],
      select: { id: true, name: true, licenseNumber: true },
    }),
  ]);

  const items = commissions.map((commission) => {
    const route = resolveCommissionRoute(commission);
    return {
      id: commission.id,
      driverId: commission.driver.id,
      driverName: commission.driver.name,
      dateLabel: formatFinancialDateDisplay(commission.entryDate),
      dateSearch: formatFinancialDateInput(commission.entryDate),
      pickupText: route.pickupText,
      dropoffText: route.dropoffText,
      amount: formatEuro(commission.commissionAmount),
      source: route.source,
      reservationId: route.reservationId,
      notes: commission.notes,
    };
  });

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Commissions</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Review reservation-linked and manual driver commissions.
        </p>
      </div>
      <DriverEntryLauncher drivers={activeDrivers} kind="commission" />
      <CommissionsList items={items} />
    </main>
  );
}
