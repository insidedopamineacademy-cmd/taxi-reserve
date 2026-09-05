import type { PrismaClient } from "@prisma/client";
import { isDriverAdminRole } from "./access-core.ts";
import { getMadridFinancialPeriods, parseFinancialCivilDate } from "./financialDateCore.ts";

export class SubscriptionPaymentError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

type PaymentInput = {
  status: "PAID" | "UNPAID";
  paidDate: Date | null;
  note: string | null;
  expectedRevision: number;
};

export function parseSubscriptionPaymentInput(body: unknown, now = new Date()): PaymentInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new SubscriptionPaymentError(400, "Invalid request.");
  }
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["status", "paidDate", "note", "expectedRevision"].includes(key))) {
    throw new SubscriptionPaymentError(400, "Unexpected payment field.");
  }
  if (input.status !== "PAID" && input.status !== "UNPAID") {
    throw new SubscriptionPaymentError(400, "Choose paid or unpaid.");
  }
  if (!Number.isSafeInteger(input.expectedRevision) || (input.expectedRevision as number) < 0) {
    throw new SubscriptionPaymentError(400, "Reload this month's subscription before saving.");
  }
  if (input.note !== undefined && input.note !== null && typeof input.note !== "string") {
    throw new SubscriptionPaymentError(400, "Note must be text.");
  }
  const note = typeof input.note === "string" ? input.note.trim() || null : null;
  if (note && note.length > 500) throw new SubscriptionPaymentError(400, "Keep the note within 500 characters.");
  const paidDate = input.status === "PAID" ? parseFinancialCivilDate(input.paidDate) : null;
  if (input.status === "PAID" && (!paidDate || paidDate > getMadridFinancialPeriods(now).today)) {
    throw new SubscriptionPaymentError(400, "Enter a valid paid date, no later than today.");
  }
  if (input.status === "UNPAID" && input.paidDate !== undefined && input.paidDate !== null) {
    throw new SubscriptionPaymentError(400, "An unpaid month cannot have a paid date.");
  }
  return { status: input.status, paidDate, note, expectedRevision: input.expectedRevision as number };
}

/** Updates only operational receipt status. Never writes a DriverPayment or amount. */
export async function updateSubscriptionPayment(
  client: PrismaClient,
  actor: { email: string | null; role: unknown },
  driverId: string,
  subscriptionId: string,
  body: unknown,
  now = new Date(),
) {
  if (!actor.email) throw new SubscriptionPaymentError(401, "Unauthorized");
  if (!isDriverAdminRole(actor.role)) throw new SubscriptionPaymentError(403, "Forbidden");
  const input = parseSubscriptionPaymentInput(body, now);
  const email = actor.email.trim().toLowerCase();

  return client.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { email }, select: { id: true, role: true } });
    if (!user || !isDriverAdminRole(user.role)) throw new SubscriptionPaymentError(403, "Forbidden");
    const current = await tx.driverSubscriptionCharge.findFirst({ where: { id: subscriptionId, driverId } });
    if (!current) throw new SubscriptionPaymentError(404, "Subscription month not found.");

    const unchanged = current.paymentStatus === input.status &&
      current.paidAt?.getTime() === input.paidDate?.getTime() && current.paymentNote === input.note;
    // Repeated identical confirmations preserve the original date, recorder and audit.
    if (unchanged) return { id: current.id, changed: false, revision: current.paymentRevision };
    if (current.paymentRevision !== input.expectedRevision) {
      throw new SubscriptionPaymentError(409, "This month changed since you opened it. Reload and review it before saving.");
    }

    const paidByUserId = input.status === "PAID"
      ? current.paymentStatus === "PAID" ? current.paidByUserId : user.id
      : null;
    const result = await tx.driverSubscriptionCharge.updateMany({
      where: { id: current.id, driverId, paymentRevision: input.expectedRevision },
      data: {
        paymentStatus: input.status, paidAt: input.paidDate, paidByUserId,
        paymentNote: input.note, paymentRevision: { increment: 1 },
      },
    });
    if (result.count !== 1) throw new SubscriptionPaymentError(409, "This month changed. Reload and try again.");

    // Receipt status and its correction history must succeed or fail together.
    await tx.activityLog.create({ data: {
      action: current.paymentStatus === input.status ? "driver_subscription_payment_updated"
        : input.status === "PAID" ? "driver_subscription_marked_paid" : "driver_subscription_marked_unpaid",
      entityType: "driver_subscription_charge", entityId: current.id, userEmail: email,
      metadata: {
        driverId, chargeMonth: current.chargeMonth.toISOString().slice(0, 7),
        fromStatus: current.paymentStatus, toStatus: input.status,
        previousPaidAt: current.paidAt?.toISOString().slice(0, 10) ?? null,
        paidAt: input.paidDate?.toISOString().slice(0, 10) ?? null,
        previousPaidByUserId: current.paidByUserId, paidByUserId,
        previousNote: current.paymentNote, note: input.note,
        revision: current.paymentRevision + 1,
      },
    } });
    return { id: current.id, changed: true, revision: current.paymentRevision + 1 };
  });
}
