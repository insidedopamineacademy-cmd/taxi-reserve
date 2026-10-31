"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { securityRequestHeaders } from "@/lib/security/securityRequestGuard";

export default function SubscriptionAutomationToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (pending) return;
    const next = !enabled;
    setPending(true);
    setError(null);
    setEnabled(next); // optimistic
    try {
      const response = await fetch("/api/drivers/subscription-automation", {
        method: "POST",
        headers: securityRequestHeaders(),
        body: JSON.stringify({ enabled: next }),
      });
      const result = (await response.json().catch(() => ({}))) as { enabled?: boolean; error?: string };
      if (!response.ok) throw new Error(result.error || "Could not update automatic charges.");
      setEnabled(Boolean(result.enabled));
      router.refresh();
    } catch (caught) {
      setEnabled(!next); // revert
      setError(caught instanceof Error ? caught.message : "Could not update automatic charges.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby="subscription-automation-heading"
      className="rounded-xl border border-app-border bg-surface p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="subscription-automation-heading" className="text-sm font-semibold text-white">
            Automatic Monthly Charges
          </h2>
          <p className="mt-1 text-xs text-muted">Applies to all drivers.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Automatic monthly subscription charges"
          disabled={pending}
          onClick={() => void toggle()}
          className="inline-flex h-11 shrink-0 items-center rounded-full px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-app disabled:cursor-wait disabled:opacity-60"
        >
          <span
            className={`inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ${
              enabled ? "bg-success" : "bg-white/15"
            }`}
          >
            <span
              className={`size-5 rounded-full bg-white shadow transition-transform duration-200 ${
                enabled ? "translate-x-[22px]" : "translate-x-0.5"
              }`}
            />
          </span>
        </button>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`size-2 shrink-0 rounded-full ${enabled ? "bg-success" : "bg-warning"}`}
        />
        <p className={`min-w-0 text-xs font-medium ${enabled ? "text-success" : "text-warning"}`}>
          {enabled ? "Automatic monthly charges enabled" : "Monthly charges paused"}
        </p>
        {pending ? <span className="ml-auto shrink-0 text-xs text-subtle">Saving…</span> : null}
      </div>

      {!enabled ? (
        <p className="mt-1 text-xs text-subtle">Skipped months won&apos;t be charged later.</p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
