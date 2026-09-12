"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type PaymentMethod = "CASH" | "BANK" | "OTHER";

type PaymentFormProps = {
  mode: "create" | "edit";
  driver: { id: string; name: string; licenseNumber: string };
  initial: {
    id?: string;
    amount: string;
    paymentDate: string;
    method: PaymentMethod;
    notes: string;
  };
  subscriptionDebts?: Array<{ id: string; month: string; monthLabel: string; remaining: string }>;
};

function parseCents(value: string) {
  const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(value.trim());
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

function euro(cents: number) {
  return `€${(cents / 100).toFixed(2)}`;
}

export default function PaymentForm({ mode, driver, initial, subscriptionDebts = [] }: PaymentFormProps) {
  const router = useRouter();
  const [amount, setAmount] = useState(initial.amount);
  const [paymentDate, setPaymentDate] = useState(initial.paymentDate);
  const [method, setMethod] = useState<PaymentMethod>(initial.method);
  const [notes, setNotes] = useState(initial.notes);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputClass =
    "h-11 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-base text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-neutral-500 focus:ring-2 focus:ring-neutral-600/30";
  const labelClass = "mb-1 block text-sm text-neutral-300";
  const amountCents = parseCents(amount);
  const eligibleDebts = subscriptionDebts.filter((debt) => debt.month <= paymentDate.slice(0, 7));
  let previewRemainder = amountCents ?? 0;
  const previewSubscriptions = eligibleDebts.flatMap((debt) => {
    if (previewRemainder <= 0) return [];
    const debtCents = parseCents(debt.remaining) ?? 0;
    const allocated = Math.min(previewRemainder, debtCents);
    previewRemainder -= allocated;
    return allocated > 0 ? [{ ...debt, allocated, remainingAfter: debtCents - allocated }] : [];
  });

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    if (!amount.trim()) {
      setError("Payment amount is required.");
      return;
    }
    if (!paymentDate) {
      setError("Payment date is required.");
      return;
    }
    if (notes.trim().length > 2000) {
      setError("Notes must be 2000 characters or fewer.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const endpoint =
        mode === "create"
          ? `/api/drivers/${driver.id}/payments`
          : `/api/drivers/${driver.id}/payments/${initial.id}`;
      const response = await fetch(endpoint, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, paymentDate, method, notes }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) throw new Error(result.error || "Could not save the payment.");

      router.push(`/drivers/${driver.id}#payment-history`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the payment.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="rounded-lg border border-white/10 bg-black/20 p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Driver</p>
        <p className="mt-1 font-medium text-white">{driver.name}</p>
        <p className="mt-0.5 text-sm text-neutral-400">License {driver.licenseNumber}</p>
      </div>

      <label>
        <span className={labelClass}>Payment amount (€)</span>
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          required
          className={inputClass}
          placeholder="0.00"
          autoComplete="off"
          disabled={mode === "edit"}
        />
        {mode === "edit" ? <span className="mt-1 block text-xs text-neutral-500">Delete and re-enter the payment to correct its amount so subscription allocations reverse safely.</span> : null}
      </label>

      <label>
        <span className={labelClass}>Payment date</span>
        <input
          type="date"
          value={paymentDate}
          onChange={(event) => setPaymentDate(event.target.value)}
          required
          className={`${inputClass} [color-scheme:dark]`}
          disabled={mode === "edit"}
        />
      </label>

      {mode === "create" && amountCents !== null && amountCents > 0 ? (
        <section aria-label="Payment allocation preview" className="rounded-lg border border-yellow-500/25 bg-yellow-500/[0.06] p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-white">Allocation preview</h2>
            <p className="tnum text-sm font-semibold text-yellow-300">Payment {euro(amountCents)}</p>
          </div>
          <dl className="mt-3 space-y-2 text-sm">
            {previewSubscriptions.map((entry) => (
              <div key={entry.id} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                <dt className="min-w-0 text-neutral-300">{entry.monthLabel} subscription{entry.remainingAfter > 0 ? <span className="block text-xs text-neutral-500">Remaining subscription {euro(entry.remainingAfter)}</span> : null}</dt>
                <dd className="tnum shrink-0 text-white">{euro(entry.allocated)}</dd>
              </div>
            ))}
            <div className="flex flex-wrap justify-between gap-3 border-t border-white/10 pt-2">
              <dt className="text-neutral-300">Commission balance</dt>
              <dd className="tnum text-white">{euro(previewRemainder)}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      <label>
        <span className={labelClass}>Method</span>
        <select
          value={method}
          onChange={(event) => setMethod(event.target.value as PaymentMethod)}
          className={inputClass}
        >
          <option value="CASH">Cash</option>
          <option value="BANK">Bank</option>
          <option value="OTHER">Other</option>
        </select>
      </label>

      <label>
        <span className={labelClass}>Notes (optional)</span>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          maxLength={2000}
          rows={4}
          className="min-h-24 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-base text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-neutral-500 focus:ring-2 focus:ring-neutral-600/30"
          placeholder="Payment details"
        />
      </label>

      {error ? (
        <p role="alert" className="rounded-md border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={saving}
          className="h-11 rounded-md bg-yellow-500 px-4 font-semibold text-black hover:bg-yellow-400 disabled:cursor-wait disabled:opacity-60"
        >
          {saving ? "Saving..." : mode === "create" ? "Record payment" : "Save changes"}
        </button>
        <Link
          href={`/drivers/${driver.id}#payment-history`}
          className="inline-flex h-11 items-center rounded-md border border-white/10 px-4 text-sm font-medium text-neutral-200 hover:bg-white/5"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
