export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runMonthlyDriverSubscriptions } from "@/lib/drivers/subscriptions";

function hasValidCronAuthorization(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    console.error("Driver subscription cron is disabled because CRON_SECRET is not configured.");
    return NextResponse.json(
      { error: "Monthly subscription automation is not configured." },
      { status: 503 },
    );
  }
  if (!hasValidCronAuthorization(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runMonthlyDriverSubscriptions();
    return NextResponse.json({
      ok: true,
      chargeMonth: result.chargeMonth.toISOString().slice(0, 10),
      eligible: result.eligibleCount,
      created: result.createdCount,
      alreadyExisting: result.alreadyExistingCount,
      skippedInactive: result.skippedInactiveCount,
      skippedExempt: result.skippedExemptCount,
      skippedMissingVehicleType: result.skippedMissingVehicleTypeCount,
    });
  } catch (error) {
    console.error("Monthly driver subscription generation failed:", error);
    return NextResponse.json(
      { error: "Could not generate monthly driver subscription charges." },
      { status: 500 },
    );
  }
}
