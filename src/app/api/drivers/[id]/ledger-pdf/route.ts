export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getDriverAdminAccess } from "@/lib/drivers/access";
import { resolveCommissionPresentation } from "@/lib/drivers/commissionPresentation";
import { formatFinancialDateDisplay } from "@/lib/drivers/financialValidation";
import { getDriverFinancialSummary } from "@/lib/drivers/financials";
import { buildDriverLedgerPdf } from "@/lib/drivers/pdf";
import { formatSubscriptionMonthDisplay } from "@/lib/drivers/subscriptions";
import { subscriptionSettlement, subscriptionStatusLabel } from "@/lib/drivers/subscriptionStatus";
import { prisma } from "@/lib/prisma";
import { formatMadridDateDisplay } from "@/lib/time/madrid";

type RouteContext = { params: Promise<{ id: string }> };

function generatedDate() {
  return formatMadridDateDisplay(new Date());
}

function paymentMethodLabel(method: "CASH" | "BANK" | "OTHER") {
  if (method === "CASH") return "Cash";
  if (method === "BANK") return "Bank";
  return "Other";
}

function safeFilename(value: string) {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return normalized || "driver";
}

export async function GET(_request: Request, { params }: RouteContext) {
  const access = await getDriverAdminAccess();
  if (!access.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!access.authorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const driver = await prisma.driver.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      licenseNumber: true,
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
            select: {
              amount: true,
              subscriptionCharge: { select: { chargeMonth: true } },
            },
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

  if (!driver) {
    return NextResponse.json({ error: "Driver not found." }, { status: 404 });
  }

  const summary = await getDriverFinancialSummary(driver.id);
  const pdf = await buildDriverLedgerPdf({
    driverName: driver.name,
    licenseNumber: driver.licenseNumber,
    generatedDate: generatedDate(),
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
  });

  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="driver-ledger-${safeFilename(driver.name)}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
