"use client";

import { useState, useEffect, type ReactNode } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";

/* ---------- Types ---------- */
type Reservation = {
  id: string;
  startAt: number;            // epoch ms
  endAt?: number | null;
  pickupText?: string | null;
  dropoffText?: string | null;
  pax: number;
  priceEuro?: number | null;
  phone?: string | null;
  flight?: string | null;
  notes?: string | null;
  // (status removed)
};

type Props = { items: Reservation[] };

/* ---------- Helpers ---------- */
function fmtDateParts(ms: number) {
  const d = new Date(ms);
  const date = d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return { date, time };
}

/* Reusable tiny field row */
function Field({
  label,
  value,
}: {
  label: string;
  value: string | number | ReactNode;
}) {
  return (
    <div className="text-sm leading-6">
      <span className="text-neutral-400 font-medium">{label}: </span>
      <span className="text-neutral-100">{value}</span>
    </div>
  );
}

/* Small inline calendar icon (no extra deps) */
function CalendarIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

/* Small inline trash icon for Delete (no extra deps) */
function TrashIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

/* Build best calendar link for a reservation (Android => Google; others => ICS) */
function getReminderLink(r: Reservation) {
  const start = new Date(r.startAt);
  const end = new Date(r.endAt ?? start.getTime() + 60 * 60 * 1000); // default 1h

  // YYYYMMDDTHHMMSSZ in UTC
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) =>
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z";

  const base = "https://calendar.google.com/calendar/render";
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: "Assign booking",
    dates: `${fmt(start)}/${fmt(end)}`,
    details: "You have a booking to assign in 45 minutes",
  });
  if (r.pickupText) params.set("location", r.pickupText);

  const ua = typeof navigator !== "undefined" ? navigator.userAgent.toLowerCase() : "";
  const isAndroid = /android/.test(ua);

  // Android → Google Calendar; iOS/mac/Windows → ICS (your API route)
  return isAndroid ? `${base}?${params.toString()}` : `/api/ics/${r.id}`;
}

/* ---------- Component ---------- */
export default function ReservationsList({ items }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  // keep local rows (for optimistic delete) but sync when props change (after sort)
  const [rows, setRows] = useState<Reservation[]>(items);
  useEffect(() => setRows(items), [items]);

  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // ---- SORT control (updates ?sort=asc|desc in the URL) ----
  const sort = sp.get("sort") === "asc" ? "asc" : "desc";
  function onChangeSort(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(sp?.toString() || "");
    params.set("sort", e.target.value);
    const url = `${pathname}?${params.toString()}`;
    router.replace(url);
    router.refresh();
  }

  // ✅ UPDATED delete logic (mark as deleted instead of removing)
  async function handleDelete(id: string) {
    if (!confirm("Move this reservation to Deleted list?")) return;

    // optimistic update
    setBusyId(id);
    const prev = rows;
    setRows(prev.filter((r) => r.id !== id));

    try {
      const res = await fetch(`/api/reservations/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      router.refresh(); // revalidate server list
    } catch (e) {
      // rollback on error
      setRows(prev);
      alert("Failed to move to deleted list. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="mt-6 rounded-xl border border-white/10 p-6 text-center text-sm text-neutral-400">
        No reservations found.
      </div>
    );
  }

  return (
    <>
      {/* Sort bar */}
      <div className="mb-4 flex items-center gap-2">
        <span className="text-sm text-neutral-300">Sort by time:</span>
        <select
          value={sort}
          onChange={onChangeSort}
          className="rounded-md border border-white/10 bg-black/30 px-3 py-1.5 text-sm"
        >
          <option value="desc">Newest first</option>
          <option value="asc">Oldest first</option>
        </select>
      </div>

      <ul className="mt-2 grid gap-4">
        {rows.map((r) => {
          const { date, time } = fmtDateParts(r.startAt);
          const open = openId === r.id;

          return (
            <li
              key={r.id}
              className="rounded-xl border border-white/10 bg-[#0e1426] shadow-sm transition hover:border-white/20"
            >
              {/* Header row */}
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-baseline gap-3">
                  <div className="text-base font-semibold">{date}</div>
                  <div className="text-sm text-neutral-400">{time}</div>
                </div>

                {/* Keep on one line: no wrap + tighter gap */}
                <div className="flex items-center gap-2 sm:gap-2 flex-nowrap">
                  <button
                    onClick={() => setOpenId(open ? null : r.id)}
                    className="rounded-md border border-white/10 px-3 py-1.5 text-sm hover:bg-white/5"
                  >
                    {open ? "Hide" : "Details"}
                  </button>

                  {/* Edit button */}
                  <Link
                    href={`/reservations/${r.id}/edit`}
                    className="rounded-md border border-white/10 px-3 py-1.5 text-sm hover:bg-white/5"
                    title="Edit reservation"
                  >
                    Edit
                  </Link>

                  {/* 📅 Icon-only Reminder button (compact) */}
                  <button
                    onClick={() => {
                      const link = getReminderLink(r);
                      window.open(link, "_blank");
                    }}
                    title="Add Reminder (45m before)"
                    aria-label="Add Reminder (45m before)"
                    className="rounded-md border border-white/10 p-1 hover:bg-white/5"
                  >
                    <CalendarIcon className="h-4 w-4" />
                  </button>

                  {/* 🗑️ Icon-only Delete button (compact, red) */}
                  <button
                    disabled={busyId === r.id}
                    onClick={() => handleDelete(r.id)}
                    title={busyId === r.id ? "Moving…" : "Move to Deleted list"}
                    aria-label="Move to Deleted list"
                    className={`rounded-md p-1 border ${
                      busyId === r.id
                        ? "cursor-wait opacity-60 border-red-600/30 bg-red-700/20 text-red-200"
                        : "border-red-600/30 bg-red-600/20 text-red-300 hover:bg-red-600/30"
                    }`}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Details */}
              {open && (
                <div className="grid gap-1.5 border-t border-white/10 px-4 py-3">
                  {r.pickupText && <Field label="Pickup" value={r.pickupText} />}
                  {r.dropoffText && <Field label="Drop-off" value={r.dropoffText} />}
                  <Field label="Pax" value={r.pax} />
                  {typeof r.priceEuro === "number" && <Field label="Price" value={`${r.priceEuro}€`} />}
                  {r.phone && <Field label="Phone" value={r.phone} />}
                  {r.flight && <Field label="Flight" value={r.flight} />}
                  {r.notes && (
                    <Field label="Notes" value={<span className="whitespace-pre-wrap">{r.notes}</span>} />
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
