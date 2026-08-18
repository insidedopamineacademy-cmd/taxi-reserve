import "server-only";

import { Prisma } from "@prisma/client";
import {
  calculateDriverFinancePosition,
  calculateDriverFinancialSummary,
  combineDriverFinancialSummaries,
  type DriverFinancePosition,
  type DriverFinancialSummary,
} from "@/lib/drivers/financialMath";
import { prisma } from "@/lib/prisma";

// Re-exported so existing server-side call sites keep importing these from
// "@/lib/drivers/financials"; the pure math lives in financialMath.ts so it can
// be unit-tested without pulling in the Prisma client.
export {
  calculateDriverFinancePosition,
  calculateDriverFinancialSummary,
  combineDriverFinancialSummaries,
};
export type { DriverFinancePosition, DriverFinancialSummary };

export async function getDriverFinancialSummary(
  driverId: string,
): Promise<DriverFinancialSummary> {
  const [commissions, payments, subscriptionCharges] = await Promise.all([
    prisma.commissionEntry.aggregate({
      where: { driverId },
      _sum: { commissionAmount: true },
    }),
    prisma.driverPayment.aggregate({
      where: { driverId },
      _sum: { amount: true },
    }),
    prisma.driverSubscriptionCharge.aggregate({
      where: { driverId },
      _sum: { amount: true },
    }),
  ]);

  return calculateDriverFinancialSummary(
    commissions._sum.commissionAmount,
    payments._sum.amount,
    subscriptionCharges._sum.amount,
  );
}

export async function getDriverFinancialSummaries(driverIds: string[]) {
  const summaries = new Map<string, DriverFinancialSummary>();
  if (driverIds.length === 0) return summaries;

  const [commissions, payments, subscriptionCharges] = await Promise.all([
    prisma.commissionEntry.groupBy({
      by: ["driverId"],
      where: { driverId: { in: driverIds } },
      _sum: { commissionAmount: true },
    }),
    prisma.driverPayment.groupBy({
      by: ["driverId"],
      where: { driverId: { in: driverIds } },
      _sum: { amount: true },
    }),
    prisma.driverSubscriptionCharge.groupBy({
      by: ["driverId"],
      where: { driverId: { in: driverIds } },
      _sum: { amount: true },
    }),
  ]);

  const commissionsByDriver = new Map(
    commissions.map((entry) => [entry.driverId, entry._sum.commissionAmount]),
  );
  const paymentsByDriver = new Map(
    payments.map((entry) => [entry.driverId, entry._sum.amount]),
  );
  const subscriptionsByDriver = new Map(
    subscriptionCharges.map((entry) => [entry.driverId, entry._sum.amount]),
  );

  for (const driverId of driverIds) {
    summaries.set(
      driverId,
      calculateDriverFinancialSummary(
        commissionsByDriver.get(driverId),
        paymentsByDriver.get(driverId),
        subscriptionsByDriver.get(driverId),
      ),
    );
  }

  return summaries;
}

export function formatEuro(amount: Prisma.Decimal) {
  const isNegative = amount.lessThan(0);
  const [whole, fraction] = amount.abs().toFixed(2).split(".");
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  return `${isNegative ? "-" : ""}€${groupedWhole}.${fraction}`;
}
