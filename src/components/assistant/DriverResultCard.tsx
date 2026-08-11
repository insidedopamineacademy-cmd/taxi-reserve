"use client";

import Link from "next/link";
import { memo } from "react";
import { formatAssistantEuro } from "./assistantMoney";
import type { AssistantDriverResult } from "./types";

const positionLabels = {
  DUE: "Amount due",
  SETTLED: "Settled balance",
  CREDIT: "Credit position",
} as const;

export const DriverResultCard = memo(function DriverResultCard({
  driver,
}: {
  driver: AssistantDriverResult;
}) {
  return (
    <article className="mt-2 min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-[#111827] shadow-sm">
      <div className="flex min-w-0 items-start justify-between gap-3 border-b border-white/10 px-3 py-3">
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold text-white">{driver.name}</p>
          <p className="mt-1 break-words text-xs text-slate-400">
            {driver.status === "ACTIVE" ? "Active" : "Inactive"} · {driver.vehicleType ?? "Vehicle unspecified"}
          </p>
          {driver.licenseNumber ? (
            <p className="mt-1 break-all text-xs text-slate-500">License {driver.licenseNumber}</p>
          ) : null}
        </div>
        {driver.fixture ? (
          <span className="shrink-0 rounded-full border border-amber-300/30 bg-amber-300/10 px-2 py-1 text-[11px] text-amber-200">
            Fixture
          </span>
        ) : null}
      </div>
      <div className="flex min-w-0 items-center justify-between gap-3 px-3 py-3">
        <span className="text-xs text-slate-400">{positionLabels[driver.balancePosition]}</span>
        <span className="break-all text-right text-base font-semibold tabular-nums text-amber-300">
          {formatAssistantEuro(driver.balance)}
        </span>
      </div>
      <div className="border-t border-white/10 px-3 py-2.5">
        <Link
          href={driver.href}
          className="inline-flex min-h-11 items-center text-sm font-medium text-amber-300 hover:text-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
        >
          Open driver
        </Link>
      </div>
    </article>
  );
});
