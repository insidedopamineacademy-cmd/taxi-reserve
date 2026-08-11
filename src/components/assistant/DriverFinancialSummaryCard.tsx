"use client";

import Link from "next/link";
import { memo } from "react";
import { formatAssistantEuro } from "./assistantMoney";
import type { AssistantDriverFinancialSummary } from "./types";

const balanceLabels = {
  DUE: "Due",
  SETTLED: "Settled",
  CREDIT: "Credit",
} as const;

function TotalRow({ label, amount }: { label: string; amount: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 text-sm">
      <dt className="min-w-0 break-words text-slate-400">{label}</dt>
      <dd className="shrink-0 tabular-nums text-slate-100">{formatAssistantEuro(amount)}</dd>
    </div>
  );
}

export const DriverFinancialSummaryCard = memo(function DriverFinancialSummaryCard({
  summary,
}: {
  summary: AssistantDriverFinancialSummary;
}) {
  return (
    <article className="mt-2 min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-[#111827] shadow-sm">
      <div className="min-w-0 border-b border-white/10 px-3 py-3">
        <p className="break-words text-sm font-semibold text-white">{summary.driver.name}</p>
        <p className="mt-1 text-xs text-slate-400">
          {summary.driver.status === "ACTIVE" ? "Active" : "Inactive"} · {summary.driver.vehicleType ?? "Vehicle unspecified"}
        </p>
      </div>
      <div className="min-w-0 px-3 py-3">
        <div className="flex min-w-0 items-end justify-between gap-3 border-b border-white/10 pb-3">
          <span className="text-xs font-medium uppercase tracking-wide text-amber-300">
            {balanceLabels[summary.balancePosition]}
          </span>
          <span className="break-all text-right text-xl font-semibold tabular-nums text-white">
            {formatAssistantEuro(summary.balance)}
          </span>
        </div>
        <dl className="mt-3 space-y-2">
          <TotalRow label="Commissions" amount={summary.totalCommissions} />
          <TotalRow label="Payments" amount={summary.totalPayments} />
          <TotalRow label="Subscription charges" amount={summary.totalSubscriptionCharges} />
        </dl>
      </div>
      <div className="border-t border-white/10 px-3 py-2.5">
        <Link
          href={summary.driver.href}
          className="inline-flex min-h-11 items-center text-sm font-medium text-amber-300 hover:text-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
        >
          Open driver ledger
        </Link>
      </div>
    </article>
  );
});
