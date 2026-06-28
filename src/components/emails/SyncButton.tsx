"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SyncProgressCard } from "@/components/emails/SyncProgressCard";
import type { EmailSyncResult } from "@/lib/emails/progress";

const SYNC_REQUEST_TIMEOUT_MS = 120_000;

function failedResult(label: string, detail?: string): EmailSyncResult {
  return {
    ok: false,
    steps: [{ status: "error", label, detail }],
    summary: {
      foldersChecked: 0,
      foldersSynced: 0,
      messagesImported: 0,
      duplicatesSkipped: 0,
    },
  };
}

function isSyncResult(value: unknown): value is EmailSyncResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<EmailSyncResult>;
  return typeof candidate.ok === "boolean" && Array.isArray(candidate.steps) && Boolean(candidate.summary);
}

export default function SyncButton({ configured = true }: { configured?: boolean }) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<EmailSyncResult | null>(null);

  async function sync() {
    setSyncing(true);
    setResult(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), SYNC_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch("/api/emails/sync", {
        method: "POST",
        cache: "no-store",
        signal: controller.signal,
      });
      const payload: unknown = await response.json();
      if (isSyncResult(payload)) {
        setResult(payload);
        if (payload.ok) router.refresh();
        return;
      }

      const error = payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : "Inbox sync failed.";
      setResult(failedResult("Inbox sync failed", error));
    } catch {
      setResult(
        controller.signal.aborted
          ? failedResult(
              "Sync is taking longer than expected",
              "Check server logs or try again.",
            )
          : failedResult(
              "Inbox sync failed",
              "The request could not be completed. Check your connection and try again.",
            ),
      );
    } finally {
      window.clearTimeout(timeout);
      setSyncing(false);
    }
  }

  return (
    <div className="contents">
      <button
        type="button"
        onClick={sync}
        disabled={syncing || !configured}
        className="min-h-11 justify-self-end rounded-xl bg-yellow-400 px-4 font-semibold text-black transition hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {syncing ? "Syncing…" : configured ? "Sync inbox" : "Sync unavailable"}
      </button>
      <SyncProgressCard syncing={syncing} result={result} />
    </div>
  );
}
