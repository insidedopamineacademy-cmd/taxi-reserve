"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type CommissionFormProps = {
  mode: "create" | "edit";
  driver: { id: string; name: string; licenseNumber: string };
  initial: {
    id?: string;
    amount: string;
    entryDate: string;
    notes: string;
  };
};

export default function CommissionForm({ mode, driver, initial }: CommissionFormProps) {
  const router = useRouter();
  const [amount, setAmount] = useState(initial.amount);
  const [entryDate, setEntryDate] = useState(initial.entryDate);
  const [notes, setNotes] = useState(initial.notes);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputClass =
    "h-11 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-base text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-neutral-500 focus:ring-2 focus:ring-neutral-600/30";
  const labelClass = "mb-1 block text-sm text-neutral-300";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    if (!amount.trim()) {
      setError("Commission amount is required.");
      return;
    }
    if (!entryDate) {
      setError("Entry date is required.");
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
          ? `/api/drivers/${driver.id}/commissions`
          : `/api/drivers/${driver.id}/commissions/${initial.id}`;
      const response = await fetch(endpoint, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, entryDate, notes }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) throw new Error(result.error || "Could not save the commission.");

      router.push(`/drivers/${driver.id}#commission-history`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the commission.");
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
        <span className={labelClass}>Commission amount (€)</span>
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          required
          className={inputClass}
          placeholder="0.00"
          autoComplete="off"
        />
      </label>

      <label>
        <span className={labelClass}>Entry date</span>
        <input
          type="date"
          value={entryDate}
          onChange={(event) => setEntryDate(event.target.value)}
          required
          className={`${inputClass} [color-scheme:dark]`}
        />
      </label>

      <label>
        <span className={labelClass}>Notes (optional)</span>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          maxLength={2000}
          rows={4}
          className="min-h-24 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-base text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-neutral-500 focus:ring-2 focus:ring-neutral-600/30"
          placeholder="Commission details"
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
          {saving ? "Saving..." : mode === "create" ? "Add commission" : "Save changes"}
        </button>
        <Link
          href={`/drivers/${driver.id}#commission-history`}
          className="inline-flex h-11 items-center rounded-md border border-white/10 px-4 text-sm font-medium text-neutral-200 hover:bg-white/5"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
