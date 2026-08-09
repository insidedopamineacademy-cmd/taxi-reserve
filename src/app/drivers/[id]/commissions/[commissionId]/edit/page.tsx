export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { notFound } from "next/navigation";
import CommissionForm from "@/components/drivers/CommissionForm";
import { requireDriverAdminPage } from "@/lib/drivers/access";
import { formatFinancialDateInput } from "@/lib/drivers/financialValidation";
import { prisma } from "@/lib/prisma";

type PageProps = { params: Promise<{ id: string; commissionId: string }> };

export default async function EditCommissionPage({ params }: PageProps) {
  await requireDriverAdminPage();
  const { id: driverId, commissionId } = await params;
  const commission = await prisma.commissionEntry.findFirst({
    where: { id: commissionId, driverId },
    select: {
      id: true,
      commissionAmount: true,
      entryDate: true,
      notes: true,
      driver: {
        select: { id: true, name: true, licenseNumber: true },
      },
    },
  });

  if (!commission) notFound();

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-6 sm:px-6">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-white">Edit commission</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Update this ledger entry without changing its driver or reservation relationship.
        </p>
      </div>
      <section className="rounded-xl border border-white/10 bg-[#0e1426] p-4 sm:p-5">
        <CommissionForm
          mode="edit"
          driver={commission.driver}
          initial={{
            id: commission.id,
            amount: commission.commissionAmount.toFixed(2),
            entryDate: formatFinancialDateInput(commission.entryDate),
            notes: commission.notes ?? "",
          }}
        />
      </section>
    </main>
  );
}
