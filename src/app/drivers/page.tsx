export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import Link from "next/link";
import DriversList from "@/components/drivers/DriversList";
import { requireDriverAdminPage } from "@/lib/drivers/access";
import {
  calculateDriverFinancePosition,
  combineDriverFinancialSummaries,
  formatEuro,
  getDriverFinancialSummaries,
} from "@/lib/drivers/financials";
import { prisma } from "@/lib/prisma";

export default async function DriversPage() {
  await requireDriverAdminPage();

  const drivers = await prisma.driver.findMany({
    orderBy: [{ name: "asc" }, { licenseNumber: "asc" }],
    select: {
      id: true,
      name: true,
      licenseNumber: true,
      vehicleType: true,
      subscriptionExempt: true,
      status: true,
    },
  });
  const summaries = await getDriverFinancialSummaries(drivers.map((driver) => driver.id));
  const overview = combineDriverFinancialSummaries(summaries.values());
  // Gross pending (drivers who owe) and credits (drivers in credit). Pending
  // deliberately does NOT net off credits — it matches the Pending Commissions
  // PDF, which is a collections total. Net position = pending − credits lives on
  // the Finance Overview page.
  const position = calculateDriverFinancePosition(summaries.values());
  const items = drivers.map((driver) => ({
    ...driver,
    balance: formatEuro(summaries.get(driver.id)!.balance),
  }));

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Drivers</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Manage driver details, status, and account balances.
          </p>
        </div>
        <Link
          href="/drivers/new"
          className="inline-flex h-11 items-center justify-center rounded-lg bg-brand px-4 text-sm font-semibold text-brand-fg transition hover:bg-brand-hover"
        >
          New driver
        </Link>
      </div>

      <section aria-labelledby="driver-financial-overview" className="mb-6">
        <h2 id="driver-financial-overview" className="sr-only">
          Driver financial overview
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <article className="rounded-xl border border-app-border bg-surface p-4">
            <p className="text-sm text-muted">Total commissions</p>
            <p className="mt-2 text-xl font-semibold text-white tnum">
              {formatEuro(overview.totalCommissions)}
            </p>
          </article>
          <article className="rounded-xl border border-app-border bg-surface p-4">
            <p className="text-sm text-muted">Total payments</p>
            <p className="mt-2 text-xl font-semibold text-white tnum">
              {formatEuro(overview.totalPayments)}
            </p>
          </article>
          <article className="rounded-xl border border-app-border bg-surface p-4">
            <p className="text-sm text-muted">Driver credits</p>
            <p className="mt-2 text-xl font-semibold text-success tnum">
              {formatEuro(position.driverCredits)}
            </p>
            <p className="mt-0.5 text-xs text-subtle">Held by drivers in credit</p>
          </article>
          <article className="rounded-xl border border-warning/25 bg-warning/[0.06] p-4">
            <p className="text-sm text-muted">Pending commissions</p>
            <p className="mt-2 text-xl font-semibold text-warning tnum">
              {formatEuro(position.totalCommissionDue)}
            </p>
            <p className="mt-0.5 text-xs text-subtle">Owed by drivers · matches PDF</p>
          </article>
        </div>
      </section>

      <DriversList items={items} />
    </main>
  );
}
