import {
  createDriverProfile,
  normalizeDriverProfileInput,
  type DriverProfileRepository,
  type DriverProfileSnapshot,
  type DriverVehicleTypeCode,
  type NormalizedDriverProfile,
} from "../src/lib/drivers/profile-core.ts";

export const DUPLICATE_SOURCE_ROWS_REMOVED = 36;

const candidateInputs = [
  ["Tamoor Gondal", "0420MVW", "VAN"],
  ["Muneeb", "VTC", "VAN"],
  ["Sameer Khan", "10445", "VAN"],
  ["Hamid", "VTC", "VAN"],
  ["Farrakh Sahi", "3071", "VAN"],
  ["Raja Hadeed", "5063", "VAN"],
  ["Karan", "3381", "SEDAN"],
  ["Raja Adnan", "8717", "VAN"],
  ["Inder", "3135", "SEDAN"],
  ["Raja Talha", "1831", "VAN"],
  ["Qaisar Cheema", "8268", "VAN"],
  ["Sukh Sidhu", "8268", "VAN"],
  ["Joshua Decano", "10427", "VAN"],
  ["Eathsham Saadat", "4579", "VAN"],
  ["Noman Saadat", "4579", "VAN"],
  ["Muhammad Ibrahim", "4491", "VAN"],
  ["Ehsam", "5181", "VAN"],
  ["Basheer Ahmed", "5181", "VAN"],
  ["Jabran", "VTC", "VAN"],
  ["Ali Baqer", "5986", "VAN"],
  ["Mohsin Malik", "5986", "VAN"],
  ["Awais Muhammad", "VTC", "VAN"],
  ["Ali Tanveer", "1073", "VAN"],
  ["Moiz", "1073", "VAN"],
  ["Junaid Gondal", "10278", "VAN"],
  ["Sohail Gondal", "10278", "VAN"],
  ["Soban Ali Khalil", "263", "VAN"],
  ["Aneeq Irtaza", "263", "VAN"],
  ["Nomy", "749", "VAN"],
  ["Zohaib", "VTC", "SEDAN"],
  ["Ahmed", "VTC", "SEDAN"],
  ["Abdullah Hassan", "616", "VAN"],
  ["Muhammad Umer", "9175", "VAN"],
  ["Mohsan Ghakhr", "9175", "VAN"],
  ["Ali Tehreem", "5901", "VAN"],
  ["Ali Haider", "1675", "SEDAN"],
  ["Muhammad Zain", "1675", "SEDAN"],
  ["Salah", "6280", "VAN"],
  ["Hamza", "6280", "VAN"],
  ["Mehboob Shahbaz", "5276", "SEDAN"],
  ["Abdullah Azhar", "752", "SEDAN"],
  ["Ali Haider", "4916", "VAN"],
  ["Ali Khan", "4916", "VAN"],
  ["Zafar Mehdi", "255", "VAN"],
  ["Sheroon Akram", "255", "VAN"],
  ["Imran Khan", "9288", "VAN"],
  ["Ali Arslan", "3935", "SEDAN"],
  ["Usman Ali", "4512", "SEDAN"],
] as const satisfies ReadonlyArray<readonly [string, string, DriverVehicleTypeCode]>;

export const ONE_TIME_DRIVER_CANDIDATES: readonly NormalizedDriverProfile[] =
  candidateInputs.map(([name, licenseNumber, vehicleType]) => normalizeDriverProfileInput({
    name,
    licenseNumber,
    vehicleType,
    status: "ACTIVE",
    subscriptionExempt: false,
  }));

export type OneTimeDriverReviewRow = {
  names: readonly string[];
  licenseNumber: string;
  vehicleType: DriverVehicleTypeCode;
  reason: string;
};

export const ONE_TIME_DRIVER_REVIEW_ROWS: readonly OneTimeDriverReviewRow[] = [];

export type OneTimeExistingDriver = Pick<
  DriverProfileSnapshot,
  "id" | "name" | "licenseNumber" | "vehicleType" | "status" | "subscriptionExempt" | "createdAt" | "updatedAt"
>;

export type OneTimeDriverPlanItem = {
  status: "CREATE" | "SKIP_EXISTING" | "NEEDS_REVIEW" | "CONFLICT";
  profile: NormalizedDriverProfile;
  reason: string;
  existingId?: string;
};

export const ONE_TIME_DRIVER_IMPORT_TRANSACTION_OPTIONS = {
  maxWait: 10_000,
  timeout: 60_000,
} as const;

export type OneTimeDriverImportApplyResult = {
  createdCount: number;
  skippedCount: number;
};

type OneTimeDriverImportTransactionOptions = {
  maxWait: number;
  timeout: number;
};

export async function executeOneTimeDriverImportTransaction<TTransaction>(input: {
  actorEmail: string;
  runInTransaction: (
    work: (transaction: TTransaction) => Promise<OneTimeDriverImportApplyResult>,
    options: OneTimeDriverImportTransactionOptions,
  ) => Promise<OneTimeDriverImportApplyResult>;
  findExisting: (transaction: TTransaction) => Promise<readonly OneTimeExistingDriver[]>;
  createRepository: (transaction: TTransaction) => DriverProfileRepository;
  createActivity: (
    transaction: TTransaction,
    driver: DriverProfileSnapshot,
    actorEmail: string,
  ) => Promise<void>;
}) {
  return input.runInTransaction(async (transaction) => {
    const current = await input.findExisting(transaction);
    const currentPlan = buildOneTimeDriverImportPlan(current);
    if (currentPlan.items.some(
      (item) => item.status === "CONFLICT" || item.status === "NEEDS_REVIEW",
    )) {
      throw new Error("Database identity conflicts changed the plan; run and review --dry-run again.");
    }

    const repository = input.createRepository(transaction);
    let createdCount = 0;
    for (const item of currentPlan.items) {
      if (item.status !== "CREATE") continue;
      const driver = await createDriverProfile(item.profile, repository);
      await input.createActivity(transaction, driver, input.actorEmail);
      createdCount += 1;
    }

    return { createdCount, skippedCount: currentPlan.counts.skipExisting };
  }, ONE_TIME_DRIVER_IMPORT_TRANSACTION_OPTIONS);
}

function normalizedName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

function normalizedCode(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

export function buildOneTimeDriverImportPlan(
  existingDrivers: readonly OneTimeExistingDriver[],
) {
  const items: OneTimeDriverPlanItem[] = ONE_TIME_DRIVER_CANDIDATES.map((profile) => {
    const nameMatches = existingDrivers.filter(
      (driver) => normalizedName(driver.name) === normalizedName(profile.name),
    );
    const exactMatches = nameMatches.filter(
      (driver) => normalizedCode(driver.licenseNumber) === normalizedCode(profile.licenseNumber),
    );
    if (exactMatches.length > 1) {
      return {
        status: "CONFLICT",
        profile,
        reason: "More than one existing Driver has this same normalized name and code.",
      };
    }
    if (exactMatches.length === 1) {
      const existing = exactMatches[0];
      if (existing.vehicleType !== profile.vehicleType) {
        return {
          status: "CONFLICT",
          profile,
          existingId: existing.id,
          reason: `Existing vehicle type is ${existing.vehicleType ?? "unset"}; planned type is ${profile.vehicleType}.`,
        };
      }
      return {
        status: "SKIP_EXISTING",
        profile,
        existingId: existing.id,
        reason: "Same normalized name and code already exist; no overwrite.",
      };
    }
    return {
      status: "CREATE",
      profile,
      reason: "No existing Driver has this normalized name and code.",
    };
  });

  return {
    items,
    reviewRows: ONE_TIME_DRIVER_REVIEW_ROWS,
    counts: {
      create: items.filter((item) => item.status === "CREATE").length,
      skipExisting: items.filter((item) => item.status === "SKIP_EXISTING").length,
      needsReview: items.filter((item) => item.status === "NEEDS_REVIEW").length + ONE_TIME_DRIVER_REVIEW_ROWS.length,
      conflict: items.filter((item) => item.status === "CONFLICT").length,
      duplicateSourceRowsRemoved: DUPLICATE_SOURCE_ROWS_REMOVED,
    },
  };
}
