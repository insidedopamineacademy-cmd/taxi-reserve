"use client";

import { useState } from "react";
import { normalizePhoneForActions } from "@/lib/phoneActions";

type Props = {
  phone?: string | null;
  showNumber?: boolean;
  className?: string;
};

function fallbackCopy(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Copy failed");
}

export function PhoneActions({ phone, showNumber = true, className = "" }: Props) {
  const [copyResult, setCopyResult] = useState<{
    phone: string;
    status: "copied" | "failed";
  } | null>(null);
  const normalized = normalizePhoneForActions(phone ?? "");
  if (!normalized) return null;
  const actions = normalized;
  const copyStatus = copyResult?.phone === actions.display ? copyResult.status : "idle";

  async function copyPhone() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(actions.display);
      } else {
        fallbackCopy(actions.display);
      }
      setCopyResult({ phone: actions.display, status: "copied" });
    } catch {
      try {
        fallbackCopy(actions.display);
        setCopyResult({ phone: actions.display, status: "copied" });
      } catch {
        setCopyResult({ phone: actions.display, status: "failed" });
      }
    }
  }

  return (
    <div className={`min-w-0 ${className}`}>
      {showNumber ? (
        <p className="break-words text-sm leading-6">
          <span className="font-medium text-neutral-400">Phone: </span>
          <span className="text-neutral-100">{actions.display}</span>
        </p>
      ) : null}

      <div className={`${showNumber ? "mt-2" : ""} grid grid-cols-3 gap-2`}>
        {actions.tel ? (
          <a
            href={`tel:${actions.tel}`}
            aria-label={`Call ${actions.display}`}
            className="inline-flex min-h-11 min-w-0 items-center justify-center rounded-lg border border-sky-500/35 bg-sky-500/15 px-2 text-center text-sm font-medium text-sky-100 transition hover:bg-sky-500/25"
          >
            Call
          </a>
        ) : null}
        {actions.whatsappDigits ? (
          <a
            href={`https://wa.me/${actions.whatsappDigits}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open WhatsApp chat with ${actions.display}`}
            className="inline-flex min-h-11 min-w-0 items-center justify-center rounded-lg border border-emerald-500/35 bg-emerald-500/15 px-2 text-center text-sm font-medium text-emerald-100 transition hover:bg-emerald-500/25"
          >
            WhatsApp
          </a>
        ) : null}
        <button
          type="button"
          onClick={copyPhone}
          aria-label={`Copy phone number ${actions.display}`}
          className="inline-flex min-h-11 min-w-0 items-center justify-center rounded-lg border border-white/15 bg-white/5 px-2 text-center text-sm font-medium text-neutral-100 transition hover:bg-white/10"
        >
          {copyStatus === "copied" ? "Copied" : "Copy"}
        </button>
      </div>
      <p aria-live="polite" className="sr-only">
        {copyStatus === "copied"
          ? `Copied ${actions.display}`
          : copyStatus === "failed"
            ? "Phone number could not be copied"
            : ""}
      </p>
    </div>
  );
}
