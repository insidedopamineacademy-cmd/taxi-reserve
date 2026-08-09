"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import FinancialEntryDeleteButton from "@/components/drivers/FinancialEntryDeleteButton";

export type PaymentListItem = {
  id: string;
  driverId: string;
  driverName: string;
  dateLabel: string;
  amount: string;
  method: "CASH" | "BANK" | "OTHER";
  methodLabel: string;
  notes: string | null;
};

function normalize(value: unknown) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

export default function PaymentsList({ items }: { items: PaymentListItem[] }) {
  const [query, setQuery] = useState("");
  const normalizedQuery = normalize(query);
  const filteredItems = useMemo(() => {
    if (!normalizedQuery) return items;
    return items.filter((payment) =>
      [payment.driverName, payment.method, payment.methodLabel].some((value) =>
        normalize(value).includes(normalizedQuery),
      ),
    );
  }, [items, normalizedQuery]);

  return (
    <section className="mt-6">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-neutral-400">
          Search payments
        </span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Driver or payment method"
          className="h-11 w-full rounded-md border border-white/10 bg-black/30 px-3 text-base text-white outline-none placeholder:text-neutral-500 focus:border-white/30"
        />
      </label>
      <p className="mt-3 text-xs text-neutral-500">
        {filteredItems.length} {filteredItems.length === 1 ? "payment" : "payments"}
      </p>

      {filteredItems.length === 0 ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-[#0e1426] p-8 text-center text-sm text-neutral-400">
          {items.length === 0 ? "No payments recorded yet." : "No payments match your search."}
        </div>
      ) : (
        <ol className="mt-3 grid gap-3">
          {filteredItems.map((payment) => (
            <li key={payment.id} className="rounded-xl border border-white/10 bg-[#0e1426] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Link
                    href={`/drivers/${payment.driverId}`}
                    className="font-semibold text-white hover:text-yellow-300"
                  >
                    {payment.driverName}
                  </Link>
                  <p className="mt-1 text-sm text-neutral-300">{payment.methodLabel}</p>
                  <p className="mt-1 text-xs text-neutral-500">{payment.dateLabel}</p>
                </div>
                <p className="shrink-0 text-lg font-semibold text-white">{payment.amount}</p>
              </div>
              {payment.notes ? (
                <p className="mt-3 border-t border-white/10 pt-3 text-sm text-neutral-400">
                  {payment.notes}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2 border-t border-white/10 pt-3">
                <Link
                  href={`/drivers/${payment.driverId}/payments/${payment.id}/edit`}
                  className="inline-flex h-9 items-center rounded-md border border-white/10 px-3 text-xs font-medium text-neutral-200 hover:bg-white/5"
                >
                  Edit
                </Link>
                <FinancialEntryDeleteButton
                  driverId={payment.driverId}
                  entryId={payment.id}
                  kind="payment"
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
