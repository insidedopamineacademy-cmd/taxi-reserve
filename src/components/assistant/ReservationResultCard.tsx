"use client";

import Link from "next/link";
import { memo } from "react";
import type { AssistantReservationResult } from "./types";

type Props = {
  reservation: AssistantReservationResult;
};

function RouteRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 grid-cols-[58px_minmax(0,1fr)] gap-2 text-sm">
      <span className="whitespace-nowrap text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <span className="min-w-0 break-words text-slate-200">{value}</span>
    </div>
  );
}

export const ReservationResultCard = memo(function ReservationResultCard({ reservation }: Props) {
  return (
    <article className="mt-2 overflow-hidden rounded-2xl border border-white/10 bg-[#111827] shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2.5">
        <div>
          <p className="text-sm font-semibold text-white">{reservation.dateLabel}</p>
          <p className="text-xs text-amber-300">{reservation.timeLabel}</p>
        </div>
        {reservation.fixture ? (
          <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-2 py-1 text-[11px] font-medium text-amber-200">
            Fixture preview
          </span>
        ) : null}
      </div>

      <div className="space-y-2.5 px-3 py-3">
        {reservation.passengerName || reservation.statusLabel || reservation.bookingReference ? (
          <dl className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 border-b border-white/10 pb-2.5 text-xs">
            {reservation.passengerName ? (
              <div className="min-w-0">
                <dt className="text-slate-500">Passenger</dt>
                <dd className="break-words text-slate-200">{reservation.passengerName}</dd>
              </div>
            ) : null}
            {reservation.statusLabel ? (
              <div className="min-w-0">
                <dt className="text-slate-500">Status</dt>
                <dd className="break-words text-slate-200">{reservation.statusLabel}</dd>
              </div>
            ) : null}
            {reservation.bookingReference ? (
              <div className="min-w-0">
                <dt className="text-slate-500">Reference</dt>
                <dd className="break-all font-medium text-amber-200">
                  {reservation.bookingReference}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        <RouteRow label="Pickup" value={reservation.pickup} />
        <RouteRow label="Drop-off" value={reservation.dropoff} />

        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-white/10 pt-2 text-xs text-slate-400">
          <span>
            {reservation.passengerCount} passenger{reservation.passengerCount === 1 ? "" : "s"}
          </span>
          {reservation.flight ? <span>Flight {reservation.flight}</span> : <span>No flight provided</span>}
          {reservation.phone ? <span>Phone {reservation.phone}</span> : null}
          {reservation.driver.visibility === "assigned" ? (
            <span>Driver: {reservation.driver.name}</span>
          ) : reservation.driver.visibility === "unassigned" ? (
            <span className="text-amber-300">Driver unassigned</span>
          ) : null}
        </div>
      </div>

      {reservation.href ? (
        <div className="border-t border-white/10 px-3 py-2.5">
          <Link
            href={reservation.href}
            className="inline-flex min-h-11 items-center text-sm font-medium text-amber-300 hover:text-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            Open reservation
          </Link>
        </div>
      ) : null}
    </article>
  );
});
