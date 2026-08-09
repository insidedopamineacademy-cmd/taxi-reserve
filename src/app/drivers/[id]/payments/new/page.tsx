export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import Link from "next/link";
import { notFound } from "next/navigation";
import PaymentForm from "@/components/drivers/PaymentForm";
import { requireDriverAdminPage } from "@/lib/drivers/access";
import { currentFinancialDateInput } from "@/lib/drivers/financialValidation";
import { prisma } from "@/lib/prisma";

type PageProps = { params: Promise<{ id: string }> };

export default async function NewPaymentPage({ params }: PageProps) {
  await requireDriverAdminPage();
  const { id } = await params;
  const driver = await prisma.driver.findUnique({
    where: { id },
    select: { id: true, name: true, licenseNumber: true, status: true },
  });

  if (!driver) notFound();

  if (driver.status !== "ACTIVE") {
    return (
      <main className="mx-auto w-full max-w-lg px-4 py-6 sm:px-6">
        <h1 className="text-2xl font-semibold text-white">Record payment</h1>
        <div className="mt-5 rounded-xl border border-white/10 bg-[#0e1426] p-5">
          <p className="text-sm text-neutral-300">
            Activate {driver.name} before recording a new payment. Existing history remains available.
          </p>
          <Link
            href={`/drivers/${driver.id}`}
            className="mt-4 inline-flex h-10 items-center rounded-md border border-white/10 px-3 text-sm text-neutral-200 hover:bg-white/5"
          >
            Back to driver
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-6 sm:px-6">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-white">Record payment</h1>
        <p className="mt-1 text-sm text-neutral-400">Add a payment to this driver&apos;s account.</p>
      </div>
      <section className="rounded-xl border border-white/10 bg-[#0e1426] p-4 sm:p-5">
        <PaymentForm
          mode="create"
          driver={driver}
          initial={{
            amount: "",
            paymentDate: currentFinancialDateInput(),
            method: "CASH",
            notes: "",
          }}
        />
      </section>
    </main>
  );
}
