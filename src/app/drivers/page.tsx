export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import Link from "next/link";
import DriversList from "@/components/drivers/DriversList";
import { requireDriverAdminPage } from "@/lib/drivers/access";
import {
  calculateDriverFinancePosition,
  combineDriverFinancialSummaries,
  formatEuro,
} from "@/lib/drivers/financials";
import { getDriverBalanceLines } from "@/lib/drivers/overview";

export default async function DriversPage() {
  await requireDriverAdminPage();

  const drivers = await getDriverBalanceLines();
  const summaries = drivers.map((driver) => driver.summary);
  const overview = combineDriverFinancialSummaries(summaries);
  // Gross pending (drivers who owe) and credits (drivers in credit). Pending
  // deliberately does NOT net off credits — it matches the Pending Commissions
  // PDF, which is a collections total. Net position = pending − credits lives on
  // the Finance Overview page.
  const position = calculateDriverFinancePosition(summaries);
  const items = drivers.map((driver) => ({
    id: driver.id,
    name: driver.name,
    licenseNumber: driver.licenseNumber,
    vehicleType: driver.vehicleType,
    subscriptionExempt: driver.subscriptionExempt,
    status: driver.status,
    balance: formatEuro(driver.summary.balance),
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
          <Link href="/drivers/credits" aria-label={`View driver credits: ${formatEuro(position.driverCredits)}`} className="group min-w-0 cursor-pointer rounded-xl border border-app-border bg-surface p-4 hover:border-success/40 hover:bg-success/[0.06] active:bg-success/10 focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-app">
            <p className="flex items-start justify-between gap-2 text-sm text-muted">Driver credits <span aria-hidden="true" className="text-subtle group-hover:text-success">›</span></p>
            <p className="mt-2 text-xl font-semibold text-success tnum">
              {formatEuro(position.driverCredits)}
            </p>
            <p className="mt-0.5 text-xs text-subtle">Held by drivers in credit</p>
          </Link>
          <Link href="/drivers/due" aria-label={`View pending commissions: ${formatEuro(position.totalCommissionDue)}`} className="group min-w-0 cursor-pointer rounded-xl border border-warning/25 bg-warning/[0.06] p-4 hover:border-warning/50 hover:bg-warning/10 active:bg-warning/15 focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-app">
            <p className="flex items-start justify-between gap-2 text-sm text-muted">Pending commissions <span aria-hidden="true" className="text-subtle group-hover:text-warning">›</span></p>
            <p className="mt-2 text-xl font-semibold text-warning tnum">
              {formatEuro(position.totalCommissionDue)}
            </p>
            <p className="mt-0.5 text-xs text-subtle">Owed by drivers · matches PDF</p>
          </Link>
        </div>
      </section>

      <DriversList items={items} />
    </main>
  );
}
