export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getDriverAdminAccess } from "@/lib/drivers/access";
import { resolveCommissionPresentation } from "@/lib/drivers/commissionPresentation";
import { formatFinancialDateDisplay } from "@/lib/drivers/financialValidation";
import { getDriverFinancialSummaries } from "@/lib/drivers/financials";
import { buildFullDriverLedgerPdf } from "@/lib/drivers/pdf";
import { formatSubscriptionMonthDisplay } from "@/lib/drivers/subscriptions";
import { subscriptionSettlement, subscriptionStatusLabel } from "@/lib/drivers/subscriptionStatus";
import { sortDriversByName } from "@/lib/drivers/driverOrder";
import { prisma } from "@/lib/prisma";
import { formatMadridDateDisplay, formatMadridTime } from "@/lib/time/madrid";

function generatedDateTime() {
  const now = new Date();
  return `${formatMadridDateDisplay(now)} · ${formatMadridTime(now)}`;
}

function paymentMethodLabel(method: "CASH" | "BANK" | "OTHER") {
  if (method === "CASH") return "Cash";
  if (method === "BANK") return "Bank";
  return "Other";
}

export async function GET() {
  const access = await getDriverAdminAccess();
  if (!access.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!access.authorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const drivers = await prisma.driver.findMany({
    orderBy: [{ name: "asc" }, { licenseNumber: "asc" }],
    select: {
      id: true,
      name: true,
      licenseNumber: true,
      status: true,
      commissionEntries: {
        orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
        select: {
          commissionAmount: true,
          entryDate: true,
          manualPickupText: true,
          manualDropoffText: true,
          reservation: {
            select: { id: true, startAt: true, pickupText: true, dropoffText: true },
          },
          subscriptionCharge: { select: { id: true, chargeMonth: true } },
        },
      },
      payments: {
        orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
        select: {
          paymentDate: true,
          amount: true,
          method: true,
          subscriptionAllocations: {
            select: { amount: true, subscriptionCharge: { select: { chargeMonth: true } } },
          },
        },
      },
      subscriptionCharges: {
        orderBy: [{ chargeMonth: "desc" }, { createdAt: "desc" }],
        select: {
          chargeMonth: true,
          amount: true,
          paymentStatus: true,
          paymentAllocations: { select: { amount: true } },
        },
      },
    },
  });
  const summaries = await getDriverFinancialSummaries(
    drivers.map((driver) => driver.id),
  );

  const pdf = await buildFullDriverLedgerPdf({
    generatedAt: generatedDateTime(),
    drivers: sortDriversByName(drivers).map((driver) => {
      const summary = summaries.get(driver.id)!;
      return {
        name: driver.name,
        licenseNumber: driver.licenseNumber,
        status: driver.status,
        totalCommissions: summary.totalCommissions.toFixed(2),
        totalPayments: summary.totalPayments.toFixed(2),
        totalSubscriptionCharges: summary.totalSubscriptionCharges.toFixed(2),
        balance: summary.balance.toFixed(2),
        commissions: driver.commissionEntries.map((commission) => {
          const presentation = resolveCommissionPresentation(commission);
          return {
            ...presentation,
            amount: commission.commissionAmount.toFixed(2),
          };
        }),
        payments: driver.payments.map((payment) => {
          const allocated = payment.subscriptionAllocations.reduce((total, row) => total.plus(row.amount), payment.amount.minus(payment.amount));
          return {
            date: formatFinancialDateDisplay(payment.paymentDate), method: paymentMethodLabel(payment.method), amount: payment.amount.toFixed(2),
            subscriptionAllocations: payment.subscriptionAllocations.map((row) => ({ month: formatSubscriptionMonthDisplay(row.subscriptionCharge.chargeMonth), amount: row.amount.toFixed(2) })),
            commissionAmount: payment.amount.minus(allocated).toFixed(2),
          };
        }),
        subscriptions: driver.subscriptionCharges.map((charge) => {
          const allocated = charge.paymentAllocations.reduce((total, row) => total.plus(row.amount), charge.amount.minus(charge.amount));
          const settlement = subscriptionSettlement(charge.paymentStatus, charge.amount.toFixed(2), allocated.toFixed(2));
          return { month: formatSubscriptionMonthDisplay(charge.chargeMonth), amount: charge.amount.toFixed(2), paid: settlement.paid, remaining: settlement.remaining, status: subscriptionStatusLabel(settlement.status) };
        }),
      };
    }),
  });

  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="full-driver-commission-ledger.pdf"',
      "Cache-Control": "private, no-store",
    },
  });
}
