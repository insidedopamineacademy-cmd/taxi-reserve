import { DriverStatus, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activityLog";
import { getDriverAdminAccess } from "@/lib/drivers/access";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string }> };

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

export async function PATCH(request: Request, { params }: RouteContext) {
  const access = await getDriverAdminAccess();
  if (!access.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!access.authorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const current = await prisma.driver.findUnique({
    where: { id },
    select: { id: true, name: true, licenseNumber: true, status: true },
  });
  if (!current) {
    return NextResponse.json({ error: "Driver not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  const requestedFields = ["name", "licenseNumber", "status"].filter(
    (field) => field in input,
  );
  if (requestedFields.length === 0) {
    return NextResponse.json({ error: "No driver changes were provided." }, { status: 400 });
  }

  const data: Prisma.DriverUpdateInput = {};
  const changedFields: string[] = [];

  if ("name" in input) {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "Enter the driver's name." }, { status: 400 });
    }
    if (name.length > 200) {
      return NextResponse.json(
        { error: "Driver name must be 200 characters or fewer." },
        { status: 400 },
      );
    }
    if (name !== current.name) {
      data.name = name;
      changedFields.push("name");
    }
  }

  if ("licenseNumber" in input) {
    const licenseNumber =
      typeof input.licenseNumber === "string" ? input.licenseNumber.trim() : "";
    if (!licenseNumber) {
      return NextResponse.json(
        { error: "Enter the driver's license number." },
        { status: 400 },
      );
    }
    if (licenseNumber.length > 100) {
      return NextResponse.json(
        { error: "License number must be 100 characters or fewer." },
        { status: 400 },
      );
    }
    if (licenseNumber !== current.licenseNumber) {
      const duplicate = await prisma.driver.findUnique({
        where: { licenseNumber },
        select: { id: true },
      });
      if (duplicate) return duplicateLicenseResponse();

      data.licenseNumber = licenseNumber;
      changedFields.push("licenseNumber");
    }
  }

  if ("status" in input) {
    const status = parseStatus(input.status);
    if (!status) {
      return NextResponse.json({ error: "Select a valid driver status." }, { status: 400 });
    }
    if (status !== current.status) {
      data.status = status;
      changedFields.push("status");
    }
  }

  if (changedFields.length === 0) {
    return NextResponse.json({ driver: current });
  }

  try {
    const driver = await prisma.driver.update({
      where: { id },
      data,
      select: { id: true, name: true, licenseNumber: true, status: true },
    });

    const profileFields = changedFields.filter((field) => field !== "status");
    if (profileFields.length > 0) {
      await logActivity({
        action: "driver_updated",
        entityType: "driver",
        entityId: driver.id,
        userEmail: access.email,
        metadata: { changedFields: profileFields },
      });
    }
    if (changedFields.includes("status")) {
      await logActivity({
        action: driver.status === DriverStatus.ACTIVE ? "driver_activated" : "driver_deactivated",
        entityType: "driver",
        entityId: driver.id,
        userEmail: access.email,
      });
    }

    revalidatePath("/drivers");
    revalidatePath(`/drivers/${driver.id}`);
    revalidatePath(`/drivers/${driver.id}/edit`);
    revalidatePath("/drivers/overview");
    revalidatePath("/commissions");
    revalidatePath("/payments");

    return NextResponse.json({ driver });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return duplicateLicenseResponse();
    }

    console.error("Driver update failed:", error);
    return NextResponse.json({ error: "Could not update the driver." }, { status: 500 });
  }
}
