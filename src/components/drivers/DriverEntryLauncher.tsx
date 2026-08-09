"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type EntryKind = "commission" | "payment";

export default function DriverEntryLauncher({
  drivers,
  kind,
}: {
  drivers: Array<{ id: string; name: string; licenseNumber: string }>;
  kind: EntryKind;
}) {
  const router = useRouter();
  const [driverId, setDriverId] = useState(drivers[0]?.id ?? "");
  const label = kind === "commission" ? "manual commission" : "payment";

  if (drivers.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-[#0e1426] p-4 text-sm text-neutral-400">
        Create or activate a driver before recording a new {label}.
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-xl border border-white/10 bg-[#0e1426] p-4 sm:flex-row sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        if (!driverId) return;
        const collection = kind === "commission" ? "commissions" : "payments";
        router.push(`/drivers/${driverId}/${collection}/new`);
      }}
    >
      <label className="min-w-0 flex-1">
        <span className="mb-1 block text-xs font-medium text-neutral-400">
          Active driver
        </span>
        <select
          value={driverId}
          onChange={(event) => setDriverId(event.target.value)}
          className="h-11 w-full rounded-md border border-white/10 bg-black/30 px-3 text-base text-white outline-none focus:border-white/30"
        >
          {drivers.map((driver) => (
            <option key={driver.id} value={driver.id}>
              {driver.name} · {driver.licenseNumber}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        className="h-11 rounded-md bg-yellow-500 px-4 text-sm font-semibold text-black hover:bg-yellow-400"
      >
        {kind === "commission" ? "Add manual commission" : "Record payment"}
      </button>
    </form>
  );
}
