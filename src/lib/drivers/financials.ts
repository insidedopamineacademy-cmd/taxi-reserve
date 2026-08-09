import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type DriverFinancialSummary = {
  totalCommissions: Prisma.Decimal;
  totalPayments: Prisma.Decimal;
  balance: Prisma.Decimal;
};

function decimalOrZero(value: Prisma.Decimal | null | undefined) {
  return value ?? new Prisma.Decimal(0);
}

export function calculateDriverFinancialSummary(
  commissions: Prisma.Decimal | null | undefined,
  payments: Prisma.Decimal | null | undefined,
): DriverFinancialSummary {
  const totalCommissions = decimalOrZero(commissions);
  const totalPayments = decimalOrZero(payments);

  return {
    totalCommissions,
    totalPayments,
    balance: totalCommissions.minus(totalPayments),
  };
}

export async function getDriverFinancialSummary(
  driverId: string,
): Promise<DriverFinancialSummary> {
  const [commissions, payments] = await Promise.all([
    prisma.commissionEntry.aggregate({
      where: { driverId },
      _sum: { commissionAmount: true },
    }),
    prisma.driverPayment.aggregate({
      where: { driverId },
      _sum: { amount: true },
    }),
  ]);

  return calculateDriverFinancialSummary(
    commissions._sum.commissionAmount,
    payments._sum.amount,
  );
}

export async function getDriverFinancialSummaries(driverIds: string[]) {
  const summaries = new Map<string, DriverFinancialSummary>();
  if (driverIds.length === 0) return summaries;

  const [commissions, payments] = await Promise.all([
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
  ]);

  const commissionsByDriver = new Map(
    commissions.map((entry) => [entry.driverId, entry._sum.commissionAmount]),
  );
  const paymentsByDriver = new Map(
    payments.map((entry) => [entry.driverId, entry._sum.amount]),
  );

  for (const driverId of driverIds) {
    summaries.set(
      driverId,
      calculateDriverFinancialSummary(
        commissionsByDriver.get(driverId),
        paymentsByDriver.get(driverId),
      ),
    );
  }

  return summaries;
}

export function combineDriverFinancialSummaries(
  summaries: Iterable<DriverFinancialSummary>,
): DriverFinancialSummary {
  let totalCommissions = new Prisma.Decimal(0);
  let totalPayments = new Prisma.Decimal(0);

  for (const summary of summaries) {
    totalCommissions = totalCommissions.plus(summary.totalCommissions);
    totalPayments = totalPayments.plus(summary.totalPayments);
  }

  return calculateDriverFinancialSummary(totalCommissions, totalPayments);
}

export function formatEuro(amount: Prisma.Decimal) {
  const isNegative = amount.lessThan(0);
  const [whole, fraction] = amount.abs().toFixed(2).split(".");
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  return `${isNegative ? "-" : ""}€${groupedWhole}.${fraction}`;
}
