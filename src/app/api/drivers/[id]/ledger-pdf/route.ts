export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getDriverAdminAccess } from "@/lib/drivers/access";
import { resolveCommissionRoute } from "@/lib/drivers/commissionRoute";
import { formatFinancialDateDisplay } from "@/lib/drivers/financialValidation";
import { getDriverFinancialSummary } from "@/lib/drivers/financials";
import { buildDriverLedgerPdf } from "@/lib/drivers/pdf";
import { formatSubscriptionMonthDisplay } from "@/lib/drivers/subscriptions";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string }> };

function generatedDate() {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeZone: "Europe/Madrid",
  }).format(new Date());
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
      const route = resolveCommissionRoute(commission);
      return {
        date: formatFinancialDateDisplay(commission.entryDate),
        pickupText: route.pickupText,
        dropoffText: route.dropoffText,
        amount: commission.commissionAmount.toFixed(2),
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
  });

  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="driver-ledger-${safeFilename(driver.name)}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
