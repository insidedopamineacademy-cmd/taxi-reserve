"use client";

import { useState } from "react";
import { shareProtectedPdf } from "@/lib/pdfShare";

type Props = {
  /** Protected, ADMIN-authenticated PDF endpoint (fetched with the session). */
  pdfUrl: string;
  /** Human, dated filename for the shared file, e.g. comisiones-pendientes-18-Aug-2026.pdf */
  filename: string;
  /** Title passed to the native share sheet. */
  shareTitle: string;
  /** Explicit accessible label, e.g. "Share Pending Commissions PDF". */
  label: string;
  variant?: "icon" | "button";
  className?: string;
};

function ShareIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M12 3v12" />
      <path d="m7 8 5-5 5 5" />
      <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </svg>
  );
}

function Spinner({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      aria-hidden="true"
      className={`animate-spin ${className ?? ""}`}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function PdfShareButton({
  pdfUrl,
  filename,
  shareTitle,
  label,
  variant = "button",
  className = "",
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  function openFallback() {
    window.open(pdfUrl, "_blank", "noopener,noreferrer");
  }

  async function onClick() {
    if (busy) return; // prevent duplicate share requests while preparing
    setError(false);

    const nav = typeof navigator !== "undefined" ? navigator : undefined;
    // Fast path: browsers without file sharing just open the PDF (no spinner).
    if (!nav || typeof nav.share !== "function" || typeof nav.canShare !== "function") {
      openFallback();
      return;
    }

    setBusy(true);
    try {
      const outcome = await shareProtectedPdf(
        { url: pdfUrl, filename, title: shareTitle },
        { navigator: nav, fetch: window.fetch.bind(window), FileCtor: File },
      );
      if (outcome === "unsupported") {
        openFallback();
      } else if (outcome === "failed") {
        setError(true);
      }
      // "shared" and "cancelled" need no further action.
    } finally {
      setBusy(false);
    }
  }

  const accessibleLabel = error ? `${label} — failed, tap to retry` : label;

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={accessibleLabel}
        aria-busy={busy}
        title={error ? "Couldn't prepare PDF — tap to retry" : "Share"}
        className={`inline-flex size-9 items-center justify-center rounded-lg border bg-surface/80 backdrop-blur transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
          error
            ? "border-danger/40 text-danger"
            : "border-app-border text-muted hover:border-app-border-strong hover:text-brand"
        } ${className}`}
      >
        {busy ? <Spinner /> : <ShareIcon />}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={accessibleLabel}
      aria-busy={busy}
      className={`inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-70 ${
        error
          ? "border-danger/40 text-danger hover:bg-danger/10"
          : "border-app-border bg-white/5 text-neutral-200 hover:bg-white/10"
      } ${className}`}
    >
      {busy ? <Spinner /> : <ShareIcon />}
      <span>{busy ? "Preparing…" : error ? "Retry share" : "Share"}</span>
    </button>
  );
}
