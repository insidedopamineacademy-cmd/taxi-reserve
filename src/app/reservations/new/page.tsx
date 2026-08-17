// src/app/reservations/new/page.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { localDateTimeToUtcIso } from "@/lib/parseStartAt";

export default function NewReservation() {
  const [form, setForm] = useState({
    pickupText: "",
    dropoffText: "",
    date: "",
    time: "",
    pax: 1,
    priceEuro: "",
    phone: "",
    flight: "",
    notes: "",
  });
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);

    // Convert local wall-time -> UTC ISO (ends with "Z")
    const startAtLocal = form.date && form.time ? `${form.date}T${form.time}` : "";
    const iso = localDateTimeToUtcIso(startAtLocal);
    if (!iso) {
      setLoading(false);
      setMsg("Please provide a valid date and time.");
      return;
    }

    const payload = {
      pickupText: form.pickupText || null,
      dropoffText: form.dropoffText || null,
      startAt: iso,                                   // <-- UTC ISO
      pax: Number(form.pax) || 1,
      priceEuro: form.priceEuro ? Number(form.priceEuro) : null,
      phone: form.phone || null,
      flight: form.flight || null,
      notes: form.notes ? form.notes.slice(0, 2000) : null,
    };

    const res = await fetch("/api/reservations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setLoading(false);

    if (res.ok) {
      window.location.href = "/reservations";
      return;
    }

    if (res.status === 401) {
      setMsg("Please log in first.");
      window.location.href = "/login";
      return;
    }

    const j = await res.json().catch(() => ({ error: "Failed to save" }));
    setMsg(j.error || "Failed to save");
  }

  const inputClass =
    "h-11 w-full rounded-lg border border-app-border bg-surface-2 px-3 text-[15px] text-white placeholder:text-subtle outline-none focus:border-brand/50 focus:ring-2 focus:ring-brand/25";
  const textareaClass =
    "min-h-[96px] w-full rounded-lg border border-app-border bg-surface-2 px-3 py-2 text-[15px] text-white placeholder:text-subtle outline-none focus:border-brand/50 focus:ring-2 focus:ring-brand/25";
  const labelClass = "mb-1.5 block text-sm font-medium text-muted";
  const sectionClass =
    "text-xs font-semibold uppercase tracking-wide text-subtle";

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">New reservation</h1>
        <p className="mt-1 text-sm text-muted">
          Create a booking. Date and time are required.
        </p>
      </div>

      <form
        onSubmit={submit}
        className="rounded-2xl border border-app-border bg-surface p-5 shadow-sm sm:p-6"
      >
        <div className="grid gap-6">
          {/* Trip */}
          <fieldset className="grid gap-4">
            <legend className={sectionClass}>Trip</legend>
            <label className="block">
              <span className={labelClass}>Pickup address</span>
              <input
                className={inputClass}
                placeholder="Pickup address"
                value={form.pickupText}
                onChange={(e) => setForm({ ...form, pickupText: e.target.value })}
              />
            </label>
            <label className="block">
              <span className={labelClass}>Drop-off address</span>
              <input
                className={inputClass}
                placeholder="Drop-off address"
                value={form.dropoffText}
                onChange={(e) => setForm({ ...form, dropoffText: e.target.value })}
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block min-w-0">
                <span className={labelClass}>Date</span>
                <input
                  type="date"
                  required
                  className={`${inputClass} [color-scheme:dark]`}
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              </label>
              <label className="block min-w-0">
                <span className={labelClass}>Time</span>
                <input
                  type="time"
                  required
                  className={`${inputClass} [color-scheme:dark]`}
                  value={form.time}
                  onChange={(e) => setForm({ ...form, time: e.target.value })}
                />
              </label>
            </div>
          </fieldset>

          <hr className="border-app-border" />

          {/* Booking details */}
          <fieldset className="grid gap-4">
            <legend className={sectionClass}>Booking details</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block min-w-0">
                <span className={labelClass}>Passengers</span>
                <input
                  type="number"
                  min={1}
                  className={`${inputClass} tnum`}
                  value={form.pax}
                  onChange={(e) => setForm({ ...form, pax: Number(e.target.value) })}
                />
              </label>
              <label className="block min-w-0">
                <span className={labelClass}>Price (EUR)</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  className={`${inputClass} tnum`}
                  placeholder="0.00"
                  value={form.priceEuro}
                  onChange={(e) => setForm({ ...form, priceEuro: e.target.value })}
                />
              </label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block min-w-0">
                <span className={labelClass}>Client phone</span>
                <input
                  type="tel"
                  className={inputClass}
                  placeholder="Client phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </label>
              <label className="block min-w-0">
                <span className={labelClass}>Flight number</span>
                <input
                  className={inputClass}
                  placeholder="Optional"
                  value={form.flight}
                  onChange={(e) => setForm({ ...form, flight: e.target.value })}
                />
              </label>
            </div>
          </fieldset>

          <hr className="border-app-border" />

          <label className="block">
            <span className={labelClass}>Notes</span>
            <textarea
              className={textareaClass}
              placeholder="Any extra details for this booking…"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </label>

          {msg && (
            <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {msg}
            </p>
          )}
        </div>

        <div className="mt-6 flex items-center justify-end gap-2 border-t border-app-border pt-5">
          <Link
            href="/reservations"
            className="inline-flex h-11 items-center justify-center rounded-lg border border-app-border px-4 text-[15px] font-medium text-muted hover:bg-white/5 hover:text-white"
          >
            Cancel
          </Link>
          <button
            disabled={loading}
            className="inline-flex h-11 items-center justify-center rounded-lg bg-brand px-5 text-[15px] font-semibold text-brand-fg transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Saving…" : "Save reservation"}
          </button>
        </div>
      </form>
    </main>
  );
}
