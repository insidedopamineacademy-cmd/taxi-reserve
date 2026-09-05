"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import SubscriptionStatusBadge from "@/components/drivers/SubscriptionStatusBadge";
import type { SubscriptionDisplayStatus, SubscriptionPaymentStatus } from "@/lib/drivers/subscriptionStatus";

export type SubscriptionHistoryItem = {
  id: string;
  month: string;
  monthLabel: string;
  amount: string;
  status: SubscriptionPaymentStatus;
  paidDate: string | null;
  paidDateLabel: string | null;
  paidBy: string | null;
  note: string | null;
  revision: number;
};

function SubscriptionMonthEditor({ driverId, driverName, month, today }: {
  driverId: string;
  driverName: string;
  month: SubscriptionHistoryItem;
  today: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [paidDate, setPaidDate] = useState(month.paidDate ?? today);
  const [note, setNote] = useState(month.note ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(status: "PAID" | "UNPAID") {
    const action = status === "PAID" ? "Record as paid" : "Mark as unpaid";
    if (!window.confirm(`${action}: ${driverName} · ${month.monthLabel} · ${month.amount}?\nThis records subscription status only. Commission balances remain unchanged.`)) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/drivers/${driverId}/subscriptions/${month.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, paidDate: status === "PAID" ? paidDate : null, note, expectedRevision: month.revision }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not save subscription status.");
      setEditing(false);
      setMessage("Subscription status saved.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save subscription status.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border-t border-app-border pt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium text-white">{month.monthLabel}</p>
          <div className="mt-1"><SubscriptionStatusBadge status={month.status} /></div>
        </div>
        <p className="tnum whitespace-nowrap text-lg font-semibold text-white">{month.amount}</p>
      </div>
      {month.paidDateLabel && <p className="mt-2 break-words text-sm text-muted">Paid {month.paidDateLabel}{month.paidBy ? ` · Recorded by ${month.paidBy}` : ""}</p>}
      {month.status === "UNVERIFIED" && <p className="mt-2 text-sm text-muted">This month predates payment tracking. Review it before marking paid or unpaid.</p>}
      {month.note && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted">{month.note}</p>}
      {editing ? (
        <form className="mt-4 space-y-3" onSubmit={(event) => { event.preventDefault(); void save("PAID"); }}>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Paid date</span>
            <input type="date" required value={paidDate} max={today} onChange={(event) => setPaidDate(event.target.value)} disabled={busy} className="h-11 w-full rounded-lg border border-app-border bg-surface-2 px-3 text-base text-white" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Note or reference (optional)</span>
            <textarea value={note} maxLength={500} rows={2} onChange={(event) => setNote(event.target.value)} disabled={busy} className="w-full rounded-lg border border-app-border bg-surface-2 p-3 text-base text-white" />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className="min-h-11 rounded-lg bg-brand px-4 text-sm font-semibold text-brand-fg hover:bg-brand-hover disabled:opacity-60">{busy ? "Saving…" : month.status === "PAID" ? "Save paid details" : "Mark as paid"}</button>
            <button type="button" disabled={busy} onClick={() => void save("UNPAID")} className="min-h-11 rounded-lg border border-app-border px-4 text-sm font-medium text-warning hover:bg-warning/10 disabled:opacity-60">{month.status === "PAID" ? "Undo payment" : "Confirm unpaid"}</button>
            <button type="button" disabled={busy} onClick={() => { setEditing(false); setError(null); }} className="min-h-11 rounded-lg px-3 text-sm text-muted hover:text-white">Cancel</button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => { setPaidDate(month.paidDate ?? today); setNote(month.note ?? ""); setEditing(true); setMessage(null); }} className="mt-3 min-h-11 rounded-lg border border-app-border px-4 text-sm font-medium text-brand hover:border-brand/40 hover:bg-brand/[0.05]">
          {month.status === "PAID" ? "Edit / undo payment" : month.status === "UNVERIFIED" ? "Review payment status" : "Record subscription payment"}
        </button>
      )}
      {message && <p role="status" className="mt-3 text-sm text-success">{message}</p>}
      {error && <div role="alert" className="mt-3 text-sm text-danger"><p>{error}</p><button type="button" onClick={() => router.refresh()} className="mt-1 min-h-11 underline">Reload month</button></div>}
    </div>
  );
}

export default function SubscriptionHistory({ driverId, driverName, months, currentMonth, currentMonthLabel, currentStatus, today }: {
  driverId: string;
  driverName: string;
  months: SubscriptionHistoryItem[];
  currentMonth: string;
  currentMonthLabel: string;
  currentStatus: SubscriptionDisplayStatus;
  today: string;
}) {
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const selected = months.find((month) => month.month === selectedMonth);
  const current = months.find((month) => month.month === currentMonth);
  const options = [
    { month: currentMonth, monthLabel: `${currentMonthLabel} · Current month` },
    ...months.filter((month) => month.month !== currentMonth),
  ];

  return (
    <section id="monthly-subscription" aria-labelledby="monthly-subscription-heading" className="mt-6 rounded-xl border border-app-border bg-surface p-4 sm:p-5">
      <h2 id="monthly-subscription-heading" className="text-lg font-semibold text-white">Monthly subscription</h2>
      <p className="mt-1 text-sm text-muted">Track each month separately from commission settlements.</p>
      <div className="my-4 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-muted">{currentMonthLabel}{current ? ` · ${current.amount}` : ""}</p>
        <SubscriptionStatusBadge status={currentStatus} />
      </div>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted">Subscription month / history</span>
        <select value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} className="h-11 w-full rounded-lg border border-app-border bg-surface-2 px-3 text-base text-white">
          {options.map((month) => <option key={month.month} value={month.month}>{month.monthLabel}</option>)}
        </select>
      </label>
      {selected ? (
        <SubscriptionMonthEditor key={`${selected.id}-${selected.revision}`} driverId={driverId} driverName={driverName} month={selected} today={today} />
      ) : (
        <p className="mt-4 text-sm text-muted">
          {currentStatus === "NOT_GENERATED"
            ? "No charge has been generated for this month. Eligible drivers are included in the monthly batch; missing records are not evidence of payment."
            : "No subscription record for this month. Existing monthly history is preserved when driver eligibility changes."}
        </p>
      )}
    </section>
  );
}
