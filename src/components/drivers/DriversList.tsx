"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import DriverStatusBadge from "@/components/drivers/DriverStatusBadge";
import DriverStatusButton from "@/components/drivers/DriverStatusButton";

type DriverListItem = {
  id: string;
  name: string;
  licenseNumber: string;
  vehicleType: "VAN" | "SEDAN" | null;
  subscriptionExempt: boolean;
  status: "ACTIVE" | "INACTIVE";
  balance: string;
};

// A positive balance means the driver owes the company (commission to collect);
// a negative balance means the driver is in credit. Colour + a short label make
// the sign meaningful without relying on colour alone.
function balanceMeta(balance: string) {
  const value = Number(balance.replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(value) || value === 0) {
    return { tone: "text-subtle", note: "Settled" };
  }
  return value > 0
    ? { tone: "text-warning", note: "Owed to company" }
    : { tone: "text-success", note: "Driver credit" };
}

export default function DriversList({ items }: { items: DriverListItem[] }) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredItems = useMemo(() => {
    if (!normalizedQuery) return items;

    return items.filter(
      (driver) =>
        driver.name.toLocaleLowerCase().includes(normalizedQuery) ||
        driver.licenseNumber.toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [items, normalizedQuery]);

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted">
          Search drivers
        </span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name or license number"
          className="h-11 w-full rounded-lg border border-app-border bg-surface-2 px-3 text-base text-white outline-none placeholder:text-subtle focus:border-brand/50 focus:ring-2 focus:ring-brand/25"
        />
      </label>

      <p className="text-xs text-subtle">
        {filteredItems.length} {filteredItems.length === 1 ? "driver" : "drivers"}
      </p>

      {filteredItems.length === 0 ? (
        <div className="rounded-xl border border-app-border bg-surface p-8 text-center">
          <p className="text-sm text-muted">
            {items.length === 0
              ? "No drivers have been created yet."
              : "No drivers match your search."}
          </p>
          {items.length === 0 ? (
            <Link
              href="/drivers/new"
              className="mt-4 inline-flex h-10 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-brand-fg hover:bg-brand-hover"
            >
              Create driver
            </Link>
          ) : null}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {filteredItems.map((driver) => {
            const meta = balanceMeta(driver.balance);
            return (
              <li
                key={driver.id}
                className="min-w-0 rounded-xl border border-app-border bg-surface p-4 transition hover:border-app-border-strong"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/drivers/${driver.id}`}
                      className="break-words text-lg font-semibold text-white hover:text-brand"
                    >
                      {driver.name}
                    </Link>
                    <p className="mt-1 break-all text-sm text-muted">
                      License {driver.licenseNumber}
                    </p>
                    <p
                      className={
                        driver.vehicleType
                          ? "mt-1 text-xs text-subtle"
                          : "mt-1 text-xs font-medium text-warning"
                      }
                    >
                      Vehicle {driver.vehicleType ?? "Not set - configuration required"}
                      {driver.subscriptionExempt ? " · Subscription exempt" : ""}
                    </p>
                  </div>
                  <DriverStatusBadge status={driver.status} />
                </div>

                <dl className="mt-4 border-t border-app-border pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-sm text-muted">Current balance</dt>
                    <dd className="text-right">
                      <span className={`tnum font-semibold ${meta.tone}`}>
                        {driver.balance}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-subtle">
                        {meta.note}
                      </span>
                    </dd>
                  </div>
                </dl>

                <div className="mt-4 flex flex-wrap items-start gap-2">
                  <Link
                    href={`/drivers/${driver.id}`}
                    className="inline-flex h-10 items-center rounded-lg bg-brand px-3 text-sm font-semibold text-brand-fg hover:bg-brand-hover"
                  >
                    View
                  </Link>
                  <Link
                    href={`/drivers/${driver.id}/edit`}
                    className="inline-flex h-10 items-center rounded-lg border border-app-border px-3 text-sm font-medium text-muted hover:bg-white/5 hover:text-white"
                  >
                    Edit
                  </Link>
                  <DriverStatusButton
                    id={driver.id}
                    name={driver.name}
                    status={driver.status}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
