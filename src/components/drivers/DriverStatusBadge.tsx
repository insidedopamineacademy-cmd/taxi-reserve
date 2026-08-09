type DriverStatus = "ACTIVE" | "INACTIVE";

export default function DriverStatusBadge({ status }: { status: DriverStatus }) {
  const className =
    status === "ACTIVE"
      ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
      : "border-neutral-600 bg-neutral-800 text-neutral-300";

  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold tracking-wide ${className}`}
    >
      {status}
    </span>
  );
}
