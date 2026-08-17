export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import DriverEntryLauncher from "@/components/drivers/DriverEntryLauncher";
import PaymentsList from "@/components/drivers/PaymentsList";
import { requireDriverAdminPage } from "@/lib/drivers/access";
import { formatFinancialDateDisplay } from "@/lib/drivers/financialValidation";
import { formatEuro } from "@/lib/drivers/financials";
import { prisma } from "@/lib/prisma";

function paymentMethodLabel(method: "CASH" | "BANK" | "OTHER") {
  if (method === "CASH") return "Cash";
  if (method === "BANK") return "Bank";
  return "Other";
}

export default async function PaymentsPage() {
  await requireDriverAdminPage();
  const [payments, activeDrivers] = await Promise.all([
    prisma.driverPayment.findMany({
      orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        paymentDate: true,
        amount: true,
        method: true,
        notes: true,
        driver: { select: { id: true, name: true } },
      },
    }),
    prisma.driver.findMany({
      where: { status: "ACTIVE" },
      orderBy: [{ name: "asc" }, { licenseNumber: "asc" }],
      select: { id: true, name: true, licenseNumber: true },
    }),
  ]);

  const items = payments.map((payment) => ({
    id: payment.id,
    driverId: payment.driver.id,
    driverName: payment.driver.name,
    dateLabel: formatFinancialDateDisplay(payment.paymentDate),
    amount: formatEuro(payment.amount),
    method: payment.method,
    methodLabel: paymentMethodLabel(payment.method),
    notes: payment.notes,
  }));

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Payments</h1>
        <p className="mt-1 text-sm text-muted">
          Review and record aggregate driver-account payments.
        </p>
      </div>
      <DriverEntryLauncher drivers={activeDrivers} kind="payment" />
      <PaymentsList items={items} />
    </main>
  );
}
