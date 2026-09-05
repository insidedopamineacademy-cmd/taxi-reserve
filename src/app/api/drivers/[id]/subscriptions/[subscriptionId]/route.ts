export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getDriverAdminAccess } from "@/lib/drivers/access";
import { SubscriptionPaymentError, updateSubscriptionPayment } from "@/lib/drivers/subscriptionPaymentCore";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string; subscriptionId: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  const access = await getDriverAdminAccess();
  if (!access.authenticated) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!access.authorized) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id, subscriptionId } = await params;
  const body: unknown = await request.json().catch(() => null);
  try {
    const result = await updateSubscriptionPayment(prisma, {
      email: access.email, role: access.session?.user?.role,
    }, id, subscriptionId, body);
    for (const path of ["/drivers", `/drivers/${id}`, "/drivers/due", "/drivers/credits"]) revalidatePath(path);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SubscriptionPaymentError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Subscription payment update failed:", error);
    return NextResponse.json({ error: "Could not save subscription payment status." }, { status: 500 });
  }
}
