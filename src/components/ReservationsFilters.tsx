// src/components/ReservationsFilters.tsx
"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { RESERVATION_STATUS_OPTIONS } from "@/lib/reservationStatus";

const STATUS_OPTIONS = [{ code: "ALL", label: "All statuses" }, ...RESERVATION_STATUS_OPTIONS] as const;

export default function ReservationsFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const status = params.get("status") ?? "ALL";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const sort = (params.get("sort") as "asc" | "desc") ?? "desc";

  function apply(patch: Record<string, string | null | undefined>) {
    const q = new URLSearchParams(params.toString());

    // remove any legacy search param
    q.delete("q");

    Object.entries(patch).forEach(([k, v]) => {
      if (v === undefined || v === null || v === "") q.delete(k);
      else q.set(k, v);
    });

    router.push(`${pathname}?${q.toString()}`);
  }

  function clearDates() {
    apply({ from: "", to: "" });
  }

  return (
    <div className="mb-4 grid gap-3 md:grid-cols-5">
      {/* Status */}
      <select
        value={status}
        onChange={(e) => apply({ status: e.target.value === "ALL" ? "" : e.target.value })}
        className="rounded-md border border-gray-600 bg-gray-900 text-gray-100 px-3 py-2"
      >
        {STATUS_OPTIONS.map((option) => (
          <option key={option.code} value={option.code}>
            {option.label}
          </option>
        ))}
      </select>

      {/* From / To */}
      <input
        type="date"
        value={from}
        onChange={(e) => apply({ from: e.target.value })}
        className="rounded-md border border-gray-600 bg-gray-900 text-gray-100 px-3 py-2"
      />
      <input
        type="date"
        value={to}
        onChange={(e) => apply({ to: e.target.value })}
        className="rounded-md border border-gray-600 bg-gray-900 text-gray-100 px-3 py-2"
      />

      {/* Sort */}
      <div className="md:col-span-2 flex items-center gap-2">
        <label className="text-sm text-gray-400">Sort by time:</label>
        <select
          value={sort}
          onChange={(e) => apply({ sort: e.target.value as "asc" | "desc" })}
          className="rounded-md border border-gray-600 bg-gray-900 text-gray-100 px-3 py-1.5"
        >
          <option value="desc">Newest first</option>
          <option value="asc">Oldest first</option>
        </select>

        <button
          onClick={clearDates}
          className="ml-auto rounded-md bg-white/10 px-3 py-2 hover:bg-white/20"
        >
          Clear dates
        </button>
      </div>
    </div>
  );
}
