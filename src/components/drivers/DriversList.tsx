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
        <span className="mb-1 block text-xs font-medium text-neutral-400">
          Search drivers
        </span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name or license number"
          className="h-11 w-full rounded-md border border-white/10 bg-black/30 px-3 text-base text-white outline-none placeholder:text-neutral-500 focus:border-white/30 focus:ring-2 focus:ring-white/10"
        />
      </label>

      <p className="text-xs text-neutral-500">
        {filteredItems.length} {filteredItems.length === 1 ? "driver" : "drivers"}
      </p>

      {filteredItems.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-[#0e1426] p-8 text-center">
          <p className="text-sm text-neutral-400">
            {items.length === 0
              ? "No drivers have been created yet."
              : "No drivers match your search."}
          </p>
          {items.length === 0 ? (
            <Link
              href="/drivers/new"
              className="mt-4 inline-flex h-10 items-center rounded-md bg-yellow-500 px-4 text-sm font-semibold text-black hover:bg-yellow-400"
            >
              Create driver
            </Link>
          ) : null}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {filteredItems.map((driver) => (
            <li
              key={driver.id}
              className="min-w-0 rounded-xl border border-white/10 bg-[#0e1426] p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    href={`/drivers/${driver.id}`}
                    className="break-words text-lg font-semibold text-white hover:text-yellow-400"
                  >
                    {driver.name}
                  </Link>
                  <p className="mt-1 break-all text-sm text-neutral-400">
                    License {driver.licenseNumber}
                  </p>
                  <p
                    className={
                      driver.vehicleType
                        ? "mt-1 text-xs text-neutral-500"
                        : "mt-1 text-xs font-medium text-yellow-300"
                    }
                  >
                    Vehicle {driver.vehicleType ?? "Not set - configuration required"}
                    {driver.subscriptionExempt ? " · Subscription exempt" : ""}
                  </p>
                </div>
                <DriverStatusBadge status={driver.status} />
              </div>

              <dl className="mt-4 border-t border-white/10 pt-4">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-sm text-neutral-400">Current balance</dt>
                  <dd className="font-semibold text-white">{driver.balance}</dd>
                </div>
              </dl>

              <div className="mt-4 flex flex-wrap items-start gap-2">
                <Link
                  href={`/drivers/${driver.id}`}
                  className="inline-flex h-10 items-center rounded-md bg-yellow-500 px-3 text-sm font-semibold text-black hover:bg-yellow-400"
                >
                  View
                </Link>
                <Link
                  href={`/drivers/${driver.id}/edit`}
                  className="inline-flex h-10 items-center rounded-md border border-white/10 px-3 text-sm font-medium text-neutral-200 hover:bg-white/5"
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
          ))}
        </ul>
      )}
    </div>
  );
}
