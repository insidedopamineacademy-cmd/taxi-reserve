"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import FinancialEntryDeleteButton from "@/components/drivers/FinancialEntryDeleteButton";

export type CommissionListItem = {
  id: string;
  driverId: string;
  driverName: string;
  dateLabel: string;
  dateSearch: string;
  pickupText: string | null;
  dropoffText: string | null;
  amount: string;
  source: "reservation" | "manual";
  reservationId: string | null;
  notes: string | null;
};

function normalize(value: unknown) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

export default function CommissionsList({ items }: { items: CommissionListItem[] }) {
  const [query, setQuery] = useState("");
  const normalizedQuery = normalize(query);
  const filteredItems = useMemo(() => {
    if (!normalizedQuery) return items;
    return items.filter((entry) =>
      [
        entry.driverName,
        entry.pickupText,
        entry.dropoffText,
        entry.dateLabel,
        entry.dateSearch,
      ].some((value) => normalize(value).includes(normalizedQuery)),
    );
  }, [items, normalizedQuery]);

  return (
    <section className="mt-6">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-neutral-400">
          Search commissions
        </span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Driver, pickup, drop-off or date"
          className="h-11 w-full rounded-md border border-white/10 bg-black/30 px-3 text-base text-white outline-none placeholder:text-neutral-500 focus:border-white/30"
        />
      </label>
      <p className="mt-3 text-xs text-neutral-500">
        {filteredItems.length} {filteredItems.length === 1 ? "commission" : "commissions"}
      </p>

      {filteredItems.length === 0 ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-[#0e1426] p-8 text-center text-sm text-neutral-400">
          {items.length === 0 ? "No commissions recorded yet." : "No commissions match your search."}
        </div>
      ) : (
        <ol className="mt-3 grid gap-3">
          {filteredItems.map((entry) => (
            <li key={entry.id} className="rounded-xl border border-white/10 bg-[#0e1426] p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/drivers/${entry.driverId}`}
                      className="font-semibold text-white hover:text-yellow-300"
                    >
                      {entry.driverName}
                    </Link>
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-neutral-400">
                      {entry.source === "reservation" ? "Reservation-linked" : "Manual"}
                    </span>
                  </div>
                  <p className="mt-2 break-words text-sm text-neutral-300">
                    {entry.pickupText || "Pickup not set"}
                    <span className="mx-2 text-neutral-500">→</span>
                    {entry.dropoffText || "Drop-off not set"}
                  </p>
                  <p className="mt-1 text-xs text-neutral-500">
                    {entry.dateLabel}
                    {entry.reservationId ? ` · Reservation ${entry.reservationId}` : ""}
                  </p>
                </div>
                <p className="shrink-0 text-lg font-semibold text-white">{entry.amount}</p>
              </div>
              {entry.notes ? (
                <p className="mt-3 border-t border-white/10 pt-3 text-sm text-neutral-400">
                  {entry.notes}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2 border-t border-white/10 pt-3">
                <Link
                  href={`/drivers/${entry.driverId}/commissions/${entry.id}/edit`}
                  className="inline-flex h-9 items-center rounded-md border border-white/10 px-3 text-xs font-medium text-neutral-200 hover:bg-white/5"
                >
                  Edit
                </Link>
                <FinancialEntryDeleteButton
                  driverId={entry.driverId}
                  entryId={entry.id}
                  kind="commission"
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
