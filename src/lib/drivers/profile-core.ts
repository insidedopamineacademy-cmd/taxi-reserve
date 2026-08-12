export type DriverVehicleTypeCode = "VAN" | "SEDAN";
export type DriverStatusCode = "ACTIVE" | "INACTIVE";

export type NormalizedDriverProfile = {
  name: string;
  licenseNumber: string;
  vehicleType: DriverVehicleTypeCode;
  status: DriverStatusCode;
  subscriptionExempt: boolean;
};

export type DriverProfileSnapshot = {
  id: string;
  name: string;
  licenseNumber: string;
  vehicleType: DriverVehicleTypeCode | null;
  status: DriverStatusCode;
  subscriptionExempt: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type DriverProfileRepository = {
  findByIdentity(input: {
    name: string;
    licenseNumber: string;
  }): Promise<DriverProfileSnapshot | null>;
  create(profile: NormalizedDriverProfile): Promise<DriverProfileSnapshot>;
};

export class DriverProfileInputError extends Error {
  constructor(message: string, readonly field?: string) {
    super(message);
    this.name = "DriverProfileInputError";
  }
}

export function normalizeDriverName(value: unknown) {
  if (typeof value !== "string") throw new DriverProfileInputError("Enter the driver's name.", "name");
  const compact = value.trim().replace(/\s+/g, " ");
  if (!compact) throw new DriverProfileInputError("Enter the driver's name.", "name");
  if (compact.length > 200) {
    throw new DriverProfileInputError("Driver name must be 200 characters or fewer.", "name");
  }
  return compact
    .split(" ")
    .map((word) => /^[A-ZÁÉÍÓÚÜÑ]{2,}$/.test(word)
      ? `${word[0]}${word.slice(1).toLocaleLowerCase("en")}`
      : word)
    .join(" ");
}

export function normalizeDriverLicenseNumber(value: unknown) {
  if (typeof value !== "string") {
    throw new DriverProfileInputError("Enter the driver's license number.", "licenseNumber");
  }
  const compact = value.trim().replace(/\s+/g, " ").toUpperCase();
  if (!compact) {
    throw new DriverProfileInputError("Enter the driver's license number.", "licenseNumber");
  }
  if (compact.length > 100) {
    throw new DriverProfileInputError(
      "License number must be 100 characters or fewer.",
      "licenseNumber",
    );
  }
  return compact;
}

export function normalizeDriverVehicleType(value: unknown): DriverVehicleTypeCode {
  if (value !== "VAN" && value !== "SEDAN") {
    throw new DriverProfileInputError("Select a valid vehicle type.", "vehicleType");
  }
  return value;
}

export function normalizeDriverStatus(value: unknown): DriverStatusCode {
  if (value !== "ACTIVE" && value !== "INACTIVE") {
    throw new DriverProfileInputError("Select a valid driver status.", "status");
  }
  return value;
}

export function normalizeDriverProfileInput(input: Record<string, unknown>): NormalizedDriverProfile {
  if (input.subscriptionExempt !== undefined && typeof input.subscriptionExempt !== "boolean") {
    throw new DriverProfileInputError(
      "Subscription exemption must be enabled or disabled.",
      "subscriptionExempt",
    );
  }
  return {
    name: normalizeDriverName(input.name),
    licenseNumber: normalizeDriverLicenseNumber(input.licenseNumber),
    vehicleType: normalizeDriverVehicleType(input.vehicleType),
    status: normalizeDriverStatus(input.status ?? "ACTIVE"),
    subscriptionExempt: input.subscriptionExempt === true,
  };
}

export async function createDriverProfile(
  profile: NormalizedDriverProfile,
  repository: DriverProfileRepository,
) {
  const duplicate = await repository.findByIdentity({
    name: profile.name,
    licenseNumber: profile.licenseNumber,
  });
  if (duplicate) {
    throw new DriverProfileInputError(
      "A driver with this name and license number already exists.",
      "licenseNumber",
    );
  }
  return repository.create(profile);
}
