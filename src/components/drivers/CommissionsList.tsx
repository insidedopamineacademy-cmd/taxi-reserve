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
        <span className="mb-1 block text-xs font-medium text-muted">
          Search commissions
        </span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Driver, pickup, drop-off or date"
          className="h-11 w-full rounded-lg border border-app-border bg-surface-2 px-3 text-base text-white outline-none placeholder:text-subtle focus:border-brand/50 focus:ring-2 focus:ring-brand/25"
        />
      </label>
      <p className="mt-3 text-xs text-subtle">
        {filteredItems.length} {filteredItems.length === 1 ? "commission" : "commissions"}
      </p>

      {filteredItems.length === 0 ? (
        <div className="mt-3 rounded-xl border border-app-border bg-surface p-8 text-center text-sm text-muted">
          {items.length === 0 ? "No commissions recorded yet." : "No commissions match your search."}
        </div>
      ) : (
        <ol className="mt-3 grid gap-3">
          {filteredItems.map((entry) => (
            <li key={entry.id} className="rounded-xl border border-app-border bg-surface p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/drivers/${entry.driverId}`}
                      className="font-semibold text-white hover:text-brand"
                    >
                      {entry.driverName}
                    </Link>
                    <span className="rounded-full border border-app-border bg-white/5 px-2 py-0.5 text-[11px] text-muted">
                      {entry.source === "reservation" ? "Reservation-linked" : "Manual"}
                    </span>
                  </div>
                  <p className="mt-2 break-words text-sm text-muted">
                    {entry.pickupText || "Pickup not set"}
                    <span className="mx-2 text-subtle">→</span>
                    {entry.dropoffText || "Drop-off not set"}
                  </p>
                  <p className="mt-1 text-xs text-subtle">{entry.dateLabel}</p>
                </div>
                <p className="shrink-0 text-lg font-semibold text-white tnum">{entry.amount}</p>
              </div>
              {entry.notes ? (
                <p className="mt-3 border-t border-app-border pt-3 text-sm text-muted">
                  {entry.notes}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2 border-t border-app-border pt-3">
                <Link
                  href={`/drivers/${entry.driverId}/commissions/${entry.id}/edit`}
                  className="inline-flex h-9 items-center rounded-lg border border-app-border px-3 text-xs font-medium text-muted hover:bg-white/5 hover:text-white"
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
