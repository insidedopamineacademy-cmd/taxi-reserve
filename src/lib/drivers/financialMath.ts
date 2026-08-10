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
