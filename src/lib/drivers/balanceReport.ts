import "server-only";

import { Prisma } from "@prisma/client";
import { compareDriversByName } from "./driverOrder.ts";
import type { SubscriptionDisplayStatus } from "./subscriptionStatus.ts";
import { calculateDriverFinancePosition } from "./financialMath.ts";

export type DriverBalanceLine = {
  id: string;
  name: string;
  licenseNumber: string | null | undefined;
  summary: { balance: Prisma.Decimal };
  currentMonthSubscription: Prisma.Decimal | null;
  subscriptionStatus: SubscriptionDisplayStatus;
};

export type DriverBalanceKind = "credits" | "due";

/** Presentation of canonical balances only; subscription never adjusts them. */
export function prepareDriverBalanceReport(
  lines: readonly DriverBalanceLine[],
  kind: DriverBalanceKind,
) {
  const position = calculateDriverFinancePosition(lines.map((line) => line.summary));
  const selected = lines
    .filter(({ summary }) => kind === "credits"
      ? summary.balance.lessThan(0)
      : summary.balance.greaterThan(0))
    .sort(compareDriversByName);

  return {
    total: (kind === "credits" ? position.driverCredits : position.totalCommissionDue).toFixed(2),
    drivers: selected.map((line) => ({
      id: line.id,
      name: line.name,
      licenseNumber: line.licenseNumber?.trim() || "-",
      // Credit is displayed as the positive amount in the driver's favour.
      balance: line.summary.balance.abs().toFixed(2),
      subscription: (line.currentMonthSubscription ?? new Prisma.Decimal(0)).toFixed(2),
      subscriptionStatus: line.subscriptionStatus,
    })),
  };
}

export function formatBalanceEuro(value: string) {
  const amount = new Prisma.Decimal(value);
  const [whole, fraction] = amount.abs().toFixed(2).split(".");
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${amount.lessThan(0) ? "-" : ""}€ ${groupedWhole}.${fraction}`;
}

export function formatBalanceSubscriptionMonth(month: Date) {
  return new Intl.DateTimeFormat("es-ES", {
    month: "long", year: "numeric", timeZone: "UTC",
  }).format(month);
}
