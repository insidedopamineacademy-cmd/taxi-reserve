export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import Link from "next/link";
import { notFound } from "next/navigation";
import DriverStatusBadge from "@/components/drivers/DriverStatusBadge";
import DriverStatusButton from "@/components/drivers/DriverStatusButton";
import FinancialEntryDeleteButton from "@/components/drivers/FinancialEntryDeleteButton";
import { PdfShareButton } from "@/components/PdfShareButton";
import { requireDriverAdminPage } from "@/lib/drivers/access";
import { buildShareFilename } from "@/lib/pdfShare";
import {
  formatCommissionRoute,
  resolveCommissionRoute,
} from "@/lib/drivers/commissionRoute";
import {
  formatEuro,
  getDriverFinancialSummary,
} from "@/lib/drivers/financials";
import { formatFinancialDateDisplay } from "@/lib/drivers/financialValidation";
import { formatSubscriptionMonthDisplay } from "@/lib/drivers/subscriptions";
import { prisma } from "@/lib/prisma";
import { formatMadridDateDisplay } from "@/lib/time/madrid";

type PageProps = { params: Promise<{ id: string }> };

function formatDate(date: Date) {
  return formatMadridDateDisplay(date);
}

function paymentMethodLabel(method: "CASH" | "BANK" | "OTHER") {
  if (method === "CASH") return "Cash";
  if (method === "BANK") return "Bank";
  return "Other";
}

export default async function DriverDetailPage({ params }: PageProps) {
  await requireDriverAdminPage();
  const { id } = await params;
  const driver = await prisma.driver.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      licenseNumber: true,
      vehicleType: true,
      subscriptionExempt: true,
      status: true,
      createdAt: true,
      commissionEntries: {
        orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
        take: 100,
        select: {
          id: true,
          commissionAmount: true,
          entryDate: true,
          notes: true,
          manualPickupText: true,
          manualDropoffText: true,
          reservation: {
            select: {
              id: true,
              pickupText: true,
              dropoffText: true,
            },
          },
        },
      },
      payments: {
        orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
        take: 100,
        select: {
          id: true,
          paymentDate: true,
          amount: true,
          method: true,
          notes: true,
        },
      },
      subscriptionCharges: {
        orderBy: [{ chargeMonth: "desc" }, { createdAt: "desc" }],
        take: 100,
        select: {
          id: true,
          chargeMonth: true,
          amount: true,
          createdAt: true,
        },
      },
    },
  });

  if (!driver) notFound();

  const summary = await getDriverFinancialSummary(driver.id);
  const balPositive = summary.balance.greaterThan(0);
  const balNegative = summary.balance.lessThan(0);
  const balTone = balPositive ? "text-warning" : balNegative ? "text-success" : "text-white";
  const balBorder = balPositive
    ? "border-warning/25"
    : balNegative
      ? "border-success/25"
      : "border-app-border";
  const balBg = balPositive ? "bg-warning/[0.06]" : balNegative ? "bg-success/[0.06]" : "bg-surface";
  const balNote = balPositive ? "Owed to company" : balNegative ? "Driver credit" : "Settled";
  const ledgerFilename = buildShareFilename(
    `driver-ledger-${driver.name}`,
    formatMadridDateDisplay(new Date()),
  );

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <Link href="/drivers" className="text-sm text-muted hover:text-brand">
        ← Back to drivers
      </Link>

      <header className="mt-4 rounded-xl border border-app-border bg-surface p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="break-words text-2xl font-semibold text-white">{driver.name}</h1>
              <DriverStatusBadge status={driver.status} />
            </div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-subtle">License number</dt>
                <dd className="mt-1 break-all text-neutral-200">{driver.licenseNumber}</dd>
              </div>
              <div>
                <dt className="text-subtle">Vehicle type</dt>
                <dd
                  className={
                    driver.vehicleType
                      ? "mt-1 text-neutral-200"
                      : "mt-1 font-medium text-warning"
                  }
                >
                  {driver.vehicleType ?? "Not set - edit required"}
                </dd>
              </div>
              <div>
                <dt className="text-subtle">Subscription</dt>
                <dd className="mt-1 text-neutral-200">
                  {driver.subscriptionExempt
                    ? "Exempt"
                    : driver.vehicleType
                      ? "Monthly charge enabled"
                      : "Waiting for vehicle type"}
                </dd>
              </div>
              <div>
                <dt className="text-subtle">Created</dt>
                <dd className="mt-1 text-neutral-200">{formatDate(driver.createdAt)}</dd>
              </div>
            </dl>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            <Link
              href={`/api/drivers/${driver.id}/ledger-pdf`}
              className="inline-flex h-10 items-center rounded-md border border-white/10 bg-white/5 px-3 text-sm font-medium text-neutral-200 hover:bg-white/10"
            >
              Download Ledger PDF
            </Link>
            <PdfShareButton
              pdfUrl={`/api/drivers/${driver.id}/ledger-pdf`}
              filename={ledgerFilename}
              shareTitle={`Ledger — ${driver.name}`}
              label={`Share ${driver.name} ledger PDF`}
              variant="button"
            />
            <Link
              href={`/drivers/${driver.id}/edit`}
              className="inline-flex h-10 items-center rounded-md bg-brand px-3 text-sm font-semibold text-brand-fg hover:bg-brand-hover"
            >
              Edit driver
            </Link>
            <DriverStatusButton id={driver.id} name={driver.name} status={driver.status} />
          </div>
        </div>
      </header>

      <section className="mt-4 rounded-xl border border-app-border bg-surface p-4">
        {driver.status === "ACTIVE" ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold text-white">Ledger actions</h2>
              <p className="mt-1 text-sm text-muted">
                Record financial activity directly against this driver&apos;s account.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/drivers/${driver.id}/commissions/new`}
                className="inline-flex h-10 items-center rounded-md bg-brand px-3 text-sm font-semibold text-brand-fg hover:bg-brand-hover"
              >
                Add commission
              </Link>
              <Link
                href={`/drivers/${driver.id}/payments/new`}
                className="inline-flex h-10 items-center rounded-md border border-white/10 bg-white/5 px-3 text-sm font-medium text-neutral-200 hover:bg-white/10"
              >
                Record payment
              </Link>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">
            This driver is inactive. Historical entries remain visible and editable; activate the
            driver to add new commissions or payments.
          </p>
        )}
      </section>

      <section aria-labelledby="financial-summary" className="mt-6">
        <h2 id="financial-summary" className="text-lg font-semibold text-white">
          Financial summary
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <article className="rounded-xl border border-app-border bg-surface p-4">
            <p className="text-sm text-muted">Total commissions</p>
            <p className="mt-2 text-2xl font-semibold text-white tnum">
              {formatEuro(summary.totalCommissions)}
            </p>
          </article>
          <article className="rounded-xl border border-app-border bg-surface p-4">
            <p className="text-sm text-muted">Total payments</p>
            <p className="mt-2 text-2xl font-semibold text-white tnum">
              {formatEuro(summary.totalPayments)}
            </p>
          </article>
          <article className="rounded-xl border border-app-border bg-surface p-4">
            <p className="text-sm text-muted">Subscription charges</p>
            <p className="mt-2 text-2xl font-semibold text-white tnum">
              {formatEuro(summary.totalSubscriptionCharges)}
            </p>
          </article>
          <article className={`rounded-xl border ${balBorder} ${balBg} p-4`}>
            <p className="text-sm text-muted">Outstanding balance</p>
            <p className={`mt-2 text-2xl font-semibold tnum ${balTone}`}>
              {formatEuro(summary.balance)}
            </p>
            <p className="mt-0.5 text-xs text-subtle">{balNote}</p>
          </article>
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="commission-history">
          <h2 id="commission-history" className="text-lg font-semibold text-white">
            Commission history
          </h2>
          {driver.commissionEntries.length === 0 ? (
            <div className="mt-3 rounded-xl border border-app-border bg-surface p-8 text-center text-sm text-muted">
              No commission entries yet.
            </div>
          ) : (
            <ol className="mt-3 grid gap-3">
              {driver.commissionEntries.map((entry) => {
                const route = resolveCommissionRoute(entry);

                return (
                  <li key={entry.id} className="rounded-xl border border-app-border bg-surface p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm text-neutral-300">
                          {formatFinancialDateDisplay(entry.entryDate)}
                        </p>
                        {entry.reservation ? (
                          <div className="mt-1 text-xs text-subtle">
                            <p className="font-medium text-muted">Reservation-linked</p>
                            <p className="mt-1 break-words">{formatCommissionRoute(route)}</p>
                          </div>
                        ) : (
                          <div className="mt-1 text-xs text-subtle">
                            <p>Manual commission</p>
                            <p className="mt-1 break-words">{formatCommissionRoute(route)}</p>
                          </div>
                        )}
                      </div>
                      <p className="shrink-0 font-semibold text-white tnum">
                        {formatEuro(entry.commissionAmount)}
                      </p>
                    </div>
                    {entry.notes ? (
                      <p className="mt-3 border-t border-app-border pt-3 text-sm text-muted">
                        {entry.notes}
                      </p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap items-start gap-2 border-t border-app-border pt-3">
                      <Link
                        href={`/drivers/${driver.id}/commissions/${entry.id}/edit`}
                        className="inline-flex h-9 items-center rounded-md border border-white/10 px-3 text-xs font-medium text-neutral-200 hover:bg-white/5"
                      >
                        Edit
                      </Link>
                      <FinancialEntryDeleteButton
                        driverId={driver.id}
                        entryId={entry.id}
                        kind="commission"
                      />
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section aria-labelledby="payment-history">
          <h2 id="payment-history" className="text-lg font-semibold text-white">
            Payment history
          </h2>
          {driver.payments.length === 0 ? (
            <div className="mt-3 rounded-xl border border-app-border bg-surface p-8 text-center text-sm text-muted">
              No payments recorded yet.
            </div>
          ) : (
            <ol className="mt-3 grid gap-3">
              {driver.payments.map((payment) => (
                <li key={payment.id} className="rounded-xl border border-app-border bg-surface p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm text-neutral-300">
                        {formatFinancialDateDisplay(payment.paymentDate)}
                      </p>
                      <p className="mt-1 text-xs text-subtle">
                        {paymentMethodLabel(payment.method)}
                      </p>
                    </div>
                    <p className="shrink-0 font-semibold text-white tnum">
                      {formatEuro(payment.amount)}
                    </p>
                  </div>
                  {payment.notes ? (
                    <p className="mt-3 border-t border-app-border pt-3 text-sm text-muted">
                      {payment.notes}
                    </p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-start gap-2 border-t border-app-border pt-3">
                    <Link
                      href={`/drivers/${driver.id}/payments/${payment.id}/edit`}
                      className="inline-flex h-9 items-center rounded-md border border-white/10 px-3 text-xs font-medium text-neutral-200 hover:bg-white/5"
                    >
                      Edit
                    </Link>
                    <FinancialEntryDeleteButton
                      driverId={driver.id}
                      entryId={payment.id}
                      kind="payment"
                    />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <section aria-labelledby="subscription-history" className="mt-6">
        <h2 id="subscription-history" className="text-lg font-semibold text-white">
          Subscription history
        </h2>
        {driver.subscriptionCharges.length === 0 ? (
          <div className="mt-3 rounded-xl border border-app-border bg-surface p-8 text-center text-sm text-muted">
            No subscription charges recorded yet.
          </div>
        ) : (
          <ol className="mt-3 grid gap-3 sm:grid-cols-2">
            {driver.subscriptionCharges.map((charge) => (
              <li
                key={charge.id}
                className="rounded-xl border border-app-border bg-surface p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-neutral-200">
                      {formatSubscriptionMonthDisplay(charge.chargeMonth)}
                    </p>
                    <p className="mt-1 text-xs text-subtle">
                      Created {formatDate(charge.createdAt)}
                    </p>
                  </div>
                  <p className="shrink-0 font-semibold text-white tnum">
                    {formatEuro(charge.amount)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
