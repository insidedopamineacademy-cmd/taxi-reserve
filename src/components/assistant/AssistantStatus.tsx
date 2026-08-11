"use client";

import type { AssistantStatusKind } from "./types";

type Props = {
  status: AssistantStatusKind;
  label: string;
};

export function AssistantStatus({ status, label }: Props) {
  return (
    <div className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-300">
      <span
        aria-hidden="true"
        className={`size-2 rounded-full ${
          status === "searching" ? "bg-sky-300" : status === "complete" ? "bg-emerald-300" : "bg-amber-300"
        } ${status === "complete" ? "" : "assistant-status-pulse"}`}
      />
      <span>{label}</span>
    </div>
  );
}
