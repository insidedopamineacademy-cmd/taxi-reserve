export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getDriverAdminAccess } from "@/lib/drivers/access";
import { resolveCommissionRoute } from "@/lib/drivers/commissionRoute";
import { formatFinancialDateDisplay } from "@/lib/drivers/financialValidation";
import { getDriverFinancialSummaries } from "@/lib/drivers/financials";
import { buildFullDriverLedgerPdf } from "@/lib/drivers/pdf";
import { formatSubscriptionMonthDisplay } from "@/lib/drivers/subscriptions";
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
            select: { id: true, pickupText: true, dropoffText: true },
          },
        },
      },
      payments: {
        orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
        select: {
          paymentDate: true,
          amount: true,
          method: true,
        },
      },
      subscriptionCharges: {
        orderBy: [{ chargeMonth: "desc" }, { createdAt: "desc" }],
        select: {
          chargeMonth: true,
          amount: true,
        },
      },
    },
  });
  const summaries = await getDriverFinancialSummaries(
    drivers.map((driver) => driver.id),
  );

  const pdf = await buildFullDriverLedgerPdf({
    generatedAt: generatedDateTime(),
    drivers: drivers.map((driver) => {
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
          const route = resolveCommissionRoute(commission);
          return {
            date: formatFinancialDateDisplay(commission.entryDate),
            pickupText: route.pickupText,
            dropoffText: route.dropoffText,
            amount: commission.commissionAmount.toFixed(2),
            source: route.source === "reservation" ? "Reservation" : "Manual",
          };
        }),
        payments: driver.payments.map((payment) => ({
          date: formatFinancialDateDisplay(payment.paymentDate),
          method: paymentMethodLabel(payment.method),
          amount: payment.amount.toFixed(2),
        })),
        subscriptions: driver.subscriptionCharges.map((charge) => ({
          month: formatSubscriptionMonthDisplay(charge.chargeMonth),
          amount: charge.amount.toFixed(2),
        })),
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
