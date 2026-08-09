// src/app/reservations/[id]/edit/EditReservationForm.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PhoneActions } from "@/components/PhoneActions";
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

type DriverAdmin = {
  currentDriverId: string | null;
  commissionAmount: string;
  hasLinkedCommission: boolean;
  drivers: Array<{
    id: string;
    name: string;
    licenseNumber: string;
    status: "ACTIVE" | "INACTIVE";
  }>;
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

export default function EditReservationForm({
  initial,
  driverAdmin,
}: {
  initial: Initial;
  driverAdmin?: DriverAdmin;
}) {
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
    driverId: driverAdmin?.currentDriverId ?? "",
    commissionAmount: driverAdmin?.commissionAmount ?? "",
  });

  const inputClass =
    "h-12 w-full appearance-none rounded-md border border-white/10 bg-black/30 px-3 text-base text-neutral-100 outline-none placeholder:text-neutral-500 focus:border-white/25 focus:ring-2 focus:ring-white/10 disabled:cursor-not-allowed disabled:opacity-60";
  const textareaClass =
    "min-h-40 w-full resize-y rounded-md border border-white/10 bg-black/30 px-3 py-3 text-base text-neutral-100 outline-none placeholder:text-neutral-500 focus:border-white/25 focus:ring-2 focus:ring-white/10";
  const addressClass =
    "min-h-20 w-full resize-y rounded-md border border-white/10 bg-black/30 px-3 py-3 text-base text-neutral-100 outline-none placeholder:text-neutral-500 focus:border-white/25 focus:ring-2 focus:ring-white/10";
  const labelClass = "mb-1.5 block text-sm font-medium text-neutral-200";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
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

      if (driverAdmin) {
        const rawCommission = form.commissionAmount.trim();
        const normalizedCommission =
          rawCommission.includes(",") && !rawCommission.includes(".")
            ? rawCommission.replace(",", ".")
            : rawCommission;

        if (!form.driverId && normalizedCommission) {
          throw new Error("Select a driver before entering a commission.");
        }
        if (
          normalizedCommission &&
          (!/^\d+(?:\.\d{1,2})?$/.test(normalizedCommission) ||
            /^0+(?:\.0{1,2})?$/.test(normalizedCommission))
        ) {
          throw new Error(
            "Commission must be greater than zero with no more than 2 decimal places.",
          );
        }

        const removesLinkedCommission =
          driverAdmin.hasLinkedCommission &&
          (!form.driverId || !normalizedCommission);
        let confirmCommissionRemoval = false;

        if (removesLinkedCommission) {
          const message = !form.driverId
            ? "Unassign this driver and remove the reservation-linked commission? Manual commissions and payments will not be affected."
            : "Remove this reservation-linked commission? The driver assignment will remain.";
          confirmCommissionRemoval = window.confirm(message);
          if (!confirmCommissionRemoval) {
            setForm({
              ...form,
              driverId: driverAdmin.currentDriverId ?? "",
              commissionAmount: driverAdmin.commissionAmount,
            });
            setSaving(false);
            return;
          }
        }

        payload.driverId = form.driverId || null;
        payload.commissionAmount = normalizedCommission || null;
        payload.confirmCommissionRemoval = confirmCommissionRemoval;
      }

      const res = await fetch(`/api/reservations/${initial.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(result.error || "Save failed");
      router.push("/reservations");
      router.refresh();
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Could not save. Please try again.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <section
        aria-labelledby="ride-details-heading"
        className="rounded-xl border border-white/10 bg-[#0e1426] p-4 sm:p-5"
      >
        <div className="mb-5">
          <h2 id="ride-details-heading" className="text-lg font-semibold text-white">
            Ride Details
          </h2>
          <p className="mt-1 text-sm text-neutral-400">
            Route and schedule for this reservation.
          </p>
        </div>

        <div className="grid gap-4">
          <label className="block min-w-0">
            <span className={labelClass}>Pickup</span>
            <textarea
              rows={2}
              className={addressClass}
              value={form.pickupText}
              onChange={(e) => setForm({ ...form, pickupText: e.target.value })}
              placeholder="Pickup location"
            />
          </label>

          <label className="block min-w-0">
            <span className={labelClass}>Drop-off</span>
            <textarea
              rows={2}
              className={addressClass}
              value={form.dropoffText}
              onChange={(e) => setForm({ ...form, dropoffText: e.target.value })}
              placeholder="Drop-off location"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block min-w-0">
              <span className={labelClass}>Start date &amp; time</span>
              <input
                type="datetime-local"
                className={inputClass}
                value={form.startAt}
                onChange={(e) => setForm({ ...form, startAt: e.target.value })}
              />
            </label>

            <label className="block min-w-0">
              <span className={labelClass}>End date &amp; time (optional)</span>
              <input
                type="datetime-local"
                className={inputClass}
                value={form.endAt}
                onChange={(e) => setForm({ ...form, endAt: e.target.value })}
              />
            </label>
          </div>
        </div>
      </section>

      <section
        aria-labelledby="passenger-journey-heading"
        className="rounded-xl border border-white/10 bg-[#0e1426] p-4 sm:p-5"
      >
        <div className="mb-5">
          <h2 id="passenger-journey-heading" className="text-lg font-semibold text-white">
            Passenger &amp; Journey
          </h2>
          <p className="mt-1 text-sm text-neutral-400">
            Passenger count and journey contact details.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block min-w-0">
            <span className={labelClass}>Passenger count</span>
            <input
              type="number"
              min={1}
              max={99}
              className={inputClass}
              value={form.pax}
              onChange={(e) => setForm({ ...form, pax: e.target.value })}
            />
          </label>

          <label className="block min-w-0">
            <span className={labelClass}>Flight</span>
            <input
              className={inputClass}
              value={form.flight}
              onChange={(e) => setForm({ ...form, flight: e.target.value })}
              placeholder="VY1234"
            />
          </label>

          <div className="min-w-0 sm:col-span-2">
            <label htmlFor="reservation-phone" className={labelClass}>
              Phone
            </label>
            <input
              id="reservation-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              className={inputClass}
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="+34 600 000 000"
            />
            <PhoneActions phone={form.phone} showNumber={false} className="mt-2" />
          </div>
        </div>
      </section>

      <section
        aria-labelledby="booking-operations-heading"
        className="rounded-xl border border-white/10 bg-[#0e1426] p-4 sm:p-5"
      >
        <div className="mb-5">
          <h2 id="booking-operations-heading" className="text-lg font-semibold text-white">
            Booking &amp; Operations
          </h2>
          <p className="mt-1 text-sm text-neutral-400">
            Commercial status and operational notes.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block min-w-0">
            <span className={labelClass}>Price (€)</span>
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

          <label className="block min-w-0">
            <span className={labelClass}>Status</span>
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

          <label className="block min-w-0 sm:col-span-2">
            <span className={labelClass}>Notes</span>
            <textarea
              rows={6}
              className={textareaClass}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Anything important..."
            />
          </label>
        </div>
      </section>

      {driverAdmin ? (
        <section
          id="driver-commission"
          aria-labelledby="driver-commission-heading"
          className="scroll-mt-24 rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4 sm:p-5"
        >
          <div className="mb-5">
            <h2 id="driver-commission-heading" className="text-lg font-semibold text-white">
              Driver &amp; Commission
            </h2>
            <p className="mt-1 text-sm text-neutral-400">
              Admin-only financial assignment for this reservation.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block min-w-0">
              <span className={labelClass}>Assigned driver</span>
              <select
                className={inputClass}
                value={form.driverId}
                onChange={(event) => {
                  const driverId = event.target.value;
                  setForm({
                    ...form,
                    driverId,
                    commissionAmount: driverId ? form.commissionAmount : "",
                  });
                }}
              >
                <option value="">None / Unassigned</option>
                {driverAdmin.drivers.map((driver) => (
                  <option
                    key={driver.id}
                    value={driver.id}
                    disabled={driver.status === "INACTIVE"}
                  >
                    {driver.name} · {driver.licenseNumber}
                    {driver.status === "INACTIVE" ? " (INACTIVE — current)" : ""}
                  </option>
                ))}
              </select>
            </label>

            <label className="block min-w-0">
              <span className={labelClass}>Commission (€)</span>
              <input
                type="text"
                inputMode="decimal"
                className={inputClass}
                value={form.commissionAmount}
                onChange={(event) =>
                  setForm({ ...form, commissionAmount: event.target.value })
                }
                disabled={!form.driverId}
                placeholder={form.driverId ? "Optional, e.g. 30.00" : "Select a driver first"}
                autoComplete="off"
              />
            </label>
          </div>
          {driverAdmin.drivers.length === 0 ? (
            <p className="mt-3 text-xs text-neutral-400">
              No active drivers are currently available for assignment.
            </p>
          ) : null}
        </section>
      ) : null}

      <div className="flex flex-col-reverse gap-3 rounded-xl border border-white/10 bg-[#0e1426] p-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={() => history.back()}
          className="h-12 rounded-md border border-white/10 bg-transparent px-5 text-sm font-medium text-neutral-200 hover:bg-white/5 sm:w-auto"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="h-12 rounded-md bg-yellow-500 px-5 text-sm font-semibold text-black hover:bg-yellow-400 disabled:cursor-wait disabled:opacity-60 sm:w-auto"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </form>
  );
}
