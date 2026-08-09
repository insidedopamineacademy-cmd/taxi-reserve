"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type DriverStatus = "ACTIVE" | "INACTIVE";

export default function DriverStatusButton({
  id,
  name,
  status,
}: {
  id: string;
  name: string;
  status: DriverStatus;
}) {
  const router = useRouter();
  const [currentStatus, setCurrentStatus] = useState(status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextStatus: DriverStatus = currentStatus === "ACTIVE" ? "INACTIVE" : "ACTIVE";
  const actionLabel = nextStatus === "ACTIVE" ? "Activate" : "Deactivate";

  async function updateStatus() {
    const confirmed = window.confirm(
      `${actionLabel} ${name}? Existing reservations and financial history will be preserved.`,
    );
    if (!confirmed) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/drivers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) throw new Error(result.error || "Could not update driver status.");

      setCurrentStatus(nextStatus);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update driver status.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={updateStatus}
        disabled={busy}
        className="inline-flex h-10 items-center justify-center rounded-md border border-white/10 bg-white/5 px-3 text-sm font-medium text-neutral-200 hover:bg-white/10 disabled:cursor-wait disabled:opacity-60"
      >
        {busy ? "Saving..." : actionLabel}
      </button>
      {error ? <p className="max-w-56 text-xs text-red-400">{error}</p> : null}
    </div>
  );
}
