export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { notFound } from "next/navigation";
import PaymentForm from "@/components/drivers/PaymentForm";
import { requireDriverAdminPage } from "@/lib/drivers/access";
import { formatFinancialDateInput } from "@/lib/drivers/financialValidation";
import { prisma } from "@/lib/prisma";

type PageProps = { params: Promise<{ id: string; paymentId: string }> };

export default async function EditPaymentPage({ params }: PageProps) {
  await requireDriverAdminPage();
  const { id: driverId, paymentId } = await params;
  const payment = await prisma.driverPayment.findFirst({
    where: { id: paymentId, driverId },
    select: {
      id: true,
      amount: true,
      paymentDate: true,
      method: true,
      notes: true,
      driver: {
        select: { id: true, name: true, licenseNumber: true },
      },
    },
  });

  if (!payment) notFound();

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-6 sm:px-6">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-white">Edit payment</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Update this aggregate driver-account payment.
        </p>
      </div>
      <section className="rounded-xl border border-white/10 bg-[#0e1426] p-4 sm:p-5">
        <PaymentForm
          mode="edit"
          driver={payment.driver}
          initial={{
            id: payment.id,
            amount: payment.amount.toFixed(2),
            paymentDate: formatFinancialDateInput(payment.paymentDate),
            method: payment.method,
            notes: payment.notes ?? "",
          }}
        />
      </section>
    </main>
  );
}
