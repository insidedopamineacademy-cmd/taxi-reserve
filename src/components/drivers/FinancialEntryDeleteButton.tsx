"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type EntryKind = "commission" | "payment";

export default function FinancialEntryDeleteButton({
  driverId,
  entryId,
  kind,
}: {
  driverId: string;
  entryId: string;
  kind: EntryKind;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteEntry() {
    const label = kind === "commission" ? "commission" : "payment";
    if (!window.confirm(`Delete this ${label}? This will update the driver's balance.`)) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const collection = kind === "commission" ? "commissions" : "payments";
      const response = await fetch(`/api/drivers/${driverId}/${collection}/${entryId}`, {
        method: "DELETE",
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) throw new Error(result.error || `Could not delete the ${label}.`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete this entry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={deleteEntry}
        disabled={busy}
        className="inline-flex h-9 items-center rounded-md border border-red-600/40 bg-red-600/10 px-3 text-xs font-medium text-red-200 hover:bg-red-600/20 disabled:cursor-wait disabled:opacity-60"
      >
        {busy ? "Deleting..." : "Delete"}
      </button>
      {error ? <p className="max-w-56 text-xs text-red-400">{error}</p> : null}
    </div>
  );
}
