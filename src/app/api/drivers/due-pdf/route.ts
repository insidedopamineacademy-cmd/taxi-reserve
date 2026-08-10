export const runtime = "nodejs";

import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getDriverAdminAccess } from "@/lib/drivers/access";
import { getDriverBalanceLines } from "@/lib/drivers/overview";
import { buildDueCommissionsPdf } from "@/lib/drivers/pdf";

function generatedDate() {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeZone: "Europe/Madrid",
  }).format(new Date());
}

export async function GET() {
  const access = await getDriverAdminAccess();
  if (!access.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!access.authorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const dueDrivers = (await getDriverBalanceLines()).filter((line) =>
    line.summary.balance.greaterThan(0),
  );
  const totalDue = dueDrivers.reduce(
    (total, line) => total.plus(line.summary.balance),
    new Prisma.Decimal(0),
  );
  const pdf = await buildDueCommissionsPdf({
    generatedDate: generatedDate(),
    totalDue: totalDue.toFixed(2),
    drivers: dueDrivers.map((line) => ({
      name: line.name,
      licenseNumber: line.licenseNumber,
      totalCommissions: line.summary.totalCommissions.toFixed(2),
      totalPayments: line.summary.totalPayments.toFixed(2),
      totalSubscriptionCharges: line.summary.totalSubscriptionCharges.toFixed(2),
      balance: line.summary.balance.toFixed(2),
    })),
  });

  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="driver-commissions-due.pdf"',
      "Cache-Control": "private, no-store",
    },
  });
}
