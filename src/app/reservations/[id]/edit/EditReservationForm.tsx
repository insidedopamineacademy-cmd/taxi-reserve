// src/app/reservations/[id]/edit/EditReservationForm.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  RESERVATION_STATUS_OPTIONS,
  normalizeReservationStatusCode,
} from "@/lib/reservationStatus";

type Initial = {
  id: string;
  pickupText?: string | null;
  dropoffText?: string | null;
  startAt: string | Date;
  endAt?: string | Date | null;
  pax: number;
  priceEuro?: number | null;
  phone?: string | null;
  flight?: string | null;
  notes?: string | null;
  status?: string | null;
};

// --- Local helpers ---
function toLocalInput(dt?: string | Date | null) {
  if (!dt) return "";
  const d = new Date(dt);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm
}
function localInputToUTC(v: string) {
  // Correct conversion: Date(v) interprets local wall time and produces the right UTC instant.
  return new Date(v);
}

export default function EditReservationForm({ initial }: { initial: Initial }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    pickupText: initial.pickupText ?? "",
    dropoffText: initial.dropoffText ?? "",
    startAt: toLocalInput(initial.startAt),
    endAt: toLocalInput(initial.endAt ?? null),
    pax: String(initial.pax ?? 1),
    priceEuro: initial.priceEuro ?? "",
    phone: initial.phone ?? "",
    flight: initial.flight ?? "",
    notes: initial.notes ?? "",
    status: normalizeReservationStatusCode(initial.status),
  });

  // 🔧 unify input styles so all controls align (same height/padding across iOS/desktop)
  const inputClass =
    "w-full h-11 rounded-md border border-gray-600 bg-gray-800 px-3 text-gray-100 placeholder-gray-400 outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-500/30 appearance-none";
  const textareaClass =
    "w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-gray-100 placeholder-gray-400 outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-500/30 min-h-[120px]";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const payload = {
        pickupText: form.pickupText.trim() || null,
        dropoffText: form.dropoffText.trim() || null,
        startAt: localInputToUTC(form.startAt),
        endAt: form.endAt ? localInputToUTC(form.endAt) : null,
        pax: Math.max(1, Math.min(99, Number(form.pax) || 1)),
        priceEuro:
          form.priceEuro === "" || form.priceEuro === null
            ? null
            : Number(form.priceEuro),
        phone: form.phone.trim() || null,
        flight: form.flight.trim() || null,
        notes: form.notes.trim() || null,
        status: form.status,
      };

      const res = await fetch(`/api/reservations/${initial.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error("Save failed");
      router.push("/reservations");
      router.refresh();
    } catch (err) {
      console.error(err);
      alert("Could not save. Please try again.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-2xl space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm text-gray-300">From</span>
          <input
            className={inputClass}
            value={form.pickupText}
            onChange={(e) => setForm({ ...form, pickupText: e.target.value })}
            placeholder="Pickup location"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-gray-300">To</span>
          <input
            className={inputClass}
            value={form.dropoffText}
            onChange={(e) => setForm({ ...form, dropoffText: e.target.value })}
            placeholder="Drop-off location"
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm text-gray-300">Start</span>
          <input
            type="datetime-local"
            className={inputClass}
            value={form.startAt}
            onChange={(e) => setForm({ ...form, startAt: e.target.value })}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-gray-300">End (optional)</span>
          <input
            type="datetime-local"
            className={inputClass}
            value={form.endAt}
            onChange={(e) => setForm({ ...form, endAt: e.target.value })}
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-sm text-gray-300">Pax</span>
          <input
            type="number"
            min={1}
            max={99}
            className={inputClass}
            value={form.pax}
            onChange={(e) => setForm({ ...form, pax: e.target.value })}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-gray-300">Price (€)</span>
          <input
            type="number"
            step="0.01"
            className={inputClass}
            value={String(form.priceEuro ?? "")}
            onChange={(e) =>
              setForm({
                ...form,
                priceEuro:
                  e.target.value === "" ? "" : Number(e.target.value),
              })
            }
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-gray-300">Phone</span>
          <input
            className={inputClass}
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="+34 600 000 000"
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm text-gray-300">Flight</span>
          <input
            className={inputClass}
            value={form.flight}
            onChange={(e) => setForm({ ...form, flight: e.target.value })}
            placeholder="VY1234"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-gray-300">Status</span>
          <select
            className={inputClass}
            value={form.status}
            onChange={(e) =>
              setForm({
                ...form,
                status: normalizeReservationStatusCode(e.target.value),
              })
            }
          >
            {RESERVATION_STATUS_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-sm text-gray-300">Notes</span>
        <textarea
          rows={4}
          className={textareaClass}
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          placeholder="Anything important..."
        />
      </label>

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={saving}
          className="h-10 rounded-md border border-gray-600 bg-gray-800 px-4 text-gray-100 hover:bg-gray-700 disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          onClick={() => history.back()}
          className="h-10 rounded-md border border-gray-700 bg-transparent px-4 text-gray-200 hover:bg-gray-800/60"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
