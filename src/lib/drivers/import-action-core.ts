import type { JsonObject } from "../assistant/actions/contracts.ts";
import {
  MAX_DRIVER_IMPORT_ROWS,
  normalizeDriverIdentity,
  type ExistingDriverImportSnapshot,
} from "./import-core.ts";
import type {
  DriverProfileSnapshot,
  DriverVehicleTypeCode,
  NormalizedDriverProfile,
} from "./profile-core.ts";

export type DriverImportCreateAction = {
  name: string;
  licenseNumber: string;
  vehicleType: DriverVehicleTypeCode;
};

export type DriverImportUpdateAction = {
  driverId: string;
  vehicleType: DriverVehicleTypeCode;
};

export type DriverImportActionPayload = {
  draftId: string;
  draftRevision: number;
  creates: DriverImportCreateAction[];
  updates: DriverImportUpdateAction[];
  duplicatesSkipped: number;
  noOpCount: number;
};

export type DriverImportActionPrecondition = {
  ownerUserId: string;
  ownerEmail: string;
  preparedAt: string;
  existing: ExistingDriverImportSnapshot[];
  newDrivers: Array<{ name: string; licenseNumber: string }>;
};

export type DriverImportMutationRepository = {
  findCandidates(input: {
    licenseNumbers: string[];
    names: string[];
  }): Promise<ExistingDriverImportSnapshot[]>;
  create(profile: NormalizedDriverProfile): Promise<DriverProfileSnapshot>;
  updateVehicleType(input: {
    current: ExistingDriverImportSnapshot;
    vehicleType: DriverVehicleTypeCode;
  }): Promise<DriverProfileSnapshot | null>;
  createActivity(input: {
    action: "driver_created" | "driver_updated";
    driverId: string;
    userEmail: string;
    metadata: JsonObject;
  }): Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}

function text(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function vehicleType(value: unknown): value is DriverVehicleTypeCode {
  return value === "VAN" || value === "SEDAN";
}

function parseCreate(value: unknown): DriverImportCreateAction {
  if (!isRecord(value) || !exactKeys(value, ["name", "licenseNumber", "vehicleType"]) ||
    !text(value.name, 200) || !text(value.licenseNumber, 100) || !vehicleType(value.vehicleType)) {
    throw new Error("Stored driver import create row is invalid.");
  }
  return { name: value.name, licenseNumber: value.licenseNumber, vehicleType: value.vehicleType };
}

function parseUpdate(value: unknown): DriverImportUpdateAction {
  if (!isRecord(value) || !exactKeys(value, ["driverId", "vehicleType"]) ||
    !text(value.driverId, 200) || !vehicleType(value.vehicleType)) {
    throw new Error("Stored driver import update row is invalid.");
  }
  return { driverId: value.driverId, vehicleType: value.vehicleType };
}

function parseExisting(value: unknown): ExistingDriverImportSnapshot {
  if (!isRecord(value) || !exactKeys(value, [
    "id", "name", "licenseNumber", "vehicleType", "status", "subscriptionExempt", "updatedAt",
  ])) throw new Error("Stored existing driver precondition is invalid.");
  const updatedAt = typeof value.updatedAt === "string" ? new Date(value.updatedAt) : null;
  if (
    !text(value.id, 200) || !text(value.name, 200) || !text(value.licenseNumber, 100) ||
    (value.vehicleType !== null && !vehicleType(value.vehicleType)) ||
    (value.status !== "ACTIVE" && value.status !== "INACTIVE") ||
    typeof value.subscriptionExempt !== "boolean" ||
    !updatedAt || !Number.isFinite(updatedAt.getTime()) || updatedAt.toISOString() !== value.updatedAt
  ) throw new Error("Stored existing driver precondition is invalid.");
  return {
    id: value.id,
    name: value.name,
    licenseNumber: value.licenseNumber,
    vehicleType: value.vehicleType,
    status: value.status,
    subscriptionExempt: value.subscriptionExempt,
    updatedAt,
  };
}

export function serializeDriverImportActionPayload(
  payload: DriverImportActionPayload,
): JsonObject {
  return payload;
}

export function serializeDriverImportActionPrecondition(
  precondition: DriverImportActionPrecondition,
): JsonObject {
  return {
    ...precondition,
    existing: precondition.existing.map((driver) => ({
      ...driver,
      updatedAt: driver.updatedAt.toISOString(),
    })),
  };
}

export function parseStoredDriverImportAction(
  payloadValue: JsonObject,
  preconditionValue: JsonObject,
) {
  if (!exactKeys(payloadValue, [
    "draftId", "draftRevision", "creates", "updates", "duplicatesSkipped", "noOpCount",
  ]) ||
    !text(payloadValue.draftId, 200) ||
    !Number.isInteger(payloadValue.draftRevision) || (payloadValue.draftRevision as number) < 1 ||
    !Array.isArray(payloadValue.creates) || payloadValue.creates.length > MAX_DRIVER_IMPORT_ROWS ||
    !Array.isArray(payloadValue.updates) || payloadValue.updates.length > MAX_DRIVER_IMPORT_ROWS ||
    !Number.isInteger(payloadValue.duplicatesSkipped) || (payloadValue.duplicatesSkipped as number) < 0 ||
    !Number.isInteger(payloadValue.noOpCount) || (payloadValue.noOpCount as number) < 0
  ) throw new Error("Stored driver import payload is invalid.");
  if (
    payloadValue.creates.length + payloadValue.updates.length +
      (payloadValue.noOpCount as number) > MAX_DRIVER_IMPORT_ROWS
  ) throw new Error("Stored driver import payload is invalid.");
  if (!exactKeys(preconditionValue, [
    "ownerUserId", "ownerEmail", "preparedAt", "existing", "newDrivers",
  ]) ||
    !text(preconditionValue.ownerUserId, 200) ||
    !text(preconditionValue.ownerEmail, 320) ||
    !text(preconditionValue.preparedAt, 40) ||
    !Array.isArray(preconditionValue.existing) || preconditionValue.existing.length > MAX_DRIVER_IMPORT_ROWS ||
    !Array.isArray(preconditionValue.newDrivers) || preconditionValue.newDrivers.length > MAX_DRIVER_IMPORT_ROWS
  ) throw new Error("Stored driver import precondition is invalid.");
  if (
    preconditionValue.existing.length + preconditionValue.newDrivers.length >
      MAX_DRIVER_IMPORT_ROWS
  ) throw new Error("Stored driver import precondition is invalid.");
  const preparedAt = new Date(preconditionValue.preparedAt as string);
  if (!Number.isFinite(preparedAt.getTime()) || preparedAt.toISOString() !== preconditionValue.preparedAt) {
    throw new Error("Stored driver import precondition is invalid.");
  }
  const newDrivers = preconditionValue.newDrivers.map((value) => {
    if (!isRecord(value) || !exactKeys(value, ["name", "licenseNumber"]) ||
      !text(value.name, 200) || !text(value.licenseNumber, 100)) {
      throw new Error("Stored new driver precondition is invalid.");
    }
    return { name: value.name, licenseNumber: value.licenseNumber };
  });
  const payload: DriverImportActionPayload = {
    draftId: payloadValue.draftId as string,
    draftRevision: payloadValue.draftRevision as number,
    creates: payloadValue.creates.map(parseCreate),
    updates: payloadValue.updates.map(parseUpdate),
    duplicatesSkipped: payloadValue.duplicatesSkipped as number,
    noOpCount: payloadValue.noOpCount as number,
  };
  const precondition: DriverImportActionPrecondition = {
    ownerUserId: preconditionValue.ownerUserId as string,
    ownerEmail: (preconditionValue.ownerEmail as string).trim().toLowerCase(),
    preparedAt: preconditionValue.preparedAt as string,
    existing: preconditionValue.existing.map(parseExisting),
    newDrivers,
  };
  return { payload, precondition };
}

export function existingDriverMatches(
  current: ExistingDriverImportSnapshot,
  expected: ExistingDriverImportSnapshot,
) {
  return current.id === expected.id &&
    current.name === expected.name &&
    current.licenseNumber === expected.licenseNumber &&
    current.vehicleType === expected.vehicleType &&
    current.status === expected.status &&
    current.subscriptionExempt === expected.subscriptionExempt &&
    current.updatedAt.getTime() === expected.updatedAt.getTime();
}

export function hasIdentityCollision(
  candidates: ExistingDriverImportSnapshot[],
  driver: { name: string; licenseNumber: string },
) {
  return candidates.some((candidate) =>
    normalizeDriverIdentity(candidate.name) === normalizeDriverIdentity(driver.name) &&
    candidate.licenseNumber.toUpperCase() === driver.licenseNumber.toUpperCase(),
  );
}
