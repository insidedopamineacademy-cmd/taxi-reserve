export type SubscriptionPaymentStatus = "PAID" | "UNPAID" | "UNVERIFIED";
export type SubscriptionDisplayStatus = SubscriptionPaymentStatus | "PARTIAL" | "NOT_GENERATED" | "EXEMPT" | "INACTIVE" | "NOT_CONFIGURED" | "NOT_RECORDED";

function moneyCents(value: string) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new Error(`Invalid stored money value: ${value}`);
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new Error(`Stored money value is too large: ${value}`);
  return cents;
}

function centsMoney(value: number) {
  return `${Math.floor(value / 100)}.${(value % 100).toString().padStart(2, "0")}`;
}

export function subscriptionSettlement(
  paymentStatus: SubscriptionPaymentStatus,
  amount: string,
  automaticallyAllocated: string,
) {
  const total = moneyCents(amount);
  const allocated = automaticallyAllocated === "0" ? 0 : moneyCents(automaticallyAllocated);
  const paid = paymentStatus === "PAID" ? total : allocated > total ? total : allocated;
  const remaining = total - paid;
  const status: SubscriptionPaymentStatus | "PARTIAL" = remaining === 0
    ? "PAID"
    : paid > 0
      ? "PARTIAL"
      : paymentStatus;
  return {
    status,
    paid: centsMoney(paid),
    remaining: centsMoney(remaining),
    automaticallyAllocated: centsMoney(allocated),
  };
}

export function currentSubscriptionStatus(
  driver: { status: string; subscriptionExempt: boolean; vehicleType: string | null },
  charge: {
    paymentStatus: SubscriptionPaymentStatus;
    amount?: { toFixed(decimalPlaces: number): string };
    paymentAllocations?: Array<{ amount: { toFixed(decimalPlaces: number): string } }>;
  } | null | undefined,
): SubscriptionDisplayStatus {
  // Existing historical amounts/statuses always take precedence over today's configuration.
  if (charge) {
    if (!charge.amount || !charge.paymentAllocations) return charge.paymentStatus;
    const allocated = charge.paymentAllocations.reduce(
      (total, allocation) => total + moneyCents(allocation.amount.toFixed(2)),
      0,
    );
    return subscriptionSettlement(charge.paymentStatus, charge.amount.toFixed(2), centsMoney(allocated)).status;
  }
  if (driver.status !== "ACTIVE") return "INACTIVE";
  if (driver.subscriptionExempt) return "EXEMPT";
  if (!driver.vehicleType) return "NOT_CONFIGURED";
  return "NOT_GENERATED";
}

export function subscriptionStatusLabel(status: SubscriptionDisplayStatus, language: "en" | "es" = "en") {
  const labels = {
    PAID: ["Paid", "Pagado"], PARTIAL: ["Partially paid", "Parcial"], UNPAID: ["Unpaid", "Pendiente"], UNVERIFIED: ["Unverified", "Sin verificar"],
    NOT_GENERATED: ["Not generated", "Sin generar"], EXEMPT: ["Exempt", "Exento"],
    INACTIVE: ["Inactive", "Inactivo"], NOT_CONFIGURED: ["Type required", "Sin configurar"],
    NOT_RECORDED: ["No record", "Sin registro"],
  } as const;
  return labels[status][language === "es" ? 1 : 0];
}

export function subscriptionStatusTone(status: SubscriptionDisplayStatus) {
  return status === "PAID" ? "text-success" : status === "UNPAID" || status === "PARTIAL" ? "text-warning" : "text-muted";
}
