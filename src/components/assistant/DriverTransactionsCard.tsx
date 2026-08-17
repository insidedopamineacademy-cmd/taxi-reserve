"use client";

import Link from "next/link";
import { memo } from "react";
import { formatAssistantEuro } from "./assistantMoney";
import { formatCalendarDateDisplay } from "@/lib/dateDisplay";
import type {
  AssistantDriverTransactions,
} from "./types";

const typeLabels = {
  ALL: "All activity",
  COMMISSION: "Commissions",
  PAYMENT: "Payments",
  SUBSCRIPTION: "Subscriptions",
} as const;

function periodLabel(period: AssistantDriverTransactions["period"]) {
  if (period.from && period.to) {
    return `${formatCalendarDateDisplay(period.from)} to ${formatCalendarDateDisplay(period.to)}`;
  }
  if (period.from) return `From ${formatCalendarDateDisplay(period.from)}`;
  if (period.to) return `Through ${formatCalendarDateDisplay(period.to)}`;
  return "All dates";
}

function TransactionRow({
  row,
}: {
  row: AssistantDriverTransactions["rows"][number];
}) {
  const label = row.type === "COMMISSION"
    ? row.source === "RESERVATION" ? "Reservation commission" : "Manual commission"
    : row.type === "PAYMENT"
      ? `${row.method.toLowerCase()} payment`
      : "Subscription charge";
  const detail = row.type === "COMMISSION"
    ? [row.route.pickup, row.route.dropoff].filter(Boolean).join(" → ")
    : null;

  return (
    <li className="min-w-0 border-t border-white/10 py-2.5 first:border-t-0 first:pt-0">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-sm text-slate-100">{label}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {formatCalendarDateDisplay(row.date)}
          </p>
          {detail ? <p className="mt-1 break-words text-xs leading-5 text-slate-400">{detail}</p> : null}
          {row.type === "COMMISSION" && row.reservation ? (
            <Link
              href={row.reservation.href}
              className="mt-1 inline-flex min-h-8 items-center text-xs font-medium text-amber-300 hover:text-amber-200"
            >
              Open reservation
            </Link>
          ) : null}
        </div>
        <span className="shrink-0 tabular-nums text-sm font-medium text-white">
          {formatAssistantEuro(row.amount)}
        </span>
      </div>
    </li>
  );
}

export const DriverTransactionsCard = memo(function DriverTransactionsCard({
  transactions,
}: {
  transactions: AssistantDriverTransactions;
}) {
  return (
    <article className="mt-2 min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-[#111827] shadow-sm">
      <div className="min-w-0 border-b border-white/10 px-3 py-3">
        <p className="break-words text-sm font-semibold text-white">{transactions.driver.name}</p>
        <p className="mt-1 break-words text-xs text-slate-400">
          {typeLabels[transactions.transactionType]} · {periodLabel(transactions.period)}
        </p>
      </div>
      <div className="grid min-w-0 grid-cols-2 gap-2 border-b border-white/10 px-3 py-3 text-xs">
        <div className="min-w-0">
          <p className="text-slate-500">Commissions</p>
          <p className="break-all tabular-nums text-slate-200">{formatAssistantEuro(transactions.totals.commissions)}</p>
        </div>
        <div className="min-w-0">
          <p className="text-slate-500">Payments</p>
          <p className="break-all tabular-nums text-slate-200">{formatAssistantEuro(transactions.totals.payments)}</p>
        </div>
        <div className="min-w-0">
          <p className="text-slate-500">Subscriptions</p>
          <p className="break-all tabular-nums text-slate-200">{formatAssistantEuro(transactions.totals.subscriptionCharges)}</p>
        </div>
        <div className="min-w-0">
          <p className="text-slate-500">Period net</p>
          <p className="break-all font-semibold tabular-nums text-amber-300">{formatAssistantEuro(transactions.totals.netChange)}</p>
        </div>
      </div>
      <div className="min-w-0 px-3 py-3">
        {transactions.rows.length ? (
          <ul className="min-w-0">
            {transactions.rows.map((row) => <TransactionRow key={`${row.type}-${row.id}`} row={row} />)}
          </ul>
        ) : (
          <p className="text-sm text-slate-400">No transactions in this period.</p>
        )}
        {transactions.hasMore ? (
          <p className="mt-2 rounded-lg bg-white/[0.04] px-2.5 py-2 text-xs text-slate-400">
            More activity is available. Ask for the next page to continue.
          </p>
        ) : null}
      </div>
      <div className="border-t border-white/10 px-3 py-2.5">
        <Link
          href={transactions.driver.href}
          className="inline-flex min-h-11 items-center text-sm font-medium text-amber-300 hover:text-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
        >
          Open driver ledger
        </Link>
      </div>
    </article>
  );
});
