import "server-only";

import { Prisma } from "@prisma/client";
import type {
  AssistantDriverCandidateQuery,
  AssistantDriverFinanceRepository,
  AssistantDriverPeriodTotals,
  AssistantDriverTransactionQuery,
  AssistantDriverTransactionRecord,
  AssistantDriverTransactionType,
} from "@/lib/drivers/assistant-finance-core";
import {
  getDriverFinancialSummaries,
  getDriverFinancialSummary,
} from "@/lib/drivers/financials";
import { prisma } from "@/lib/prisma";

const driverSelect = {
  id: true,
  name: true,
  licenseNumber: true,
  vehicleType: true,
  subscriptionExempt: true,
  status: true,
} satisfies Prisma.DriverSelect;

function financialDateWhere(
  query: Pick<AssistantDriverTransactionQuery, "fromInclusive" | "toExclusive">,
): Prisma.DateTimeFilter | undefined {
  if (!query.fromInclusive && !query.toExclusive) return undefined;
  return {
    ...(query.fromInclusive ? { gte: query.fromInclusive } : {}),
    ...(query.toExclusive ? { lt: query.toExclusive } : {}),
  };
}

async function commissionRows(
  query: AssistantDriverTransactionQuery,
  take: number,
  skip: number,
): Promise<AssistantDriverTransactionRecord[]> {
  const date = financialDateWhere(query);
  const rows = await prisma.commissionEntry.findMany({
    where: { driverId: query.driverId, ...(date ? { entryDate: date } : {}) },
    orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    skip,
    take,
    select: {
      id: true,
      entryDate: true,
      createdAt: true,
      commissionAmount: true,
      manualPickupText: true,
      manualDropoffText: true,
      reservation: {
        select: { id: true, pickupText: true, dropoffText: true },
      },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    type: "COMMISSION",
    date: row.entryDate,
    createdAt: row.createdAt,
    amount: row.commissionAmount,
    manualPickupText: row.manualPickupText,
    manualDropoffText: row.manualDropoffText,
    reservation: row.reservation,
  }));
}

async function paymentRows(
  query: AssistantDriverTransactionQuery,
  take: number,
  skip: number,
): Promise<AssistantDriverTransactionRecord[]> {
  const date = financialDateWhere(query);
  const rows = await prisma.driverPayment.findMany({
    where: { driverId: query.driverId, ...(date ? { paymentDate: date } : {}) },
    orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    skip,
    take,
    select: {
      id: true,
      paymentDate: true,
      createdAt: true,
      amount: true,
      method: true,
    },
  });
  return rows.map((row) => ({
    id: row.id,
    type: "PAYMENT",
    date: row.paymentDate,
    createdAt: row.createdAt,
    amount: row.amount,
    method: row.method,
  }));
}

async function subscriptionRows(
  query: AssistantDriverTransactionQuery,
  take: number,
  skip: number,
): Promise<AssistantDriverTransactionRecord[]> {
  const date = financialDateWhere(query);
  const rows = await prisma.driverSubscriptionCharge.findMany({
    where: { driverId: query.driverId, ...(date ? { chargeMonth: date } : {}) },
    orderBy: [{ chargeMonth: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    skip,
    take,
    select: {
      id: true,
      chargeMonth: true,
      createdAt: true,
      amount: true,
    },
  });
  return rows.map((row) => ({
    id: row.id,
    type: "SUBSCRIPTION",
    date: row.chargeMonth,
    createdAt: row.createdAt,
    amount: row.amount,
  }));
}

function sortTransactions(rows: AssistantDriverTransactionRecord[]) {
  return rows.sort((left, right) =>
    right.date.getTime() - left.date.getTime() ||
    right.createdAt.getTime() - left.createdAt.getTime() ||
    left.type.localeCompare(right.type) ||
    left.id.localeCompare(right.id),
  );
}

async function aggregateCommission(
  query: Omit<AssistantDriverTransactionQuery, "offset" | "limit">,
) {
  const date = financialDateWhere(query);
  const result = await prisma.commissionEntry.aggregate({
    where: { driverId: query.driverId, ...(date ? { entryDate: date } : {}) },
    _sum: { commissionAmount: true },
  });
  return result._sum.commissionAmount;
}

async function aggregatePayments(
  query: Omit<AssistantDriverTransactionQuery, "offset" | "limit">,
) {
  const date = financialDateWhere(query);
  const result = await prisma.driverPayment.aggregate({
    where: { driverId: query.driverId, ...(date ? { paymentDate: date } : {}) },
    _sum: { amount: true },
  });
  return result._sum.amount;
}

async function aggregateSubscriptions(
  query: Omit<AssistantDriverTransactionQuery, "offset" | "limit">,
) {
  const date = financialDateWhere(query);
  const result = await prisma.driverSubscriptionCharge.aggregate({
    where: { driverId: query.driverId, ...(date ? { chargeMonth: date } : {}) },
    _sum: { amount: true },
  });
  return result._sum.amount;
}

function includesTransactionType(
  selected: AssistantDriverTransactionType,
  candidate: Exclude<AssistantDriverTransactionType, "ALL">,
) {
  return selected === "ALL" || selected === candidate;
}

export const assistantDriverFinanceRepository: AssistantDriverFinanceRepository = {
  async searchDriverCandidates(query: AssistantDriverCandidateQuery) {
    const rows = await prisma.driver.findMany({
      where: {
        ...(query.query
          ? {
              OR: [
                { name: { contains: query.query, mode: "insensitive" as const } },
                { licenseNumber: { contains: query.query, mode: "insensitive" as const } },
              ],
            }
          : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.vehicleType !== undefined
          ? { vehicleType: query.vehicleType === "UNSPECIFIED" ? null : query.vehicleType }
          : {}),
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: query.offset,
      take: query.limit + 1,
      select: driverSelect,
    });
    return {
      drivers: rows.slice(0, query.limit),
      hasMore: rows.length > query.limit,
    };
  },

  async getDriver(driverId) {
    return prisma.driver.findUnique({ where: { id: driverId }, select: driverSelect });
  },

  getFinancialSummaries: getDriverFinancialSummaries,
  getFinancialSummary: getDriverFinancialSummary,

  async listTransactions(query) {
    if (query.transactionType === "ALL") {
      const boundedTake = query.offset + query.limit + 1;
      const rows = sortTransactions((await Promise.all([
        commissionRows(query, boundedTake, 0),
        paymentRows(query, boundedTake, 0),
        subscriptionRows(query, boundedTake, 0),
      ])).flat());
      const page = rows.slice(query.offset, query.offset + query.limit + 1);
      return { rows: page.slice(0, query.limit), hasMore: page.length > query.limit };
    }

    const fetch = query.transactionType === "COMMISSION"
      ? commissionRows
      : query.transactionType === "PAYMENT"
        ? paymentRows
        : subscriptionRows;
    const rows = await fetch(query, query.limit + 1, query.offset);
    return { rows: rows.slice(0, query.limit), hasMore: rows.length > query.limit };
  },

  async getPeriodTotals(query): Promise<AssistantDriverPeriodTotals> {
    const [commissions, payments, subscriptionCharges] = await Promise.all([
      includesTransactionType(query.transactionType, "COMMISSION")
        ? aggregateCommission(query)
        : Promise.resolve(null),
      includesTransactionType(query.transactionType, "PAYMENT")
        ? aggregatePayments(query)
        : Promise.resolve(null),
      includesTransactionType(query.transactionType, "SUBSCRIPTION")
        ? aggregateSubscriptions(query)
        : Promise.resolve(null),
    ]);
    return { commissions, payments, subscriptionCharges };
  },
};
