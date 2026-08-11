"use client";

import type { AssistantActionPreview } from "./types";

type Props = {
  action: AssistantActionPreview;
  onConfirm: (actionId: string) => void;
  onCancel: (actionId: string) => void;
};

const statusCopy = {
  PENDING: "Awaiting confirmation",
  EXECUTING: "Confirming…",
  EXECUTED: "Succeeded",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
  FAILED: "Failed",
  CONFLICTED: "Needs review",
} as const;

const riskCopy = {
  READ: "Read",
  WRITE: "Write",
  FINANCIAL_WRITE: "Financial write",
  DESTRUCTIVE: "Destructive",
} as const;

export function AssistantActionPreviewCard({ action, onConfirm, onCancel }: Props) {
  const pending = action.status === "PENDING";
  const financial = action.riskLevel === "FINANCIAL_WRITE";

  return (
    <article className="overflow-hidden rounded-2xl border border-amber-300/25 bg-[#121b2d] shadow-[0_14px_34px_rgba(0,0,0,0.24)]">
      <div className="border-b border-white/10 bg-amber-300/[0.07] px-3.5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-200">
            Action preview
          </span>
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
            financial
              ? "border-rose-300/30 bg-rose-300/10 text-rose-100"
              : "border-amber-300/25 bg-amber-300/10 text-amber-100"
          }`}>
            {riskCopy[action.riskLevel]}
          </span>
        </div>
        <h3 className="mt-2 text-base font-semibold leading-5 text-white">
          {action.preview.title}
        </h3>
        {action.preview.summary ? (
          <p className="mt-1 text-sm leading-5 text-slate-300">{action.preview.summary}</p>
        ) : null}
      </div>

      <div className="space-y-3 px-3.5 py-3">
        {action.preview.sections.map((section, sectionIndex) => (
          <section key={`${action.actionId}-${section.heading}-${sectionIndex}`}>
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              {section.heading}
            </h4>
            <dl className="mt-1.5 divide-y divide-white/[0.06] rounded-xl border border-white/[0.08] bg-black/10 px-3">
              {section.facts.map((fact, factIndex) => (
                <div
                  key={`${fact.label}-${factIndex}`}
                  className="grid grid-cols-[minmax(0,0.42fr)_minmax(0,0.58fr)] gap-3 py-2.5"
                >
                  <dt className="text-xs leading-5 text-slate-400">{fact.label}</dt>
                  <dd className={`min-w-0 break-words text-right text-sm leading-5 ${
                    fact.emphasis === "money"
                      ? "font-semibold text-amber-200"
                      : fact.emphasis === "warning"
                        ? "font-medium text-rose-100"
                        : "text-slate-100"
                  }`}>
                    {fact.previousValue ? (
                      <span className="block text-xs text-slate-500 line-through">
                        {fact.previousValue}
                      </span>
                    ) : null}
                    {fact.value}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}

        {action.preview.warnings?.map((warning, index) => (
          <p
            key={`${action.actionId}-warning-${index}`}
            className="rounded-xl border border-rose-300/20 bg-rose-300/[0.06] px-3 py-2 text-xs leading-5 text-rose-100"
          >
            {warning}
          </p>
        ))}

        {action.result ? (
          <div className="rounded-xl border border-emerald-300/20 bg-emerald-300/[0.06] px-3 py-2.5">
            <p className="font-medium text-emerald-100">{action.result.title}</p>
            {action.result.message ? (
              <p className="mt-1 text-xs leading-5 text-slate-300">{action.result.message}</p>
            ) : null}
            {action.result.reference?.href ? (
              <a
                href={action.result.reference.href}
                className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-amber-200 underline decoration-amber-200/40 underline-offset-4"
              >
                {action.result.reference.label}
              </a>
            ) : null}
          </div>
        ) : null}

        {action.failure || action.clientError ? (
          <p className="rounded-xl border border-rose-300/20 bg-rose-300/[0.06] px-3 py-2 text-xs leading-5 text-rose-100">
            {action.clientError || action.failure?.message}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-3 text-xs text-slate-400">
          <span>{statusCopy[action.status]}</span>
          {action.fixture ? <span>Fixture only</span> : null}
        </div>

        {pending ? (
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={() => onCancel(action.actionId)}
              className="min-h-11 rounded-xl border border-white/15 px-3 text-sm font-medium text-slate-100 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onConfirm(action.actionId)}
              className="min-h-11 rounded-xl bg-amber-300 px-3 text-sm font-semibold text-[#101827] hover:bg-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-100 focus-visible:ring-offset-2 focus-visible:ring-offset-[#121b2d]"
            >
              {action.confirmationLabel}
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
