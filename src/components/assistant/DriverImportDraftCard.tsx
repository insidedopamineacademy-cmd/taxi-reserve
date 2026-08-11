import type { AssistantDriverImportDraft } from "./types";

const groups = [
  ["NEEDS_REVIEW", "Needs review"],
  ["CONFLICT", "Conflicts"],
  ["NEW", "New"],
  ["EXISTING_UPDATE", "Existing / update"],
  ["EXISTING_MATCH", "Existing / no change"],
] as const;

const stateStyles = {
  NEW: "text-emerald-200",
  EXISTING_MATCH: "text-sky-200",
  EXISTING_UPDATE: "text-amber-200",
  DUPLICATE_IN_IMPORT: "text-slate-400",
  NEEDS_REVIEW: "text-amber-200",
  CONFLICT: "text-rose-200",
} as const;

export function DriverImportDraftCard({ draft }: { draft: AssistantDriverImportDraft }) {
  return (
    <article className="overflow-hidden rounded-2xl border border-sky-300/20 bg-[#111b2e] shadow-[0_14px_34px_rgba(0,0,0,0.2)]">
      <div className="border-b border-white/10 bg-sky-300/[0.06] px-3.5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-200">
            Driver import draft
          </span>
          <span className="text-[11px] text-slate-400">Revision {draft.revision}</span>
        </div>
        <p className="mt-1 text-sm leading-5 text-slate-300">
          Review the cleaned list before an import action is prepared.
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-px bg-white/[0.06] sm:grid-cols-3">
        {[
          ["New", draft.counts.NEW],
          ["Updates", draft.counts.EXISTING_UPDATE],
          ["Existing", draft.counts.EXISTING_MATCH],
          ["Review", draft.counts.NEEDS_REVIEW],
          ["Conflicts", draft.counts.CONFLICT],
          ["Duplicates", draft.duplicateRowsSkipped],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0 bg-[#111b2e] px-3 py-2.5">
            <dt className="text-[11px] uppercase tracking-wide text-slate-500">{label}</dt>
            <dd className="mt-0.5 text-base font-semibold text-slate-100">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="divide-y divide-white/[0.06]">
        {groups.map(([state, label]) => {
          const rows = draft.rows.filter((row) => row.state === state);
          if (rows.length === 0) return null;
          const critical = state === "NEEDS_REVIEW" || state === "CONFLICT";
          const visibleRows = critical ? rows : rows.slice(0, 12);
          return (
            <details key={state} open={critical} className="group px-3.5 py-2.5">
              <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-slate-200 marker:hidden">
                <span className={stateStyles[state]}>{label} — {rows.length}</span>
                <span aria-hidden="true" className="text-slate-500 transition group-open:rotate-180">⌄</span>
              </summary>
              <div className="mt-1 divide-y divide-white/[0.05]">
                {visibleRows.map((row) => (
                  <div key={row.id} className="min-w-0 py-2.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <p className="min-w-0 break-words font-medium text-slate-100">
                        {row.name || row.possibleNames.join(" / ") || "Name missing"}
                      </p>
                      <span className="shrink-0 text-xs text-slate-400">
                        {row.licenseNumber || "Code missing"}
                      </span>
                    </div>
                    <p className="mt-1 break-words text-xs text-slate-300">
                      {row.vehicleRaw || "Vehicle missing"}
                      {row.vehicleType ? ` · ${row.vehicleType}` : " · Type unresolved"}
                    </p>
                    {row.existing ? (
                      <p className="mt-1 break-words text-xs text-sky-200">
                        Existing: {row.existing.name} · {row.existing.vehicleType || "No vehicle type"} · {row.existing.status}
                      </p>
                    ) : null}
                    {row.issues.map((issue) => (
                      <p key={issue} className="mt-1 break-words text-xs leading-5 text-amber-200">
                        {issue}
                      </p>
                    ))}
                    {row.sourceNotes.length > 0 ? (
                      <p className="mt-1 break-words text-[11px] leading-4 text-slate-500">
                        Source notes: {row.sourceNotes.join(" · ")}
                      </p>
                    ) : null}
                  </div>
                ))}
                {rows.length > visibleRows.length ? (
                  <p className="py-2 text-xs text-slate-400">
                    {rows.length - visibleRows.length} more reviewed rows are included in the server-owned draft.
                  </p>
                ) : null}
              </div>
            </details>
          );
        })}
      </div>

      <div className="border-t border-white/10 px-3.5 py-3">
        <p className="whitespace-pre-wrap break-words text-xs leading-5 text-slate-300">
          {draft.question}
        </p>
      </div>
    </article>
  );
}
