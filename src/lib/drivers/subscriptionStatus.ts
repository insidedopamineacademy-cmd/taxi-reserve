export type SubscriptionPaymentStatus = "PAID" | "UNPAID" | "UNVERIFIED";
export type SubscriptionDisplayStatus = SubscriptionPaymentStatus | "NOT_GENERATED" | "EXEMPT" | "INACTIVE" | "NOT_CONFIGURED" | "NOT_RECORDED";

export function currentSubscriptionStatus(
  driver: { status: string; subscriptionExempt: boolean; vehicleType: string | null },
  charge: { paymentStatus: SubscriptionPaymentStatus } | null | undefined,
): SubscriptionDisplayStatus {
  // Existing historical amounts/statuses always take precedence over today's configuration.
  if (charge) return charge.paymentStatus;
  if (driver.status !== "ACTIVE") return "INACTIVE";
  if (driver.subscriptionExempt) return "EXEMPT";
  if (!driver.vehicleType) return "NOT_CONFIGURED";
  return "NOT_GENERATED";
}

export function subscriptionStatusLabel(status: SubscriptionDisplayStatus, language: "en" | "es" = "en") {
  const labels = {
    PAID: ["Paid", "Pagado"], UNPAID: ["Unpaid", "Pendiente"], UNVERIFIED: ["Unverified", "Sin verificar"],
    NOT_GENERATED: ["Not generated", "Sin generar"], EXEMPT: ["Exempt", "Exento"],
    INACTIVE: ["Inactive", "Inactivo"], NOT_CONFIGURED: ["Type required", "Sin configurar"],
    NOT_RECORDED: ["No record", "Sin registro"],
  } as const;
  return labels[status][language === "es" ? 1 : 0];
}

export function subscriptionStatusTone(status: SubscriptionDisplayStatus) {
  return status === "PAID" ? "text-success" : status === "UNPAID" ? "text-warning" : "text-muted";
}
