"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function PermanentDeleteAllButton({
  deletedCount,
}: {
  deletedCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onDeleteAll() {
    const confirmed = window.confirm(
      "This will permanently delete all deleted reservations. This cannot be undone.",
    );
    if (!confirmed) return;

    setBusy(true);
    setMessage(null);
    setError(null);

    try {
      const res = await fetch("/api/reservations/deleted/permanent-delete-all", {
        method: "DELETE",
      });
      const json = (await res.json().catch(() => ({}))) as {
        deleted?: number;
        error?: string;
      };

      if (!res.ok) throw new Error(json.error || "Permanent delete failed");

      setMessage(`Permanently deleted ${json.deleted ?? 0} reservation(s).`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Permanent delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onDeleteAll}
        disabled={busy || deletedCount === 0}
        className="rounded-md border border-red-600/40 bg-red-600/20 px-3 py-2 text-sm font-medium text-red-200 hover:bg-red-600/30 disabled:cursor-wait disabled:opacity-60"
      >
        {busy ? "Deleting..." : "Permanently delete all"}
      </button>
      {message && <p className="text-sm text-green-400">{message}</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
