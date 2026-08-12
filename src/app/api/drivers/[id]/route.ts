import { DriverStatus, DriverVehicleType, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activityLog";
import { getDriverAdminAccess } from "@/lib/drivers/access";
import {
  DriverProfileInputError,
  normalizeDriverLicenseNumber,
  normalizeDriverName,
} from "@/lib/drivers/profile-core";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string }> };

function parseStatus(value: unknown) {
  if (value === DriverStatus.ACTIVE || value === DriverStatus.INACTIVE) return value;
  return null;
}

function parseVehicleType(value: unknown) {
  if (value === DriverVehicleType.VAN || value === DriverVehicleType.SEDAN) {
    return value;
  }
  return null;
}

function duplicateDriverResponse() {
  return NextResponse.json(
    { error: "A driver with this name and license number already exists." },
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
    select: {
      id: true,
      name: true,
      licenseNumber: true,
      vehicleType: true,
      subscriptionExempt: true,
      status: true,
    },
  });
  if (!current) {
    return NextResponse.json({ error: "Driver not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  const requestedFields = [
    "name",
    "licenseNumber",
    "vehicleType",
    "subscriptionExempt",
    "status",
  ].filter(
    (field) => field in input,
  );
  if (requestedFields.length === 0) {
    return NextResponse.json({ error: "No driver changes were provided." }, { status: 400 });
  }

  const data: Prisma.DriverUpdateInput = {};
  const changedFields: string[] = [];
  let nextName = current.name;
  let nextLicenseNumber = current.licenseNumber;

  if ("name" in input) {
    try {
      nextName = normalizeDriverName(input.name);
    } catch (error) {
      if (error instanceof DriverProfileInputError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }
    if (nextName !== current.name) {
      data.name = nextName;
      changedFields.push("name");
    }
  }

  if ("licenseNumber" in input) {
    try {
      nextLicenseNumber = normalizeDriverLicenseNumber(input.licenseNumber);
    } catch (error) {
      if (error instanceof DriverProfileInputError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }
    if (nextLicenseNumber !== current.licenseNumber) {
      data.licenseNumber = nextLicenseNumber;
      changedFields.push("licenseNumber");
    }
  }

  if (changedFields.includes("name") || changedFields.includes("licenseNumber")) {
    const duplicate = await prisma.driver.findFirst({
      where: {
        id: { not: current.id },
        name: { equals: nextName, mode: "insensitive" },
        licenseNumber: { equals: nextLicenseNumber, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (duplicate) return duplicateDriverResponse();
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

  if ("vehicleType" in input) {
    const vehicleType = parseVehicleType(input.vehicleType);
    if (!vehicleType) {
      return NextResponse.json(
        { error: "Select a valid vehicle type." },
        { status: 400 },
      );
    }
    if (vehicleType !== current.vehicleType) {
      data.vehicleType = vehicleType;
      changedFields.push("vehicleType");
    }
  }

  if ("subscriptionExempt" in input) {
    if (typeof input.subscriptionExempt !== "boolean") {
      return NextResponse.json(
        { error: "Subscription exemption must be enabled or disabled." },
        { status: 400 },
      );
    }
    if (input.subscriptionExempt !== current.subscriptionExempt) {
      data.subscriptionExempt = input.subscriptionExempt;
      changedFields.push("subscriptionExempt");
    }
  }

  if (changedFields.length === 0) {
    return NextResponse.json({ driver: current });
  }

  try {
    const driver = await prisma.driver.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        licenseNumber: true,
        vehicleType: true,
        subscriptionExempt: true,
        status: true,
      },
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
    console.error("Driver update failed:", error);
    return NextResponse.json({ error: "Could not update the driver." }, { status: 500 });
  }
}
