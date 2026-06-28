import type { EmailSyncResult, EmailSyncStep } from "@/lib/emails/progress";

type Props = {
  syncing: boolean;
  result: EmailSyncResult | null;
};

const WAITING_STEPS: EmailSyncStep[] = [
  { status: "pending", label: "Checking email configuration" },
  { status: "pending", label: "Connecting and syncing mailbox folders" },
];

const STATUS_STYLES = {
  pending: "border-sky-400/25 bg-sky-400/10 text-sky-200",
  success: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
  warning: "border-amber-400/25 bg-amber-400/10 text-amber-100",
  error: "border-red-400/25 bg-red-400/10 text-red-200",
} as const;

const STATUS_MARKS = {
  pending: "•",
  success: "✓",
  warning: "!",
  error: "×",
} as const;

export function SyncProgressCard({ syncing, result }: Props) {
  if (!syncing && !result) return null;

  const steps = result?.steps ?? WAITING_STEPS;
  return (
    <section
      aria-label="Email sync progress"
      aria-live="polite"
      className="col-span-2 mt-1 min-w-0 rounded-xl border border-white/10 bg-[#111827] p-3 shadow-lg"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-white">Sync diagnostics</h2>
        <span className="text-xs text-neutral-400">
          {syncing ? "Working…" : result?.ok ? "Complete" : "Needs attention"}
        </span>
      </div>

      <ol className="mt-2 grid gap-2">
        {steps.map((step, index) => (
          <li
            key={`${index}-${step.label}`}
            className={`min-w-0 rounded-lg border px-3 py-2 ${STATUS_STYLES[step.status]}`}
          >
            <div className="flex min-w-0 items-start gap-2">
              <span
                aria-hidden="true"
                className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-current text-xs font-bold ${
                  step.status === "pending" ? "animate-pulse" : ""
                }`}
              >
                {STATUS_MARKS[step.status]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm leading-5">
                  <span className="sr-only">{step.status}: </span>
                  {step.label}
                  {typeof step.count === "number" ? (
                    <span className="ml-2 rounded-full bg-black/20 px-2 py-0.5 text-xs tabular-nums">
                      {step.count}
                    </span>
                  ) : null}
                </p>
                {step.detail ? (
                  <p className="mt-1 break-words text-xs leading-5 opacity-80">{step.detail}</p>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ol>

      {result ? (
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-neutral-300 sm:grid-cols-4">
          <div className="rounded-lg bg-white/5 px-2 py-2">
            <dt className="text-neutral-500">Folders checked</dt>
            <dd className="mt-0.5 font-semibold tabular-nums text-white">{result.summary.foldersChecked}</dd>
          </div>
          <div className="rounded-lg bg-white/5 px-2 py-2">
            <dt className="text-neutral-500">Folders synced</dt>
            <dd className="mt-0.5 font-semibold tabular-nums text-white">{result.summary.foldersSynced}</dd>
          </div>
          <div className="rounded-lg bg-white/5 px-2 py-2">
            <dt className="text-neutral-500">Imported</dt>
            <dd className="mt-0.5 font-semibold tabular-nums text-white">{result.summary.messagesImported}</dd>
          </div>
          <div className="rounded-lg bg-white/5 px-2 py-2">
            <dt className="text-neutral-500">Duplicates</dt>
            <dd className="mt-0.5 font-semibold tabular-nums text-white">{result.summary.duplicatesSkipped}</dd>
          </div>
        </dl>
      ) : null}
    </section>
  );
}
