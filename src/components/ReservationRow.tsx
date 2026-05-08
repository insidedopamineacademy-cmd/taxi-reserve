"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { updateReservationField } from "@/app/reservations/actions";
import type { ReservationStatus } from "@/app/reservations/actions";
import { relTimeFromNow } from "@/lib/parseStartAt";

const STATUS_OPTIONS: ReservationStatus[] = ["Pending", "Assigned", "Completed", "R received"];

type Props = {
  res: {
    id: string;
    startAt: number; // epoch ms (UTC)
    pickupText: string | null;
    dropoffText: string | null;
    pax: number | null;
    priceEuro: number | null;
    notes: string | null;
    status: ReservationStatus;
  };
};

export default function ReservationRow({ res }: Props) {
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<ReservationStatus>(res.status);
  const [notes, setNotes] = useState(res.notes ?? "");
  const [notesDirty, setNotesDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const saveStatus = (next: ReservationStatus) => {
    setStatus(next);
    startTransition(async () => {
      try {
        setSaving(true);
        await updateReservationField(res.id, { status: next });
      } finally {
        setSaving(false);
      }
    });
  };

  const saveNotes = () => {
    if (!notesDirty) return;
    startTransition(async () => {
      try {
        setSaving(true);
        await updateReservationField(res.id, { notes });
        setNotesDirty(false);
      } finally {
        setSaving(false);
      }
    });
  };

  // --- Reminder helper (auto-detect) ---
  function getCalendarLink() {
    const start = new Date(res.startAt);
    const end = new Date(start.getTime() + 60 * 60 * 1000); // default 1h

    const pad = (n: number) => String(n).padStart(2, "0");
    const fmtGCal = (d: Date) =>
      d.getUTCFullYear().toString() +
      pad(d.getUTCMonth() + 1) +
      pad(d.getUTCDate()) +
      "T" +
      pad(d.getUTCHours()) +
      pad(d.getUTCMinutes()) +
      pad(d.getUTCSeconds()) +
      "Z";

    // Google Calendar deep link (we keep it minimal; the notification is set within GCal UI)
    const gcal = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=Assign+booking&dates=${fmtGCal(
      start
    )}/${fmtGCal(end)}&details=You+have+a+booking+to+assign+in+45+minutes&location=${encodeURIComponent(
      res.pickupText ?? ""
    )}`;

    const ua = typeof navigator !== "undefined" ? navigator.userAgent.toLowerCase() : "";
    const isAndroid = /android/.test(ua);

    // Android → Google Calendar; iOS/mac/others → ICS
    if (isAndroid) return gcal;
    return `/api/ics/${res.id}`;
  }

  const handleReminderClick = () => {
    const link = getCalendarLink();
    // Open in new tab/window to preserve current list state
    window.open(link, "_blank");
  };

  const dt = new Date(res.startAt);
  const startAtText = dt.toLocaleString("en-GB", {
    dateStyle: "short",
    timeStyle: "short",
  });

  const rel = relTimeFromNow(dt);
  const chipClass = rel.includes("ago")
    ? "bg-red-100 text-red-800"
    : rel.startsWith("in 0")
    ? "bg-orange-100 text-orange-800"
    : "bg-gray-100 text-gray-800";

  return (
    <div className="flex items-start justify-between gap-3 rounded-lg bg-slate-900/60 p-3 ring-1 ring-slate-800">
      <div className="min-w-0">
        <div className="text-sm text-slate-200">
          <span className="font-medium">{res.pickupText || "—"}</span>
          <span className="mx-1 text-slate-500">→</span>
          <span className="font-medium">{res.dropoffText || "—"}</span>
        </div>

        <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
          <span>{startAtText}</span>
          <span className={`rounded px-2 py-0.5 text-[10px] ${chipClass}`}>{rel}</span>
        </div>

        <div className="mt-3">
          <label className="mb-1 block text-xs text-slate-400">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              setNotesDirty(true);
            }}
            onBlur={saveNotes}
            placeholder="Add notes…"
            rows={2}
            className="w-full resize-y rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-slate-100 outline-none focus:border-slate-500"
          />
          {notesDirty && (
            <button
              onClick={saveNotes}
              className="mt-1 rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-500"
            >
              Save notes
            </button>
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-2">
        <div className="text-right">
          <label className="mb-1 block text-xs text-slate-400">Status</label>
          <select
            value={status}
            onChange={(e) => saveStatus(e.target.value as ReservationStatus)}
            className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-slate-100 outline-none focus:border-slate-500"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {/* 📅 NEW: Reminder button (auto-detects iOS vs Android/Google) */}
        <button
          onClick={handleReminderClick}
          title="Add Reminder (45 min before)"
          aria-label="Add Reminder (45 min before)"
          className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-slate-100 hover:bg-slate-700"
        >
          📅 Reminder
        </button>

        {/* NEW: Edit button (kept exactly as you had it) */}
        <Link
          href={`/reservations/${res.id}/edit`}
          className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-slate-100 hover:bg-slate-700"
        >
          Edit
        </Link>

        {(isPending || saving) && <span className="text-xs text-slate-400">Saving…</span>}
      </div>
    </div>
  );
}
