export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import Link from "next/link";
import DriversList from "@/components/drivers/DriversList";
import { requireDriverAdminPage } from "@/lib/drivers/access";
import {
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
          className="inline-flex h-11 items-center justify-center rounded-md bg-yellow-500 px-4 text-sm font-semibold text-black hover:bg-yellow-400"
        >
          New driver
        </Link>
      </div>

      <section aria-labelledby="driver-financial-overview" className="mb-6">
        <h2 id="driver-financial-overview" className="sr-only">
          Driver financial overview
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <article className="rounded-xl border border-white/10 bg-[#0e1426] p-4">
            <p className="text-sm text-neutral-400">Total commissions</p>
            <p className="mt-2 text-xl font-semibold text-white">
              {formatEuro(overview.totalCommissions)}
            </p>
          </article>
          <article className="rounded-xl border border-white/10 bg-[#0e1426] p-4">
            <p className="text-sm text-neutral-400">Total payments</p>
            <p className="mt-2 text-xl font-semibold text-white">
              {formatEuro(overview.totalPayments)}
            </p>
          </article>
          <article className="rounded-xl border border-white/10 bg-[#0e1426] p-4">
            <p className="text-sm text-neutral-400">Subscription charges</p>
            <p className="mt-2 text-xl font-semibold text-white">
              {formatEuro(overview.totalSubscriptionCharges)}
            </p>
          </article>
          <article className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4">
            <p className="text-sm text-neutral-300">Total outstanding</p>
            <p className="mt-2 text-xl font-semibold text-yellow-300">
              {formatEuro(overview.balance)}
            </p>
          </article>
        </div>
      </section>

      <DriversList items={items} />
    </main>
  );
}
