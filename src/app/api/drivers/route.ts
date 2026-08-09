import { DriverStatus, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activityLog";
import { getDriverAdminAccess } from "@/lib/drivers/access";
import { prisma } from "@/lib/prisma";

function parseStatus(value: unknown) {
  if (value === DriverStatus.ACTIVE || value === DriverStatus.INACTIVE) return value;
  return null;
}

function duplicateLicenseResponse() {
  return NextResponse.json(
    { error: "A driver with this license number already exists." },
    { status: 409 },
  );
}

export async function POST(request: Request) {
  const access = await getDriverAdminAccess();
  if (!access.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!access.authorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const licenseNumber =
    typeof input.licenseNumber === "string" ? input.licenseNumber.trim() : "";
  const status = input.status === undefined ? DriverStatus.ACTIVE : parseStatus(input.status);

  if (!name) {
    return NextResponse.json({ error: "Enter the driver's name." }, { status: 400 });
  }
  if (name.length > 200) {
    return NextResponse.json({ error: "Driver name must be 200 characters or fewer." }, { status: 400 });
  }
  if (!licenseNumber) {
    return NextResponse.json({ error: "Enter the driver's license number." }, { status: 400 });
  }
  if (licenseNumber.length > 100) {
    return NextResponse.json(
      { error: "License number must be 100 characters or fewer." },
      { status: 400 },
    );
  }
  if (!status) {
    return NextResponse.json({ error: "Select a valid driver status." }, { status: 400 });
  }

  const duplicate = await prisma.driver.findUnique({
    where: { licenseNumber },
    select: { id: true },
  });
  if (duplicate) return duplicateLicenseResponse();

  try {
    const driver = await prisma.driver.create({
      data: { name, licenseNumber, status },
      select: { id: true, name: true, licenseNumber: true, status: true },
    });

    await logActivity({
      action: "driver_created",
      entityType: "driver",
      entityId: driver.id,
      userEmail: access.email,
      metadata: { status: driver.status },
    });

    revalidatePath("/drivers");
    revalidatePath("/drivers/overview");
    revalidatePath("/commissions");
    revalidatePath("/payments");
    return NextResponse.json({ driver }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return duplicateLicenseResponse();
    }

    console.error("Driver creation failed:", error);
    return NextResponse.json({ error: "Could not create the driver." }, { status: 500 });
  }
}
