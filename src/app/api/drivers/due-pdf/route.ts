export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getDriverAdminAccess } from "@/lib/drivers/access";
import {
  buildDueCommissionsPdf,
  prepareDueCommissionsReport,
} from "@/lib/drivers/duePdf";
import { getDriverBalanceLines } from "@/lib/drivers/overview";
import { formatMadridDateDisplay } from "@/lib/time/madrid";

import { formatBalanceSubscriptionMonth } from "@/lib/drivers/balanceReport";
import { getMadridFinancialPeriods } from "@/lib/drivers/financialDateCore";

export async function GET() {
  const access = await getDriverAdminAccess();
  if (!access.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!access.authorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const report = prepareDueCommissionsReport(await getDriverBalanceLines(now));
  const pdf = await buildDueCommissionsPdf({
    generatedDate: formatMadridDateDisplay(now),
    subscriptionMonth: formatBalanceSubscriptionMonth(getMadridFinancialPeriods(now).monthStart),
    ...report,
  });

  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="driver-commissions-due.pdf"',
      "Cache-Control": "private, no-store",
    },
  });
}
