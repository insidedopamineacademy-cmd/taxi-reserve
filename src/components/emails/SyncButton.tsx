"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SyncButton() {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  async function sync() {
    setSyncing(true);
    setMessage("");
    setIsError(false);
    try {
      const response = await fetch("/api/emails/sync", { method: "POST" });
      const result = (await response.json()) as {
        imported?: number;
        skipped?: number;
        error?: string;
      };
      if (!response.ok) throw new Error(result.error || "Inbox sync failed.");

      setMessage(
        result.imported
          ? `${result.imported} new ${result.imported === 1 ? "email" : "emails"}`
          : "Inbox is up to date",
      );
      router.refresh();
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : "Inbox sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={sync}
        disabled={syncing}
        className="min-h-11 rounded-xl bg-yellow-400 px-4 font-semibold text-black transition hover:bg-yellow-300 disabled:cursor-wait disabled:opacity-60"
      >
        {syncing ? "Syncing…" : "Sync inbox"}
      </button>
      <p
        aria-live="polite"
        className={`max-w-44 text-right text-xs ${isError ? "text-red-300" : "text-neutral-400"}`}
      >
        {message}
      </p>
    </div>
  );
}
