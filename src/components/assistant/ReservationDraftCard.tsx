import type { AssistantReservationDraft } from "./types";

const stateCopy = {
  EXPLICIT: "✓ Confirmed",
  INFERRED: "? Needs confirmation",
  MISSING: "— Missing",
  CONFLICT: "! Conflict",
} as const;

const fieldOrder = [
  ["pickup", "Pickup"],
  ["dropoff", "Drop-off"],
  ["serviceDate", "Service date"],
  ["pickupTime", "Pickup time"],
  ["passengers", "Passengers"],
  ["priceEuro", "Price"],
  ["phone", "Phone"],
  ["flight", "Flight"],
  ["notes", "Notes"],
] as const;

function displayValue(
  name: (typeof fieldOrder)[number][0],
  value: string | number | null,
  alternatives: Array<string | number>,
) {
  if (alternatives.length > 0) return alternatives.join(" or ");
  if (value === null || value === "") return "Not provided";
  if (name === "priceEuro" && typeof value === "number") return `€${value.toFixed(2)}`;
  return String(value);
}

export function ReservationDraftCard({ draft }: { draft: AssistantReservationDraft }) {
  return (
    <article className="overflow-hidden rounded-2xl border border-sky-300/20 bg-[#111b2e] shadow-[0_14px_34px_rgba(0,0,0,0.2)]">
      <div className="border-b border-white/10 bg-sky-300/[0.06] px-3.5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-200">
            Reservation draft
          </span>
          <span className="text-[11px] text-slate-400">Revision {draft.revision}</span>
        </div>
        <p className="mt-1 text-sm leading-5 text-slate-300">
          Review extracted details before a creation preview is prepared.
        </p>
      </div>

      <dl className="divide-y divide-white/[0.06] px-3.5">
        {fieldOrder.map(([name, label]) => {
          const field = draft.fields[name];
          return (
            <div key={name} className="py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <dt className="text-xs font-medium text-slate-300">{label}</dt>
                <span className={`text-[11px] font-medium ${
                  field.state === "CONFLICT"
                    ? "text-rose-200"
                    : field.state === "INFERRED"
                      ? "text-amber-200"
                      : field.state === "MISSING"
                        ? "text-slate-500"
                        : "text-emerald-200"
                }`}>
                  {stateCopy[field.state]}
                </span>
              </div>
              <dd className="mt-1 min-w-0 whitespace-pre-wrap break-words text-sm leading-5 text-slate-100">
                {displayValue(name, field.value, field.alternatives)}
              </dd>
              {field.message ? (
                <p className="mt-1 break-words text-xs leading-5 text-slate-400">
                  {field.message}
                </p>
              ) : null}
            </div>
          );
        })}
      </dl>

      <div className="border-t border-white/10 px-3.5 py-3">
        <p className="whitespace-pre-wrap break-words text-xs leading-5 text-slate-300">
          {draft.question}
        </p>
      </div>
    </article>
  );
}
