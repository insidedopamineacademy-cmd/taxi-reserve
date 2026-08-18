import { Prisma } from "@prisma/client";

export type DriverFinancialSummary = {
  totalCommissions: Prisma.Decimal;
  totalPayments: Prisma.Decimal;
  totalSubscriptionCharges: Prisma.Decimal;
  balance: Prisma.Decimal;
};

function decimalOrZero(value: Prisma.Decimal | null | undefined) {
  return value ?? new Prisma.Decimal(0);
}

export function calculateDriverFinancialSummary(
  commissions: Prisma.Decimal | null | undefined,
  payments: Prisma.Decimal | null | undefined,
  subscriptionCharges: Prisma.Decimal | null | undefined,
): DriverFinancialSummary {
  const totalCommissions = decimalOrZero(commissions);
  const totalPayments = decimalOrZero(payments);
  const totalSubscriptionCharges = decimalOrZero(subscriptionCharges);

  return {
    totalCommissions,
    totalPayments,
    totalSubscriptionCharges,
    balance: totalCommissions.minus(totalPayments).minus(totalSubscriptionCharges),
  };
}

/**
 * Aggregates every driver summary into one combined summary. Its `balance` is
 * the NET position: positive (owed) and negative (credit) balances cancel out.
 */
export function combineDriverFinancialSummaries(
  summaries: Iterable<DriverFinancialSummary>,
): DriverFinancialSummary {
  let totalCommissions = new Prisma.Decimal(0);
  let totalPayments = new Prisma.Decimal(0);
  let totalSubscriptionCharges = new Prisma.Decimal(0);

  for (const summary of summaries) {
    totalCommissions = totalCommissions.plus(summary.totalCommissions);
    totalPayments = totalPayments.plus(summary.totalPayments);
    totalSubscriptionCharges = totalSubscriptionCharges.plus(
      summary.totalSubscriptionCharges,
    );
  }

  return calculateDriverFinancialSummary(
    totalCommissions,
    totalPayments,
    totalSubscriptionCharges,
  );
}

export type DriverFinancePosition = {
  totalCommissionDue: Prisma.Decimal;
  driverCredits: Prisma.Decimal;
  netPosition: Prisma.Decimal;
};

/**
 * Splits driver balances into gross pending (drivers who owe) and credits
 * (drivers in credit). `totalCommissionDue` is what the Pending Commissions
 * report must show — credits do NOT reduce it, because one driver's credit does
 * not make another driver owe less. `netPosition` = pending − credits.
 */
export function calculateDriverFinancePosition(
  summaries: Iterable<DriverFinancialSummary>,
): DriverFinancePosition {
  let totalCommissionDue = new Prisma.Decimal(0);
  let driverCredits = new Prisma.Decimal(0);

  for (const summary of summaries) {
    if (summary.balance.greaterThan(0)) {
      totalCommissionDue = totalCommissionDue.plus(summary.balance);
    } else if (summary.balance.lessThan(0)) {
      driverCredits = driverCredits.plus(summary.balance.abs());
    }
  }

  return {
    totalCommissionDue,
    driverCredits,
    netPosition: totalCommissionDue.minus(driverCredits),
  };
}
