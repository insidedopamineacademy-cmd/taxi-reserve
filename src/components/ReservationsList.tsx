"use client";

import { useState, useEffect, useMemo, type ReactNode } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { PhoneActions } from "@/components/PhoneActions";
import { formatLocalInstantDateDisplay } from "@/lib/dateDisplay";
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
  driverName?: string;
  commissionAmount?: string;
};

type Props = {
  items: Reservation[];
  showEdit?: boolean;
  showShare?: boolean;
  showStatus?: boolean;
  showRestore?: boolean;
  showSoftDelete?: boolean;
  showSort?: boolean;
  showDriverShortcut?: boolean;
};

/* ---------- Helpers ---------- */
function fmtDateParts(ms: number) {
  const d = new Date(ms);
  const date = formatLocalInstantDateDisplay(d);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return { date, time };
}

function fmtShareDateParts(ms: number) {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return null;
  return {
    date: formatLocalInstantDateDisplay(d),
    time: d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
  };
}

function statusChipClass(status?: string | null) {
  const code = normalizeReservationStatusCode(status);
  // COMPLETED = "Cobrado" (paid) -> success; ASSIGNED = "Falta cobrar" (to
  // collect) -> warning. Text label + a leading dot keep it readable without
  // relying on color alone.
  if (code === "COMPLETED") {
    return "border-success/30 bg-success/12 text-success hover:bg-success/20";
  }
  return "border-warning/30 bg-warning/12 text-warning hover:bg-warning/20";
}

function statusDotClass(status?: string | null) {
  return normalizeReservationStatusCode(status) === "COMPLETED"
    ? "bg-success"
    : "bg-warning";
}

const euroFmt = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
});

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
  addShareSection(lines, "🚕 DRIVER", [
    r.driverName && `Driver: ${r.driverName}`,
    r.commissionAmount && `Commission: €${r.commissionAmount}`,
  ]);

  return `https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`;
}

function normalizeSearchText(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizePhone(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function phoneMatchesSearch(phone: unknown, queryDigits: string) {
  if (queryDigits.length < 3) return false;

  const phoneDigits = normalizePhone(phone);
  if (!phoneDigits) return false;

  return (
    phoneDigits.includes(queryDigits) ||
    (queryDigits.length >= 6 &&
      phoneDigits.length >= 6 &&
      queryDigits.includes(phoneDigits))
  );
}

function reservationMatchesSearch(
  r: Reservation,
  textQuery: string,
  phoneQuery: string
) {
  if (!textQuery && phoneQuery.length < 3) return true;

  const { date, time } = fmtDateParts(r.startAt);
  const fields = [
    r.phone,
    r.pickupText,
    r.dropoffText,
    r.flight,
    r.notes,
    r.driverName,
    typeof r.priceEuro === "number" ? String(r.priceEuro) : null,
    reservationStatusLabel(r.status),
    date,
    time,
  ];

  return (
    fields.some((field) => normalizeSearchText(field).includes(textQuery)) ||
    phoneMatchesSearch(r.phone, phoneQuery)
  );
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

function SearchIcon(props: React.SVGProps<SVGSVGElement>) {
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
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function XIcon(props: React.SVGProps<SVGSVGElement>) {
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
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

/* iOS-style share icon */
function ShareIcon(props: React.SVGProps<SVGSVGElement>) {
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
      <path d="M12 3v12" />
      <path d="m7 8 5-5 5 5" />
      <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
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

/* ---------- Component ---------- */
export default function ReservationsList({
  items,
  showEdit = true,
  showShare = true,
  showStatus = true,
  showRestore = false,
  showSoftDelete = true,
  showSort = true,
  showDriverShortcut = false,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  // keep local rows (for optimistic delete) but sync when props change (after sort)
  const [rows, setRows] = useState<Reservation[]>(items);
  useEffect(() => setRows(items), [items]);

  const [search, setSearch] = useState("");
  const searchQuery = normalizeSearchText(search);
  const phoneSearchQuery = normalizePhone(search);
  const filteredRows = useMemo(
    () =>
      rows.filter((row) =>
        reservationMatchesSearch(row, searchQuery, phoneSearchQuery)
      ),
    [rows, searchQuery, phoneSearchQuery]
  );

  // Group the already-ordered rows by their (local) calendar date so each date
  // shows a single divider heading. Rows are sorted by time, so same-date rows
  // are always contiguous -> exactly one group per date, order preserved. The
  // group key is the same shared DD MMM YYYY string rendered in the divider, so
  // the label always matches and there is no timezone/UTC day drift.
  const groupedRows = useMemo(() => {
    const groups: Array<{ date: string; rows: Reservation[] }> = [];
    for (const row of filteredRows) {
      const { date } = fmtDateParts(row.startAt);
      const current = groups[groups.length - 1];
      if (current && current.date === date) current.rows.push(row);
      else groups.push({ date, rows: [row] });
    }
    return groups;
  }, [filteredRows]);

  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [restoreBusyId, setRestoreBusyId] = useState<string | null>(null);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);

  // ---- SORT control (updates ?sort=asc|desc in the URL) ----
  const sortParam = sp.get("sort");
  const sort = sortParam === "desc" ? "desc" : "asc";
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

  async function handleRestore(id: string) {
    if (!confirm("Restore this reservation?")) return;

    setRestoreBusyId(id);
    const prev = rows;
    setRows(prev.filter((r) => r.id !== id));

    try {
      const res = await fetch(`/api/reservations/${id}/restore`, { method: "PATCH" });
      if (!res.ok) throw new Error("Restore failed");
      router.refresh();
    } catch {
      setRows(prev);
      alert("Failed to restore reservation. Please try again.");
    } finally {
      setRestoreBusyId(null);
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
        <div className="mb-4">
          <label htmlFor="reservation-search" className="sr-only">
            Search reservations
          </label>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
            <input
              id="reservation-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search phone, pickup, drop-off, flight or notes"
              autoComplete="off"
              className="h-11 w-full rounded-md border border-white/10 bg-black/30 pl-10 pr-10 text-sm text-neutral-100 outline-none placeholder:text-neutral-500 focus:border-white/25 focus:ring-2 focus:ring-white/10"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                title="Clear search"
                aria-label="Clear search"
                className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-neutral-400 hover:bg-white/10 hover:text-neutral-100"
              >
                <XIcon className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {showSort && (
        <div className="mb-4 flex items-center gap-2">
          <span className="text-sm text-neutral-300">Sort by time:</span>
          <select
            value={sort}
            onChange={onChangeSort}
            className="rounded-md border border-white/10 bg-black/30 px-3 py-1.5 text-sm"
          >
            <option value="asc">Oldest first</option>
            <option value="desc">Newest first</option>
          </select>
        </div>
      )}

      {filteredRows.length === 0 ? (
        <div className="mt-6 rounded-xl border border-app-border p-6 text-center text-sm text-muted">
          No reservations found for this search.
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-6">
          {groupedRows.map((group) => {
            const headingId = `reservation-group-${group.date.replace(/\s+/g, "-")}`;
            return (
              <section key={group.date} aria-labelledby={headingId}>
                {/* Date divider: rule — date — rule (the rules stop before the text) */}
                <div className="flex items-center gap-3">
                  <span aria-hidden="true" className="h-px flex-1 bg-app-border" />
                  <h2 id={headingId} className="text-sm font-semibold text-muted tnum">
                    {group.date}
                  </h2>
                  <span aria-hidden="true" className="h-px flex-1 bg-app-border" />
                </div>

                <ul className="mt-3 grid gap-3">
                  {group.rows.map((r) => {
                    const { time } = fmtDateParts(r.startAt);
                    const open = openId === r.id;
                    const statusLabel = reservationStatusLabel(r.status);

                    return (
                      <li
                        key={r.id}
                        className="rounded-xl border border-app-border bg-surface shadow-sm transition hover:border-app-border-strong"
                      >
                        <div className="flex flex-col gap-2 px-4 py-3">
                          {/* Time (primary temporal identifier) + payment status */}
                          <div className="flex items-center justify-between gap-3">
                            <span className="shrink-0 text-lg font-semibold leading-none text-white tnum">
                              {time}
                            </span>
                            {showStatus && (
                              <button
                                type="button"
                                disabled={statusBusyId === r.id}
                                onClick={() => handleStatusCycle(r)}
                                title={`Status: ${statusLabel}. Tap to change.`}
                                aria-label={`Payment status: ${statusLabel}. Tap to change.`}
                                className={`inline-flex h-8 min-w-0 max-w-[15rem] items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium leading-none transition disabled:cursor-wait disabled:opacity-60 sm:text-xs ${statusChipClass(
                                  r.status
                                )}`}
                              >
                                <span
                                  aria-hidden="true"
                                  className={`size-1.5 shrink-0 rounded-full ${statusDotClass(r.status)}`}
                                />
                                <span className="truncate">{statusLabel}</span>
                              </button>
                            )}
                          </div>

                          {/* Action toolbar: driver control (left) + actions (right) on one row.
                              flex-wrap keeps it one line at >=390px and only wraps the action
                              group onto its own line at very narrow widths (~360px). */}
                          <div className="flex flex-wrap items-center gap-2">
                            {showDriverShortcut ? (
                              <Link
                                href={`/reservations/${r.id}/edit#driver-commission`}
                                className="inline-flex h-9 min-w-0 max-w-full shrink-0 items-center rounded-full border border-brand/25 bg-brand/10 px-3 text-xs font-medium text-brand hover:bg-brand/15"
                                title={r.driverName ? `Edit driver assignment: ${r.driverName}` : "Assign driver"}
                              >
                                <span className="truncate">
                                  {r.driverName ? `Driver: ${r.driverName}` : "Assign Driver"}
                                </span>
                              </Link>
                            ) : null}

                            <div className="ml-auto flex flex-nowrap items-center gap-2">
                            <button
                              onClick={() => setOpenId(open ? null : r.id)}
                              className="inline-flex h-9 shrink-0 items-center rounded-lg border border-app-border px-2.5 text-xs font-medium text-muted hover:bg-white/5 hover:text-white sm:px-3 sm:text-sm"
                            >
                              {open ? "Hide" : "Details"}
                            </button>

                            {showEdit && (
                              <Link
                                href={`/reservations/${r.id}/edit`}
                                className="inline-flex h-9 shrink-0 items-center rounded-lg border border-app-border px-2.5 text-xs font-medium text-muted hover:bg-white/5 hover:text-white sm:px-3 sm:text-sm"
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
                                title="Share to WhatsApp"
                                aria-label="Share to WhatsApp"
                                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-success/30 bg-success/15 text-success transition hover:bg-success/25"
                              >
                                <ShareIcon className="h-4 w-4" />
                              </button>
                            )}

                            {showRestore && (
                              <button
                                type="button"
                                disabled={restoreBusyId === r.id}
                                onClick={() => handleRestore(r.id)}
                                title="Restore reservation"
                                aria-label="Restore reservation"
                                className="inline-flex h-9 shrink-0 items-center rounded-lg border border-success/30 bg-success/15 px-2.5 text-xs font-medium text-success transition hover:bg-success/25 disabled:cursor-wait disabled:opacity-60 sm:px-3 sm:text-sm"
                              >
                                {restoreBusyId === r.id ? "Restoring..." : "Restore"}
                              </button>
                            )}

                            {showSoftDelete && (
                              <button
                                disabled={busyId === r.id}
                                onClick={() => handleDelete(r.id)}
                                title={busyId === r.id ? "Moving..." : "Move to Deleted list"}
                                aria-label="Move to Deleted list"
                                className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition ${
                                  busyId === r.id
                                    ? "cursor-wait border-danger/30 bg-danger/15 text-danger opacity-60"
                                    : "border-danger/30 bg-danger/10 text-danger hover:bg-danger/20"
                                }`}
                              >
                                <TrashIcon className="h-4 w-4" />
                              </button>
                            )}
                            </div>
                          </div>
                        </div>

                        {/* Details */}
                        {open && (
                          <div className="grid gap-1.5 border-t border-app-border px-4 py-3">
                            {r.pickupText && <Field label="Pickup" value={r.pickupText} />}
                            {r.dropoffText && <Field label="Drop-off" value={r.dropoffText} />}
                            <Field label="Pax" value={r.pax} />
                            {typeof r.priceEuro === "number" && (
                              <Field
                                label="Price"
                                value={<span className="tnum font-semibold text-white">{euroFmt.format(r.priceEuro)}</span>}
                              />
                            )}
                            <PhoneActions phone={r.phone} />
                            {r.flight && <Field label="Flight" value={r.flight} />}
                            {statusLabel && <Field label="Status" value={statusLabel} />}
                            {r.driverName && <Field label="Driver" value={r.driverName} />}
                            {r.commissionAmount && (
                              <Field
                                label="Commission"
                                value={<span className="tnum">{`€${r.commissionAmount}`}</span>}
                              />
                            )}
                            {r.notes && (
                              <Field label="Notes" value={<span className="whitespace-pre-wrap">{r.notes}</span>} />
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
