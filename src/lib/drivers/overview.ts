import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  calculateDriverFinancePosition,
  getDriverFinancialSummaries,
} from "@/lib/drivers/financials";
import { financialDateFromMadridInstant } from "@/lib/drivers/financialValidation";

export function getMadridPaymentPeriods(now = new Date()) {
  const today = financialDateFromMadridInstant(now);
  const mondayOffset = (today.getUTCDay() + 6) % 7;
  const weekStart = new Date(today);
  weekStart.setUTCDate(today.getUTCDate() - mondayOffset);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 7);

  const monthStart = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
  );
  const monthEnd = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1),
  );

  return { weekStart, weekEnd, monthStart, monthEnd };
}

export async function getDriverBalanceLines() {
  const drivers = await prisma.driver.findMany({
    orderBy: [{ name: "asc" }, { licenseNumber: "asc" }],
    select: {
      id: true,
      name: true,
      licenseNumber: true,
      status: true,
    },
  });
  const summaries = await getDriverFinancialSummaries(
    drivers.map((driver) => driver.id),
  );

  return drivers.map((driver) => ({
    ...driver,
    summary: summaries.get(driver.id)!,
  }));
}

export async function getDriverFinanceOverview(now = new Date()) {
  const { weekStart, weekEnd, monthStart, monthEnd } = getMadridPaymentPeriods(now);

  const [
    driverLines,
    weekPayments,
    monthPayments,
    monthSubscriptions,
    recentCommissions,
    recentPayments,
  ] =
    await Promise.all([
      getDriverBalanceLines(),
      prisma.driverPayment.aggregate({
        where: { paymentDate: { gte: weekStart, lt: weekEnd } },
        _sum: { amount: true },
      }),
      prisma.driverPayment.aggregate({
        where: { paymentDate: { gte: monthStart, lt: monthEnd } },
        _sum: { amount: true },
      }),
      prisma.driverSubscriptionCharge.aggregate({
        where: { chargeMonth: { gte: monthStart, lt: monthEnd } },
        _sum: { amount: true },
      }),
      prisma.commissionEntry.findMany({
        orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
        take: 8,
        select: {
          id: true,
          commissionAmount: true,
          entryDate: true,
          manualPickupText: true,
          manualDropoffText: true,
          driver: { select: { id: true, name: true } },
          reservation: {
            select: { id: true, pickupText: true, dropoffText: true },
          },
        },
      }),
      prisma.driverPayment.findMany({
        orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
        take: 8,
        select: {
          id: true,
          paymentDate: true,
          amount: true,
          method: true,
          driver: { select: { id: true, name: true } },
        },
      }),
    ]);

  const position = calculateDriverFinancePosition(
    driverLines.map((line) => line.summary),
  );

  return {
    ...position,
    collectedThisWeek: weekPayments._sum.amount ?? new Prisma.Decimal(0),
    collectedThisMonth: monthPayments._sum.amount ?? new Prisma.Decimal(0),
    subscriptionChargesThisMonth:
      monthSubscriptions._sum.amount ?? new Prisma.Decimal(0),
    activeDrivers: driverLines.filter((line) => line.status === "ACTIVE").length,
    recentCommissions,
    recentPayments,
  };
}
