// src/app/reservations/new/page.tsx
"use client";

import { useState } from "react";
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
    "h-11 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-base text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-neutral-500 focus:ring-2 focus:ring-neutral-600/30";
  const textareaClass =
    "min-h-[96px] w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-base text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-neutral-500 focus:ring-2 focus:ring-neutral-600/30";
  const labelClass = "mb-1 block text-sm text-neutral-300";

  return (
    <div className="mx-auto max-w-lg p-4">
      <h1 className="mb-4 text-2xl font-semibold">New reservation</h1>
      <form onSubmit={submit} className="grid gap-4">
        <label>
          <span className={labelClass}>Pickup address</span>
          <input
            className={inputClass}
            placeholder="Pickup address"
            value={form.pickupText}
            onChange={(e) => setForm({ ...form, pickupText: e.target.value })}
          />
        </label>
        <label>
          <span className={labelClass}>Drop-off address</span>
          <input
            className={inputClass}
            placeholder="Drop-off address"
            value={form.dropoffText}
            onChange={(e) => setForm({ ...form, dropoffText: e.target.value })}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="min-w-0">
            <span className={labelClass}>Date</span>
            <input
              type="date"
              required
              className={`${inputClass} [color-scheme:dark]`}
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </label>
          <label className="min-w-0">
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
        <label>
          <span className={labelClass}>Passengers</span>
          <input
            type="number"
            min={1}
            className={inputClass}
            value={form.pax}
            onChange={(e) => setForm({ ...form, pax: Number(e.target.value) })}
          />
        </label>
        <label>
          <span className={labelClass}>Price</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            className={inputClass}
            placeholder="Price (EUR)"
            value={form.priceEuro}
            onChange={(e) => setForm({ ...form, priceEuro: e.target.value })}
          />
        </label>
        <label>
          <span className={labelClass}>Client phone</span>
          <input
            type="tel"
            className={inputClass}
            placeholder="Client phone"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </label>
        <label>
          <span className={labelClass}>Flight number</span>
          <input
            className={inputClass}
            placeholder="Flight number (optional)"
            value={form.flight}
            onChange={(e) => setForm({ ...form, flight: e.target.value })}
          />
        </label>
        <label>
          <span className={labelClass}>Notes</span>
          <textarea
            className={textareaClass}
            placeholder="Notes"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </label>
        <button
          disabled={loading}
          className="h-11 rounded-md bg-yellow-500 px-4 font-medium text-black transition hover:bg-yellow-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Saving..." : "Save"}
        </button>
        {msg && <p className="text-red-400">{msg}</p>}
      </form>
    </div>
  );
}
