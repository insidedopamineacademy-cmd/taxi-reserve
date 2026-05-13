"use client";

import { useState, useEffect, type ReactNode } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  nextReservationStatusCode,
  normalizeReservationStatusCode,
  reservationStatusLabel,
} from "@/lib/reservationStatus";

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
  status?: string | null;
};

type Props = {
  items: Reservation[];
  showEdit?: boolean;
  showShare?: boolean;
  showStatus?: boolean;
  showSoftDelete?: boolean;
  showSort?: boolean;
};

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

function fmtShareDateParts(ms: number) {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return null;
  return {
    date: d.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
    time: d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
  };
}

function statusChipClass(status?: string | null) {
  const code = normalizeReservationStatusCode(status);
  if (code === "COMPLETED") {
    return "border-green-500/40 bg-green-500/15 text-green-100 hover:bg-green-500/25";
  }
  if (code === "ASSIGNED") {
    return "border-blue-500/40 bg-blue-500/15 text-blue-100 hover:bg-blue-500/25";
  }
  return "border-amber-500/40 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25";
}

function addShareSection(
  lines: string[],
  title: string,
  fields: Array<string | null | undefined | false>
) {
  const visibleFields = fields.filter(Boolean) as string[];
  if (visibleFields.length === 0) return;
  lines.push("", title, ...visibleFields);
}

function buildWhatsAppShareLink(r: Reservation) {
  const when = fmtShareDateParts(r.startAt);
  const lines = ["Taxi Reservation Details"];

  addShareSection(lines, "📍 TRIP", [
    r.pickupText && `Pickup: ${r.pickupText}`,
    r.dropoffText && `Dropoff: ${r.dropoffText}`,
    r.flight && `Flight: ${r.flight}`,
  ]);
  addShareSection(lines, "📅 SCHEDULE", [
    when && `Date: ${when.date}`,
    when && `Time: ${when.time}`,
  ]);
  addShareSection(lines, "👤 CUSTOMER", [
    r.phone && `Phone: ${r.phone}`,
    `Passengers: ${r.pax}`,
  ]);
  addShareSection(lines, "📝 NOTES", [r.notes && `Notes: ${r.notes}`]);
  addShareSection(lines, "💰 BOOKING", [
    `Status: ${reservationStatusLabel(r.status)}`,
    typeof r.priceEuro === "number" && `Price: ${r.priceEuro} EUR`,
  ]);

  return `https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`;
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

/* ---------- Component ---------- */
export default function ReservationsList({
  items,
  showEdit = true,
  showShare = true,
  showStatus = true,
  showSoftDelete = true,
  showSort = true,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  // keep local rows (for optimistic delete) but sync when props change (after sort)
  const [rows, setRows] = useState<Reservation[]>(items);
  useEffect(() => setRows(items), [items]);

  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);

  // ---- SORT control (updates ?sort=closest|asc|desc in the URL) ----
  const sortParam = sp.get("sort");
  const sort =
    sortParam === "asc" || sortParam === "desc" || sortParam === "closest"
      ? sortParam
      : "closest";
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
    } catch {
      // rollback on error
      setRows(prev);
      alert("Failed to move to deleted list. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleStatusCycle(reservation: Reservation) {
    if (statusBusyId) return;

    const nextStatus = nextReservationStatusCode(reservation.status);
    const prev = rows;
    setStatusBusyId(reservation.id);
    setRows((current) =>
      current.map((row) =>
        row.id === reservation.id ? { ...row, status: nextStatus } : row
      )
    );

    try {
      const res = await fetch(`/api/reservations/${reservation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) throw new Error("Status update failed");
    } catch {
      setRows(prev);
      alert("Failed to update status. Please try again.");
    } finally {
      setStatusBusyId(null);
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
      {showSort && (
        <div className="mb-4 flex items-center gap-2">
          <span className="text-sm text-neutral-300">Sort by time:</span>
          <select
            value={sort}
            onChange={onChangeSort}
            className="rounded-md border border-white/10 bg-black/30 px-3 py-1.5 text-sm"
          >
            <option value="closest">Closest first</option>
            <option value="desc">Newest first</option>
            <option value="asc">Oldest first</option>
          </select>
        </div>
      )}

      <ul className="mt-2 grid gap-4">
        {rows.map((r) => {
          const { date, time } = fmtDateParts(r.startAt);
          const open = openId === r.id;
          const statusLabel = reservationStatusLabel(r.status);

          return (
            <li
              key={r.id}
              className="rounded-xl border border-white/10 bg-[#0e1426] shadow-sm transition hover:border-white/20"
            >
              {/* Header row */}
              <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-baseline gap-3">
                  <div className="text-base font-semibold">{date}</div>
                  <div className="text-sm text-neutral-400">{time}</div>
                </div>

                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <button
                    onClick={() => setOpenId(open ? null : r.id)}
                    className="rounded-md border border-white/10 px-3 py-1.5 text-sm hover:bg-white/5"
                  >
                    {open ? "Hide" : "Details"}
                  </button>

                  {showEdit && (
                    <Link
                      href={`/reservations/${r.id}/edit`}
                      className="rounded-md border border-white/10 px-3 py-1.5 text-sm hover:bg-white/5"
                      title="Edit reservation"
                    >
                      Edit
                    </Link>
                  )}

                  {showShare && (
                    <button
                      onClick={() => {
                        window.open(buildWhatsAppShareLink(r), "_blank", "noopener,noreferrer");
                      }}
                      className="rounded-md border border-green-600/40 bg-green-600/20 px-3 py-1.5 text-sm text-green-100 hover:bg-green-600/30"
                    >
                      Share WhatsApp
                    </button>
                  )}

                  {showStatus && (
                    <button
                      type="button"
                      disabled={statusBusyId === r.id}
                      onClick={() => handleStatusCycle(r)}
                      title={`Status: ${statusLabel}. Tap to change.`}
                      aria-label={`Status: ${statusLabel}. Tap to change.`}
                      className={`rounded-full border px-2.5 py-1.5 text-xs font-medium transition disabled:cursor-wait disabled:opacity-60 ${statusChipClass(
                        r.status
                      )}`}
                    >
                      {statusLabel}
                    </button>
                  )}

                  {showSoftDelete && (
                    <button
                      disabled={busyId === r.id}
                      onClick={() => handleDelete(r.id)}
                      title={busyId === r.id ? "Moving..." : "Move to Deleted list"}
                      aria-label="Move to Deleted list"
                      className={`rounded-md p-1 border ${
                        busyId === r.id
                          ? "cursor-wait opacity-60 border-red-600/30 bg-red-700/20 text-red-200"
                          : "border-red-600/30 bg-red-600/20 text-red-300 hover:bg-red-600/30"
                      }`}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  )}
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
                  {statusLabel && <Field label="Status" value={statusLabel} />}
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
