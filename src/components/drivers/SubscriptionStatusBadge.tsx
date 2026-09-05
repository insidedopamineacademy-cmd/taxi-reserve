import { subscriptionStatusLabel, subscriptionStatusTone, type SubscriptionDisplayStatus } from "@/lib/drivers/subscriptionStatus";

export default function SubscriptionStatusBadge({ status, month, language = "en" }: {
  status: SubscriptionDisplayStatus;
  month?: string;
  language?: "en" | "es";
}) {
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-1 text-xs font-medium ${subscriptionStatusTone(status)}`}>
      {month && <span>{month} ·</span>}
      <span>{subscriptionStatusLabel(status, language)}</span>
    </span>
  );
}
