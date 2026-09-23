import { Prisma, type DriverPaymentMethod, type PrismaClient } from "@prisma/client";

export class DriverPaymentError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type SubscriptionDebt = {
  id: string;
  chargeMonth: Date;
  amount: Prisma.Decimal;
  paymentStatus: "UNVERIFIED" | "UNPAID" | "PAID";
  allocatedAmount: Prisma.Decimal;
};

export type PlannedSubscriptionAllocation = {
  subscriptionChargeId: string;
  chargeMonth: Date;
  amount: Prisma.Decimal;
  previousAllocatedAmount: Prisma.Decimal;
  remainingAfter: Prisma.Decimal;
  fromStatus: "UNVERIFIED" | "UNPAID" | "PARTIAL" | "PAID";
  toStatus: "PARTIAL" | "PAID";
};

type CreatePaymentInput = {
  driverId: string;
  paymentDate: Date;
  amount: Prisma.Decimal;
  method: DriverPaymentMethod;
  notes: string | null;
};

type EditPaymentInput = Omit<CreatePaymentInput, "driverId"> & { paymentId: string };

function firstDayOfPaymentMonth(paymentDate: Date) {
  return new Date(Date.UTC(paymentDate.getUTCFullYear(), paymentDate.getUTCMonth(), 1));
}

function allocatedTotal(rows: Array<{ amount: Prisma.Decimal }>) {
  return rows.reduce((total, row) => total.plus(row.amount), new Prisma.Decimal(0));
}

function debtStatus(debt: SubscriptionDebt): "UNVERIFIED" | "UNPAID" | "PARTIAL" | "PAID" {
  return debt.allocatedAmount.greaterThan(0) ? "PARTIAL" : debt.paymentStatus;
}

export function planPaymentAllocation(paymentAmount: Prisma.Decimal, debts: readonly SubscriptionDebt[]) {
  if (paymentAmount.lessThan("0.01") || paymentAmount.decimalPlaces() > 2) {
    throw new DriverPaymentError(400, "Payment amount must be at least €0.01 with no more than two decimals.");
  }

  let available = paymentAmount;
  const subscriptions: PlannedSubscriptionAllocation[] = [];

  for (const debt of debts) {
    if (!available.greaterThan(0) || debt.paymentStatus === "PAID") break;
    const outstanding = Prisma.Decimal.max(debt.amount.minus(debt.allocatedAmount), 0);
    if (!outstanding.greaterThan(0)) continue;
    const amount = Prisma.Decimal.min(available, outstanding);
    const remainingAfter = outstanding.minus(amount);
    subscriptions.push({
      subscriptionChargeId: debt.id,
      chargeMonth: debt.chargeMonth,
      amount,
      previousAllocatedAmount: debt.allocatedAmount,
      remainingAfter,
      fromStatus: debtStatus(debt),
      toStatus: remainingAfter.isZero() ? "PAID" : "PARTIAL",
    });
    available = available.minus(amount);
  }

  const subscriptionTotal = subscriptions.reduce(
    (total, allocation) => total.plus(allocation.amount),
    new Prisma.Decimal(0),
  );
  if (!subscriptionTotal.plus(available).equals(paymentAmount)) {
    throw new Error("Payment allocation does not reconcile.");
  }
  return { subscriptions, subscriptionTotal, commissionAmount: available };
}

async function lockDriver(tx: Prisma.TransactionClient, driverId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Driver" WHERE "id" = ${driverId} FOR UPDATE`;
}

async function findEligibleDebts(
  tx: Prisma.TransactionClient | PrismaClient,
  driverId: string,
  paymentDate: Date,
): Promise<SubscriptionDebt[]> {
  const charges = await tx.driverSubscriptionCharge.findMany({
    where: {
      driverId,
      chargeMonth: { lte: firstDayOfPaymentMonth(paymentDate) },
      paymentStatus: { not: "PAID" },
    },
    orderBy: [{ chargeMonth: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      chargeMonth: true,
      amount: true,
      paymentStatus: true,
      paymentAllocations: { select: { amount: true } },
    },
  });
  return charges.map(({ paymentAllocations, ...charge }) => ({
    ...charge,
    allocatedAmount: allocatedTotal(paymentAllocations),
  }));
}

export async function getEligibleSubscriptionDebts(
  client: PrismaClient,
  driverId: string,
  paymentDate: Date,
) {
  const debts = await findEligibleDebts(client, driverId, paymentDate);
  return debts.filter((debt) => debt.allocatedAmount.lessThan(debt.amount));
}

export async function recordDriverPayment(
  client: PrismaClient,
  actorEmail: string,
  input: CreatePaymentInput,
) {
  return client.$transaction(async (tx) => {
    await lockDriver(tx, input.driverId);
    const driver = await tx.driver.findFirst({
      where: { id: input.driverId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!driver) throw new DriverPaymentError(404, "Driver not found.");
    if (driver.status !== "ACTIVE") {
      throw new DriverPaymentError(409, "Activate this driver before recording a new payment.");
    }

    const payment = await tx.driverPayment.create({
      data: input,
      select: { id: true, driverId: true, amount: true, paymentDate: true, method: true },
    });
    const plan = planPaymentAllocation(input.amount, await findEligibleDebts(tx, input.driverId, input.paymentDate));
    if (plan.subscriptions.length > 0) {
      await tx.driverSubscriptionPaymentAllocation.createMany({
        data: plan.subscriptions.map((allocation) => ({
          driverPaymentId: payment.id,
          subscriptionChargeId: allocation.subscriptionChargeId,
          amount: allocation.amount,
        })),
      });
    }

    await tx.activityLog.create({
      data: {
        action: "driver_payment_created",
        entityType: "driver_payment",
        entityId: payment.id,
        userEmail: actorEmail.trim().toLowerCase(),
        metadata: {
          driverId: payment.driverId,
          amount: payment.amount.toFixed(2),
          method: payment.method,
          commissionAmount: plan.commissionAmount.toFixed(2),
          subscriptionAmount: plan.subscriptionTotal.toFixed(2),
          subscriptionAllocations: plan.subscriptions.map((allocation) => ({
            subscriptionChargeId: allocation.subscriptionChargeId,
            chargeMonth: allocation.chargeMonth.toISOString().slice(0, 7),
            amount: allocation.amount.toFixed(2),
            fromStatus: allocation.fromStatus,
            toStatus: allocation.toStatus,
          })),
        },
      },
    });
    return { payment, allocation: plan };
  });
}

export async function editDriverPaymentMetadata(
  client: PrismaClient,
  actorEmail: string,
  driverId: string,
  input: EditPaymentInput,
) {
  return client.$transaction(async (tx) => {
    await lockDriver(tx, driverId);
    const current = await tx.driverPayment.findFirst({
      where: { id: input.paymentId, driverId },
      select: { id: true, amount: true, paymentDate: true, method: true, notes: true },
    });
    if (!current) throw new DriverPaymentError(404, "Payment not found.");
    if (!current.amount.equals(input.amount) || current.paymentDate.getTime() !== input.paymentDate.getTime()) {
      throw new DriverPaymentError(409, "To correct a payment amount or date, delete it and record a replacement so allocations reverse safely.");
    }
    const changedFields: string[] = [];
    if (current.method !== input.method) changedFields.push("method");
    if (current.notes !== input.notes) changedFields.push("notes");
    if (changedFields.length === 0) return { id: current.id, driverId, changed: false };

    const payment = await tx.driverPayment.update({
      where: { id: current.id },
      data: { method: input.method, notes: input.notes },
      select: { id: true, driverId: true },
    });
    await tx.activityLog.create({
      data: {
        action: "driver_payment_updated",
        entityType: "driver_payment",
        entityId: payment.id,
        userEmail: actorEmail.trim().toLowerCase(),
        metadata: { driverId, changedFields },
      },
    });
    return { ...payment, changed: true };
  });
}

export async function deleteDriverPayment(
  client: PrismaClient,
  actorEmail: string,
  driverId: string,
  paymentId: string,
) {
  return client.$transaction(async (tx) => {
    await lockDriver(tx, driverId);
    const payment = await tx.driverPayment.findFirst({
      where: { id: paymentId, driverId },
      select: {
        id: true,
        amount: true,
        subscriptionAllocations: {
          select: {
            amount: true,
            subscriptionCharge: { select: { id: true, chargeMonth: true } },
          },
        },
      },
    });
    // DELETE is idempotent: a repeated reversal does not create another audit row.
    if (!payment) return { changed: false };

    await tx.driverPayment.delete({ where: { id: payment.id } });
    const subscriptionAmount = allocatedTotal(payment.subscriptionAllocations);
    await tx.activityLog.create({
      data: {
        action: "driver_payment_deleted",
        entityType: "driver_payment",
        entityId: payment.id,
        userEmail: actorEmail.trim().toLowerCase(),
        metadata: {
          driverId,
          amount: payment.amount.toFixed(2),
          reversedSubscriptionAmount: subscriptionAmount.toFixed(2),
          reversedCommissionAmount: payment.amount.minus(subscriptionAmount).toFixed(2),
          reversedSubscriptionAllocations: payment.subscriptionAllocations.map((allocation) => ({
            subscriptionChargeId: allocation.subscriptionCharge.id,
            chargeMonth: allocation.subscriptionCharge.chargeMonth.toISOString().slice(0, 7),
            amount: allocation.amount.toFixed(2),
          })),
        },
      },
    });
    return { changed: true };
  });
}
