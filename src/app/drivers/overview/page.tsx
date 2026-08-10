export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import Link from "next/link";
import { requireDriverAdminPage } from "@/lib/drivers/access";
import {
  formatCommissionRoute,
  resolveCommissionRoute,
} from "@/lib/drivers/commissionRoute";
import { formatFinancialDateDisplay } from "@/lib/drivers/financialValidation";
import { formatEuro } from "@/lib/drivers/financials";
import { getDriverFinanceOverview } from "@/lib/drivers/overview";

function paymentMethodLabel(method: "CASH" | "BANK" | "OTHER") {
  if (method === "CASH") return "Cash";
  if (method === "BANK") return "Bank";
  return "Other";
}

export default async function DriverFinanceOverviewPage() {
  await requireDriverAdminPage();
  const overview = await getDriverFinanceOverview();

  const cards = [
    { label: "Total Commission Due", value: formatEuro(overview.totalCommissionDue) },
    { label: "Driver Credits", value: formatEuro(overview.driverCredits) },
    { label: "Net Position", value: formatEuro(overview.netPosition) },
    { label: "Collected This Week", value: formatEuro(overview.collectedThisWeek) },
    { label: "Collected This Month", value: formatEuro(overview.collectedThisMonth) },
    {
      label: "Subscriptions This Month",
      value: formatEuro(overview.subscriptionChargesThisMonth),
    },
    { label: "Active Drivers", value: String(overview.activeDrivers) },
  ];

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Finance Overview</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Current driver balances and recent financial activity.
          </p>
        </div>
        <Link
          href="/api/drivers/due-pdf"
          className="inline-flex h-11 items-center justify-center rounded-md bg-yellow-500 px-4 text-sm font-semibold text-black hover:bg-yellow-400"
        >
          Download Due PDF
        </Link>
      </div>

      <section aria-label="Driver finance summary" className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card, index) => (
          <article
            key={card.label}
            className={
              index === 0
                ? "rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4"
                : "rounded-xl border border-white/10 bg-[#0e1426] p-4"
            }
          >
            <p className="text-sm text-neutral-400">{card.label}</p>
            <p className={index === 0 ? "mt-2 text-xl font-semibold text-yellow-300" : "mt-2 text-xl font-semibold text-white"}>
              {card.value}
            </p>
          </article>
        ))}
      </section>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="recent-commissions">
          <div className="flex items-center justify-between gap-3">
            <h2 id="recent-commissions" className="text-lg font-semibold text-white">
              Recent Commissions
            </h2>
            <Link href="/commissions" className="text-sm text-yellow-300 hover:text-yellow-200">
              View all
            </Link>
          </div>
          {overview.recentCommissions.length === 0 ? (
            <div className="mt-3 rounded-xl border border-white/10 bg-[#0e1426] p-8 text-center text-sm text-neutral-400">
              No commissions recorded yet.
            </div>
          ) : (
            <ol className="mt-3 grid gap-3">
              {overview.recentCommissions.map((entry) => {
                const route = resolveCommissionRoute(entry);
                return (
                  <li key={entry.id} className="rounded-xl border border-white/10 bg-[#0e1426] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          href={`/drivers/${entry.driver.id}`}
                          className="font-medium text-white hover:text-yellow-300"
                        >
                          {entry.driver.name}
                        </Link>
                        <p className="mt-1 break-words text-sm text-neutral-400">
                          {formatCommissionRoute(route)}
                        </p>
                        <p className="mt-1 text-xs text-neutral-500">
                          {formatFinancialDateDisplay(entry.entryDate)}
                        </p>
                      </div>
                      <p className="shrink-0 font-semibold text-white">
                        {formatEuro(entry.commissionAmount)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section aria-labelledby="recent-payments">
          <div className="flex items-center justify-between gap-3">
            <h2 id="recent-payments" className="text-lg font-semibold text-white">
              Recent Payments
            </h2>
            <Link href="/payments" className="text-sm text-yellow-300 hover:text-yellow-200">
              View all
            </Link>
          </div>
          {overview.recentPayments.length === 0 ? (
            <div className="mt-3 rounded-xl border border-white/10 bg-[#0e1426] p-8 text-center text-sm text-neutral-400">
              No payments recorded yet.
            </div>
          ) : (
            <ol className="mt-3 grid gap-3">
              {overview.recentPayments.map((payment) => (
                <li key={payment.id} className="rounded-xl border border-white/10 bg-[#0e1426] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Link
                        href={`/drivers/${payment.driver.id}`}
                        className="font-medium text-white hover:text-yellow-300"
                      >
                        {payment.driver.name}
                      </Link>
                      <p className="mt-1 text-sm text-neutral-400">
                        {paymentMethodLabel(payment.method)}
                      </p>
                      <p className="mt-1 text-xs text-neutral-500">
                        {formatFinancialDateDisplay(payment.paymentDate)}
                      </p>
                    </div>
                    <p className="shrink-0 font-semibold text-white">
                      {formatEuro(payment.amount)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </main>
  );
}
