import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createDriverProfile,
  DriverProfileInputError,
  normalizeDriverProfileInput,
  type DriverProfileRepository,
  type DriverProfileSnapshot,
} from "../src/lib/drivers/profile-core.ts";
import { analyzeDriverImportRows, extractDriverImportRows } from "../src/lib/drivers/import-core.ts";
import { hasIdentityCollision } from "../src/lib/drivers/import-action-core.ts";
import {
  buildOneTimeDriverImportPlan,
  DUPLICATE_SOURCE_ROWS_REMOVED,
  executeOneTimeDriverImportTransaction,
  ONE_TIME_DRIVER_CANDIDATES,
  ONE_TIME_DRIVER_IMPORT_TRANSACTION_OPTIONS,
  ONE_TIME_DRIVER_REVIEW_ROWS,
} from "./import-drivers-one-time-core.mts";

const now = new Date("2026-08-12T12:00:00.000Z");

class MemoryProfileRepository implements DriverProfileRepository {
  rows: DriverProfileSnapshot[] = [];

  async findByIdentity(input: { name: string; licenseNumber: string }) {
    return this.rows.find((row) =>
      row.name.toLowerCase() === input.name.toLowerCase() &&
      row.licenseNumber.toUpperCase() === input.licenseNumber.toUpperCase()
    ) ?? null;
  }

  async create(profile: ReturnType<typeof normalizeDriverProfileInput>) {
    const row: DriverProfileSnapshot = {
      id: `driver-${this.rows.length + 1}`,
      ...profile,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(structuredClone(row));
    return structuredClone(row);
  }
}

type StoredDriver = DriverProfileSnapshot & { transactionId: string };
type StoredActivity = { driverId: string; actorEmail: string; transactionId: string };
type MemoryTransaction = {
  id: string;
  drivers: StoredDriver[];
  activities: StoredActivity[];
  elapsedMs: number;
  nextDriverId: number;
  createdCount: number;
  timeout: number;
};

const existingMuneeb: StoredDriver = {
  id: "existing-muneeb",
  name: "Muneeb",
  licenseNumber: "VTC",
  vehicleType: "VAN",
  status: "ACTIVE",
  subscriptionExempt: false,
  createdAt: now,
  updatedAt: now,
  transactionId: "seed",
};

class MemoryTransactionalDatabase {
  drivers: StoredDriver[] = [{ ...existingMuneeb }];
  activities: StoredActivity[] = [];
  attemptedDriverCreates = 0;
  failActivityAfterDriverCreates: number | null = null;
  lastElapsedMs = 0;
  lastOptions: { maxWait: number; timeout: number } | null = null;
  private transactionSequence = 0;

  private spend(transaction: MemoryTransaction, milliseconds = 50) {
    transaction.elapsedMs += milliseconds;
    this.lastElapsedMs = transaction.elapsedMs;
    if (transaction.elapsedMs > transaction.timeout) {
      throw new Error(`P2028: simulated transaction timeout after ${transaction.timeout} ms`);
    }
  }

  async runInTransaction(
    work: (transaction: MemoryTransaction) => Promise<{ createdCount: number; skippedCount: number }>,
    options: { maxWait: number; timeout: number },
  ) {
    this.lastOptions = { ...options };
    const transaction: MemoryTransaction = {
      id: `transaction-${++this.transactionSequence}`,
      drivers: this.drivers.map((driver) => ({ ...driver })),
      activities: this.activities.map((activity) => ({ ...activity })),
      elapsedMs: 0,
      nextDriverId: this.drivers.length + 1,
      createdCount: 0,
      timeout: options.timeout,
    };

    try {
      const result = await work(transaction);
      this.drivers = transaction.drivers;
      this.activities = transaction.activities;
      return result;
    } catch (error) {
      throw error;
    }
  }

  async findExisting(transaction: MemoryTransaction) {
    this.spend(transaction);
    return transaction.drivers;
  }

  createRepository(transaction: MemoryTransaction): DriverProfileRepository {
    return {
      findByIdentity: async (input) => {
        this.spend(transaction);
        return transaction.drivers.find((driver) =>
          driver.name.toLowerCase() === input.name.toLowerCase() &&
          driver.licenseNumber.toUpperCase() === input.licenseNumber.toUpperCase()
        ) ?? null;
      },
      create: async (profile) => {
        this.spend(transaction);
        this.attemptedDriverCreates += 1;
        transaction.createdCount += 1;
        const driver: StoredDriver = {
          id: `driver-${transaction.nextDriverId++}`,
          ...profile,
          createdAt: now,
          updatedAt: now,
          transactionId: transaction.id,
        };
        transaction.drivers.push(driver);
        return driver;
      },
    };
  }

  async createActivity(
    transaction: MemoryTransaction,
    driver: DriverProfileSnapshot,
    actorEmail: string,
  ) {
    this.spend(transaction);
    if (
      this.failActivityAfterDriverCreates !== null &&
      transaction.createdCount === this.failActivityAfterDriverCreates
    ) {
      throw new Error("Simulated ActivityLog failure");
    }
    transaction.activities.push({
      driverId: driver.id,
      actorEmail,
      transactionId: transaction.id,
    });
  }
}

function executeMemoryImport(database: MemoryTransactionalDatabase) {
  return executeOneTimeDriverImportTransaction({
    actorEmail: "admin@example.com",
    runInTransaction: (work, options) => database.runInTransaction(work, options),
    findExisting: (transaction) => database.findExisting(transaction),
    createRepository: (transaction) => database.createRepository(transaction),
    createActivity: (transaction, driver, actorEmail) =>
      database.createActivity(transaction, driver, actorEmail),
  });
}

test("one-time plan preserves shared 10278/4579 codes and VTC identities without deriving vehicle type from VTC", () => {
  const plan = buildOneTimeDriverImportPlan([]);
  assert.equal(plan.counts.create, 48);
  assert.equal(plan.counts.skipExisting, 0);
  assert.equal(plan.counts.needsReview, 0);
  assert.equal(plan.counts.conflict, 0);
  assert.equal(plan.counts.duplicateSourceRowsRemoved, 36);
  assert.equal(DUPLICATE_SOURCE_ROWS_REMOVED, 36);
  assert.equal(ONE_TIME_DRIVER_REVIEW_ROWS.length, 0);

  assert.deepEqual(
    ONE_TIME_DRIVER_CANDIDATES.filter((driver) => driver.licenseNumber === "10278").map((driver) => driver.name),
    ["Junaid Gondal", "Sohail Gondal"],
  );
  assert.deepEqual(
    ONE_TIME_DRIVER_CANDIDATES.filter((driver) => driver.licenseNumber === "4579").map((driver) => driver.name),
    ["Eathsham Saadat", "Noman Saadat"],
  );
  const vtc = ONE_TIME_DRIVER_CANDIDATES.filter((driver) => driver.licenseNumber === "VTC");
  assert.deepEqual(vtc.map((driver) => driver.name), ["Muneeb", "Hamid", "Jabran", "Awais Muhammad", "Zohaib", "Ahmed"]);
  assert.deepEqual(vtc.map((driver) => driver.vehicleType), ["VAN", "VAN", "VAN", "VAN", "SEDAN", "SEDAN"]);
  assert.deepEqual(
    ONE_TIME_DRIVER_CANDIDATES.filter((driver) => driver.name === "Ali Haider").map((driver) => [driver.licenseNumber, driver.vehicleType]),
    [["1675", "SEDAN"], ["4916", "VAN"]],
  );
});

test("authoritative profile creation allows a shared code for different names and rejects only exact logical identity", async () => {
  const repository = new MemoryProfileRepository();
  const junaid = normalizeDriverProfileInput({ name: "Junaid Gondal", licenseNumber: "10278", vehicleType: "VAN" });
  const sohail = normalizeDriverProfileInput({ name: "Sohail Gondal", licenseNumber: "10278", vehicleType: "VAN" });
  await createDriverProfile(junaid, repository);
  await createDriverProfile(sohail, repository);
  assert.equal(repository.rows.length, 2);
  assert.notEqual(repository.rows[0].id, repository.rows[1].id);
  await assert.rejects(
    () => createDriverProfile(junaid, repository),
    (error: unknown) => error instanceof DriverProfileInputError && /name and license number/.test(error.message),
  );
});

test("assistant import analysis treats both same-code/different-name and same-name/different-code as valid", () => {
  const extracted = extractDriverImportRows({
    text: [
      "Junaid Gondal 10278 Mercedes V Class",
      "Sohail Gondal 10278 Mercedes V Class",
      "Junaid Gondal 7777 Mercedes V Class",
    ].join("\n"),
    createRowId: (index) => `row-${index}`,
  });
  const rows = analyzeDriverImportRows(extracted.rows, []);
  assert.deepEqual(rows.map((row) => row.state), ["NEW", "NEW", "NEW"]);
  assert.equal(rows.every((row) => row.issues.length === 0), true);
  const existing = [{
    id: "existing",
    name: "Ali Haider",
    licenseNumber: "1675",
    vehicleType: "SEDAN" as const,
    status: "ACTIVE" as const,
    subscriptionExempt: false,
    updatedAt: now,
  }];
  assert.equal(hasIdentityCollision(existing, { name: "Ali Haider", licenseNumber: "1675" }), true);
  assert.equal(hasIdentityCollision(existing, { name: "Ali Haider", licenseNumber: "4916" }), false);
  assert.equal(hasIdentityCollision(existing, { name: "Muhammad Zain", licenseNumber: "1675" }), false);
});

test("dry-run planning skips exact existing identity and allows shared codes and shared names", () => {
  const existing = [{
    id: "existing-junaid",
    name: "Junaid Gondal",
    licenseNumber: "10278",
    vehicleType: "VAN" as const,
    status: "ACTIVE" as const,
    subscriptionExempt: false,
    createdAt: now,
    updatedAt: now,
  }, {
    id: "existing-usman",
    name: "Usman Ali",
    licenseNumber: "DIFFERENT",
    vehicleType: "SEDAN" as const,
    status: "ACTIVE" as const,
    subscriptionExempt: false,
    createdAt: now,
    updatedAt: now,
  }];
  const plan = buildOneTimeDriverImportPlan(existing);
  assert.equal(plan.items.find((item) => item.profile.name === "Junaid Gondal")?.status, "SKIP_EXISTING");
  assert.equal(plan.items.find((item) => item.profile.name === "Sohail Gondal")?.status, "CREATE");
  assert.equal(plan.items.find((item) => item.profile.name === "Usman Ali")?.status, "CREATE");
});

test("bounded one-time transaction creates 47 Driver and ActivityLog pairs, then reruns idempotently", async () => {
  const database = new MemoryTransactionalDatabase();
  const existingBefore = { ...database.drivers[0] };

  const result = await executeMemoryImport(database);
  const firstRunElapsedMs = database.lastElapsedMs;

  assert.deepEqual(result, { createdCount: 47, skippedCount: 1 });
  assert.deepEqual(database.lastOptions, ONE_TIME_DRIVER_IMPORT_TRANSACTION_OPTIONS);
  assert.ok(firstRunElapsedMs > 5_000, "the sequential query workload must exceed Prisma's old default timeout");
  assert.ok(firstRunElapsedMs < ONE_TIME_DRIVER_IMPORT_TRANSACTION_OPTIONS.timeout);
  assert.equal(database.drivers.length, 48);
  assert.equal(database.activities.length, 47);
  assert.deepEqual(database.drivers.find((driver) => driver.id === existingMuneeb.id), existingBefore);

  const createdDrivers = database.drivers.filter((driver) => driver.transactionId !== "seed");
  assert.equal(createdDrivers.length, 47);
  assert.equal(createdDrivers.every((driver) => driver.transactionId === "transaction-1"), true);
  assert.equal(database.activities.every((activity) => activity.transactionId === "transaction-1"), true);
  assert.deepEqual(
    new Set(database.activities.map((activity) => activity.driverId)),
    new Set(createdDrivers.map((driver) => driver.id)),
  );

  const rerun = await executeMemoryImport(database);
  assert.deepEqual(rerun, { createdCount: 0, skippedCount: 48 });
  assert.equal(database.drivers.length, 48);
  assert.equal(database.activities.length, 47);
});

test("ActivityLog failure rolls back every Driver and ActivityLog in the one-time transaction", async () => {
  const database = new MemoryTransactionalDatabase();
  const existingBefore = { ...database.drivers[0] };
  database.failActivityAfterDriverCreates = 8;

  await assert.rejects(() => executeMemoryImport(database), /Simulated ActivityLog failure/);

  assert.equal(database.attemptedDriverCreates, 8);
  assert.deepEqual(database.drivers, [existingBefore]);
  assert.deepEqual(database.activities, []);
});

test("multi-name, night-driver, comma, plus, and secondary-name rows split and exact identities deduplicate", () => {
  const extracted = extractDriverImportRows({
    text: [
      "Qaisar Cheema 8268 Vito 047 & noche Sukh Sidhu conductor",
      "Ehsam y Basheer Ahmed 5181 V Class",
      "Ali Baqer 5986 VW Caravelle 048 de noche Mohsin Malik",
      "Ali Tanveer VW Caddy 1073 - Moiz",
      "SOBAN Ali Khalil,Aneeq Irtaza 263 Ford Turneo 048",
      "Zafar Mehdi +Sheroon Akram 255 Mercedes V",
      "Ali Haider & Muhammad Zain RAV4 1675",
      "Ali Haider + Ali Khan 4916 Vito",
      "Ali Haider & Muhammad Zain RAV4 1675",
    ].join("\n"),
    createRowId: (index) => `split-${index}`,
  });
  assert.equal(extracted.rows.length, 16);
  assert.equal(extracted.duplicateRowsSkipped, 1);
  assert.deepEqual(
    extracted.rows.map((row) => [row.name, row.licenseNumber, row.vehicleType]),
    [
      ["Qaisar Cheema", "8268", "VAN"], ["Sukh Sidhu", "8268", "VAN"],
      ["Ehsam", "5181", "VAN"], ["Basheer Ahmed", "5181", "VAN"],
      ["Ali Baqer", "5986", "VAN"], ["Mohsin Malik", "5986", "VAN"],
      ["Ali Tanveer", "1073", "VAN"], ["Moiz", "1073", "VAN"],
      ["Soban Ali Khalil", "263", "VAN"], ["Aneeq Irtaza", "263", "VAN"],
      ["Zafar Mehdi", "255", "VAN"], ["Sheroon Akram", "255", "VAN"],
      ["Ali Haider", "1675", "SEDAN"], ["Muhammad Zain", "1675", "SEDAN"],
      ["Ali Haider", "4916", "VAN"], ["Ali Khan", "4916", "VAN"],
    ],
  );
});

test("schema and relationship sources use Driver.id and the migration removes only license uniqueness", () => {
  const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../prisma/migrations/20260812180000_allow_shared_driver_license_numbers/migration.sql", import.meta.url), "utf8");
  const script = readFileSync(new URL("./import-drivers-one-time.mts", import.meta.url), "utf8");
  assert.doesNotMatch(schema, /licenseNumber\s+String\s+@unique/);
  assert.match(schema, /@@index\(\[licenseNumber\]\)/);
  assert.match(migration, /DROP INDEX "Driver_licenseNumber_key"/);
  assert.match(migration, /CREATE INDEX "Driver_licenseNumber_idx"/);
  for (const relation of ["Reservation", "CommissionEntry", "DriverPayment", "DriverSubscriptionCharge"]) {
    const block = schema.split(`model ${relation} {`)[1]?.split("\n}")[0] ?? "";
    assert.match(block, /driverId\s+String\??/);
    assert.match(block, /references: \[id\]/);
  }
  assert.doesNotMatch(script, /openai|responses\.create|createMany|\$executeRaw|\$queryRaw/i);
  assert.match(script, /flags\.includes\("--apply"\)/);
  assert.match(script, /ALLOW_ONE_TIME_DRIVER_IMPORT/);
});
