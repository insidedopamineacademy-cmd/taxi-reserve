import "server-only";

import { Prisma } from "@prisma/client";
import { calculateDriverFinancePosition } from "./financialMath.ts";

export type DriverBalanceLine = {
  id: string;
  name: string;
  licenseNumber: string | null | undefined;
  summary: { balance: Prisma.Decimal };
  currentMonthSubscription: Prisma.Decimal | null;
};

export type DriverBalanceKind = "credits" | "due";

function compareText(left: string, right: string) {
  const a = left.normalize("NFKD").toLocaleLowerCase("en-US");
  const b = right.normalize("NFKD").toLocaleLowerCase("en-US");
  return a < b ? -1 : a > b ? 1 : left < right ? -1 : left > right ? 1 : 0;
}

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
    .sort((left, right) =>
      right.summary.balance.abs().comparedTo(left.summary.balance.abs()) ||
      compareText(left.name, right.name) ||
      compareText(left.licenseNumber?.trim() ?? "", right.licenseNumber?.trim() ?? "") ||
      compareText(left.id, right.id));

  return {
    total: (kind === "credits" ? position.driverCredits : position.totalCommissionDue).toFixed(2),
    drivers: selected.map((line) => ({
      id: line.id,
      name: line.name,
      licenseNumber: line.licenseNumber?.trim() || "-",
      // Credit is displayed as the positive amount in the driver's favour.
      balance: line.summary.balance.abs().toFixed(2),
      subscription: (line.currentMonthSubscription ?? new Prisma.Decimal(0)).toFixed(2),
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
