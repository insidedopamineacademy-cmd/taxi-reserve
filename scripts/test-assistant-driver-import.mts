import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  AI_WORKFLOW_DRAFT_MAX_JSON_BYTES,
  loadAiWorkflowDraft,
  saveAiWorkflowDraft,
  type AiWorkflowDraftRepository,
  type AiWorkflowDraftRow,
} from "../src/lib/assistant/workflow-drafts/core.ts";
import { createDurableReservationDraftStore } from "../src/lib/reservations/reservation-draft-store.ts";
import { extractReservationDraft } from "../src/lib/reservations/reservation-draft-core.ts";
import {
  classifyDriverVehicle,
  createDriverImportDraft,
  extractDriverImportRows,
  toPublicDriverImportDraft,
  updateDriverImportDraft,
  type DriverImportDraftRecord,
  type DriverImportExistingRepository,
  type ExistingDriverImportSnapshot,
} from "../src/lib/drivers/import-core.ts";
import {
  driverImportTools,
  parseParseDriverListTextArguments,
  parsePrepareDriverImportArguments,
  parseUpdateDriverImportDraftArguments,
} from "../src/lib/assistant/tools/driver-import-contracts.ts";
import { AssistantTransportError } from "../src/lib/assistant/errors.ts";
import {
  parseDriverListDraft,
  prepareDriverImportProposal,
  type DriverImportDraftOperationResult,
} from "../src/lib/drivers/assistant-import-core.ts";
import type { DriverImportDraftStore } from "../src/lib/drivers/import-store.ts";
import {
  serializeDriverImportActionPayload,
  serializeDriverImportActionPrecondition,
  type DriverImportActionPayload,
  type DriverImportActionPrecondition,
  type DriverImportMutationRepository,
} from "../src/lib/drivers/import-action-core.ts";
import { createDriverImportExecutor } from "../src/lib/assistant/actions/driver-import-executor.ts";
import {
  confirmAiPendingAction,
  type AiActionExecutorRegistry,
  type AiCanonicalActor,
  type AiPendingActionRecord,
  type AiPendingActionStore,
  type AiPendingActionUpdate,
} from "../src/lib/assistant/actions/core.ts";
import {
  assertJsonObject,
  parseAiActionPreview,
  type JsonObject,
} from "../src/lib/assistant/actions/contracts.ts";
import {
  runReservationAssistantToolLoop,
  type AssistantModelResult,
  type AssistantToolLoopDependencies,
} from "../src/lib/assistant/tool-loop.ts";
import { parseAssistantStreamEvent, type AssistantStreamEvent } from "../src/lib/assistant/stream-protocol.ts";

const now = new Date("2026-08-12T10:00:00.000Z");
const admin: AiCanonicalActor = {
  userId: "admin-1",
  email: "admin@example.com",
  role: "ADMIN",
};
const user = { ...admin, userId: "user-1", email: "user@example.com", role: "USER" as const };

const realRows = [
  "Tamoor Gondal VTC 0420MVW",
  "Muneeb VTC",
  "Sameer Khan 10445 CADDY",
  "Hamid VTC Mercedes Vito",
  "Farrakh Sahi 3071 Mercedes V",
  "Raja Hadeed 5063 ford 048",
  "Karan Camry 3381",
  "Raja Adnan 8717 Vito 047",
  "Inder Camry 3135",
  "Raja Talha 1831 Vito 047",
  "Qaisar Cheema 8268 Vito 047 & noche Sukh Sidhu conductor",
  "Joshua Decano 10427 Talento PMR 047",
  "Eathsham Saadat 4579 MTL Mercedes V Class",
  "Noman Saadat 4579 Mercedes V Class",
  "Muhammad Ibrahim 4491 Mercedes V Class",
  "Ehsam y Basheer Ahmed 5181 V Class",
  "Jabran Mercedes 048",
  "Ali Baqer 5986 VW Caravelle 048 de noche Mohsin Malik",
  "Awais Muhammad VTC",
  "Ali Tanveer VW Caddy 1073 - Moiz",
  "Junaid Gondal 10278 Mercedes V Class",
  "Sohail Gondal 10278 Mercedes V Class",
  "SOBAN Ali Khalil, Aneeq Irtaza 263 Ford Tourneo 048",
  "Nomy 749 Ford Custom 047",
  "Zohaib y Ahmed Lexus ES300 VTC",
  "Abdullah Hassan 616 Mercedes Vito",
  "Muhammad Umer y Mohsan Ghakhr 9175 Ford Tourneo",
  "Ali Tehreem 5901 Mercedes Vito 047 sin rampa",
  "Ali Haider & Muhammad Zain RAV4 1675",
  "Salah & Hamza Mercedes Vito 6280",
  "Mehboob Shahbaz 5276 Prius+",
  "ABDULLAH AZHAR 752 Prius+",
  "Ali Haider + Ali Khan 4916 Vito 8Px",
  "Zafar Mehdi + Sheroon Akram 255 Mercedes V",
  "Imran Khan llic 9288 Mercedes Vito PMR",
  "ALI ARSLAN 3935 PRIUS+",
  "Usman Ali 4512 Corolla",
];
const realList = realRows.join("\n");

function existing(input: Partial<ExistingDriverImportSnapshot> & Pick<ExistingDriverImportSnapshot, "id" | "name" | "licenseNumber">): ExistingDriverImportSnapshot {
  return {
    vehicleType: "VAN",
    status: "ACTIVE",
    subscriptionExempt: false,
    updatedAt: now,
    ...input,
  };
}

class ExistingRepository implements DriverImportExistingRepository {
  constructor(readonly rows: ExistingDriverImportSnapshot[] = []) {}
  async findCandidates(input: { licenseNumbers: string[]; names: string[] }) {
    const codes = new Set(input.licenseNumbers.map((value) => value.toUpperCase()));
    const names = new Set(input.names.map((value) => value.toLowerCase()));
    return structuredClone(this.rows.filter((row) =>
      codes.has(row.licenseNumber.toUpperCase()) || names.has(row.name.toLowerCase()),
    ));
  }
}

class MemoryWorkflowBackend {
  rows = new Map<string, AiWorkflowDraftRow>();
  nextId = 1;
}

function workflowRepository(backend: MemoryWorkflowBackend): AiWorkflowDraftRepository {
  const key = (userId: string, kind: string) => `${userId}:${kind}`;
  return {
    async findOwned(input) {
      return structuredClone(backend.rows.get(key(input.userId, input.kind)) ?? null);
    },
    async upsertOwned(input) {
      const existingRow = backend.rows.get(key(input.userId, input.kind));
      const row: AiWorkflowDraftRow = {
        id: existingRow?.id ?? `workflow-${backend.nextId++}`,
        userId: input.userId,
        kind: input.kind,
        payload: structuredClone(input.payload),
        expiresAt: new Date(input.expiresAt),
        createdAt: existingRow?.createdAt ?? new Date(now),
        updatedAt: new Date(now),
      };
      backend.rows.set(key(input.userId, input.kind), structuredClone(row));
      return structuredClone(row);
    },
    async deleteOwned(input) {
      backend.rows.delete(key(input.userId, input.kind));
    },
    async deleteExpired(at) {
      let count = 0;
      for (const [rowKey, row] of backend.rows) {
        if (row.expiresAt.getTime() <= at.getTime()) {
          backend.rows.delete(rowKey);
          count += 1;
        }
      }
      return count;
    },
  };
}

test("Phase 2F driver import tools are strict text/update/prepare contracts without identity or unsupported mutation fields", () => {
  assert.deepEqual(driverImportTools.map((tool) => tool.name), [
    "parse_driver_list_text",
    "update_driver_import_draft",
    "prepare_driver_import",
  ]);
  assert.equal(driverImportTools.every((tool) => tool.strict), true);
  const serialized = JSON.stringify(driverImportTools);
  for (const forbidden of ["userId", "owner", "role", "status", "subscriptionExempt", "payment", "commission", "image", "file", "OCR"]) {
    assert.equal(serialized.includes(`\"${forbidden}\"`), false);
  }
  assert.deepEqual(parseParseDriverListTextArguments(JSON.stringify({ driver_list_text: realList })), { driver_list_text: realList });
  assert.deepEqual(parsePrepareDriverImportArguments('{"draft_id":"d1","revision":2}'), { draft_id: "d1", revision: 2 });
  assert.deepEqual(parseUpdateDriverImportDraftArguments('{"rows":[],"confirm_complete":true}'), { rows: [], confirm_complete: true });
  assert.throws(
    () => parseParseDriverListTextArguments('{"driver_list_text":"A","role":"ADMIN"}'),
    (error: unknown) => error instanceof AssistantTransportError && error.code === "TOOL_VALIDATION_FAILED",
  );
});

test("durable workflow drafts survive a second store instance, isolate owners, expire, clean up, and reject malformed or oversized payloads", async () => {
  const backend = new MemoryWorkflowBackend();
  let clock = new Date(now);
  const firstStore = createDurableReservationDraftStore(workflowRepository(backend), { now: () => clock });
  const coldStartStore = createDurableReservationDraftStore(workflowRepository(backend), { now: () => clock });
  const reservationDraft = extractReservationDraft({
    id: "reservation-draft-1",
    ownerUserId: admin.userId,
    ownerEmail: admin.email,
    bookingText: "Pickup: A\nDrop-off: B\nWhen: 21/11/2026 09:50\nPassengers: 2",
    now,
  });
  await firstStore.save(reservationDraft);
  const loaded = await coldStartStore.load(admin);
  assert.equal(loaded.kind, "ACTIVE");
  assert.equal(loaded.kind === "ACTIVE" && loaded.draft.id, "reservation-draft-1");
  assert.equal(JSON.stringify([...backend.rows.values()]).includes("Pickup: A"), false);
  assert.deepEqual(await coldStartStore.load({ userId: admin.userId, email: "other@example.com" }), { kind: "MISSING" });
  assert.deepEqual(await coldStartStore.load({ userId: "other", email: admin.email }), { kind: "MISSING" });
  assert.equal(backend.rows.size, 1);

  await assert.rejects(() => saveAiWorkflowDraft({
    userId: admin.userId,
    kind: "DRIVER_IMPORT",
    payload: { value: "x".repeat(AI_WORKFLOW_DRAFT_MAX_JSON_BYTES + 1) },
    now,
  }, workflowRepository(backend)));

  const storedRow = [...backend.rows.values()][0];
  storedRow.payload = { malformed: true };
  backend.rows.set(`${admin.userId}:RESERVATION_CREATE`, storedRow);
  await assert.rejects(() => coldStartStore.load(admin), /malformed/i);

  backend.rows.clear();
  await firstStore.save(reservationDraft);
  clock = new Date(now.getTime() + 16 * 60 * 1_000);
  assert.deepEqual(await coldStartStore.load(admin), { kind: "EXPIRED" });
  assert.equal(backend.rows.size, 0);
  assert.deepEqual(await loadAiWorkflowDraft({ userId: admin.userId, kind: "RESERVATION_CREATE", now: clock }, workflowRepository(backend)), { kind: "MISSING" });
});

test("real messy repeated blocks deduplicate before analysis and retain only bounded source-row metadata", () => {
  const parsed = extractDriverImportRows({
    text: `${realList}\n${realList}`,
    createRowId: (index) => `row-${index}`,
  });
  assert.equal(parsed.rows.length, realRows.length);
  assert.equal(parsed.duplicateRowsSkipped, realRows.length);
  assert.equal(parsed.rows.every((row) => row.duplicateOccurrences === 1), true);
  const sameer = parsed.rows.find((row) => row.licenseNumber === "10445")!;
  assert.equal(sameer.name, "Sameer Khan");
  assert.equal(sameer.vehicleType, "VAN");
  const prius = parsed.rows.find((row) => row.licenseNumber === "5276")!;
  assert.equal(prius.vehicleType, "SEDAN");
  const split = extractDriverImportRows({
    text: "Sameer Khan 10445\nCADDY",
    createRowId: () => "split",
  });
  assert.equal(split.rows.length, 1);
  assert.equal(split.rows[0].vehicleType, "VAN");
});

test("vehicle classification is deterministic, owns spelling normalization, and leaves unknown models unresolved", () => {
  const vans = ["Mercedes V-Class", "Mercedes V", "Vito", "VW Caravelle", "VW Caddy", "Ford Tourneo", "ford turneo", "Ford Custom", "Fiat Talento", "Mercedez Vito"];
  const sedans = ["Corolla", "Camry", "Prius+", "RAV4", "Lexus ES300"];
  for (const model of vans) assert.equal(classifyDriverVehicle(model).vehicleType, "VAN", model);
  for (const model of sedans) assert.equal(classifyDriverVehicle(model).vehicleType, "SEDAN", model);
  assert.deepEqual(classifyDriverVehicle("Peugeot Traveller").vehicleType, null);
  assert.equal(classifyDriverVehicle("Peugeot Traveller").vehicleRaw, "Peugeot Traveller");
});

test("multiple names, night drivers, missing fields, unknown vehicles, and unsupported notes require review without persistence fields", async () => {
  const draft = await createDriverImportDraft({
    id: "draft-ambiguous",
    ownerUserId: admin.userId,
    ownerEmail: admin.email,
    text: [
      "Ehsam y Basheer Ahmed 5181 V Class",
      "Qaisar Cheema 8268 Vito 047 & noche Sukh Sidhu conductor",
      "Muneeb VTC",
      "Raja Hadeed 5063 Peugeot Traveller 048 PMR",
    ].join("\n"),
    createRowId: (index) => `ambiguous-${index}`,
    repository: new ExistingRepository(),
    now,
  });
  assert.equal(draft.rows.every((row) => row.state === "NEEDS_REVIEW"), true);
  assert.deepEqual(draft.rows[0].possibleNames, ["Ehsam", "Basheer Ahmed"]);
  assert.match(draft.rows[1].sourceNotes.join(" "), /047.*noche/i);
  assert.match(draft.rows[3].sourceNotes.join(" "), /048.*PMR/i);
  assert.equal("notes" in draft.rows[3], false);
  assert.equal("vehicleModel" in draft.rows[3], false);
  assert.equal(toPublicDriverImportDraft(draft).readyToPrepare, false);
});

test("same-code/name conflicts and existing-driver matches follow conservative exact rules", async () => {
  const repository = new ExistingRepository([
    existing({ id: "existing-1", name: "Sameer Khan", licenseNumber: "10445", vehicleType: "VAN" }),
    existing({ id: "existing-2", name: "Ali Tehreem", licenseNumber: "5901", vehicleType: "SEDAN" }),
    existing({ id: "existing-3", name: "Usman Ali", licenseNumber: "9999", vehicleType: "SEDAN", status: "INACTIVE" }),
  ]);
  const draft = await createDriverImportDraft({
    id: "draft-existing",
    ownerUserId: admin.userId,
    ownerEmail: admin.email,
    text: [
      "Sameer Khan 10445 Caddy",
      "Ali Tehreem 5901 Vito",
      "Someone Else 10445 Caddy",
      "Usman Ali 4512 Corolla",
      "Eathsham Saadat 4579 V Class",
      "Noman Saadat 4579 V Class",
    ].join("\n"),
    createRowId: (index) => `existing-row-${index}`,
    repository,
    now,
  });
  // A conflicting second row for the same code makes the entire code group unsafe.
  assert.equal(draft.rows[0].state, "CONFLICT");
  assert.equal(draft.rows[1].state, "EXISTING_UPDATE");
  assert.equal(draft.rows[2].state, "CONFLICT");
  assert.equal(draft.rows[3].state, "NEEDS_REVIEW");
  assert.equal(draft.rows[4].state, "CONFLICT");
  assert.equal(draft.rows[5].state, "CONFLICT");

  const exactDraft = await createDriverImportDraft({
    id: "draft-existing-exact",
    ownerUserId: admin.userId,
    ownerEmail: admin.email,
    text: "Sameer Khan 10445 Caddy",
    createRowId: (index) => `existing-exact-${index}`,
    repository,
    now,
  });
  assert.equal(exactDraft.rows[0].state, "EXISTING_MATCH");
});

test("same normalized code, name, and vehicle are skipped once while contradictory vehicle types block", async () => {
  const semanticDuplicate = await createDriverImportDraft({
    id: "draft-semantic-duplicate",
    ownerUserId: admin.userId,
    ownerEmail: admin.email,
    text: [
      "Sameer Khan 10445 Caddy",
      "Sameer Khan 10445 VW Caddy",
    ].join("\n"),
    createRowId: (index) => `semantic-duplicate-${index}`,
    repository: new ExistingRepository(),
    now,
  });
  assert.deepEqual(semanticDuplicate.rows.map((row) => row.state), ["NEW", "DUPLICATE_IN_IMPORT"]);
  assert.equal(toPublicDriverImportDraft(semanticDuplicate).duplicateRowsSkipped, 1);

  const contradictory = await createDriverImportDraft({
    id: "draft-vehicle-conflict",
    ownerUserId: admin.userId,
    ownerEmail: admin.email,
    text: [
      "Sameer Khan 10445 Caddy",
      "Sameer Khan 10445 Corolla",
    ].join("\n"),
    createRowId: (index) => `vehicle-conflict-${index}`,
    repository: new ExistingRepository(),
    now,
  });
  assert.deepEqual(contradictory.rows.map((row) => row.state), ["CONFLICT", "CONFLICT"]);
  assert.equal(toPublicDriverImportDraft(contradictory).readyToPrepare, false);
});

class MemoryImportStore implements DriverImportDraftStore {
  draft: DriverImportDraftRecord | null = null;
  async load(context: { userId: string; email: string }) {
    if (!this.draft || this.draft.ownerUserId !== context.userId || this.draft.ownerEmail !== context.email.toLowerCase()) {
      return { kind: "MISSING" as const };
    }
    return { kind: "ACTIVE" as const, draft: structuredClone(this.draft) };
  }
  async save(draft: DriverImportDraftRecord) {
    this.draft = structuredClone(draft);
    return structuredClone(draft);
  }
  async clear() { this.draft = null; }
}

async function readyDraft(repository: ExistingRepository) {
  const draft = await createDriverImportDraft({
    id: "driver-import-ready",
    ownerUserId: admin.userId,
    ownerEmail: admin.email,
    text: "Sameer Khan 10445 Caddy\nAli Tehreem 5901 Vito\nUsman Ali 4512 Corolla\nUsman Ali 4512 Corolla",
    createRowId: (index) => `ready-${index}`,
    repository,
    now,
  });
  return updateDriverImportDraft(draft, { rows: [], confirm_complete: true }, repository, now);
}

test("review completion prepares one bounded server-owned IMPORT_DRIVERS action and performs no driver write", async () => {
  const repository = new ExistingRepository([
    existing({ id: "existing-sameer", name: "Sameer Khan", licenseNumber: "10445", vehicleType: "VAN" }),
    existing({ id: "existing-ali", name: "Ali Tehreem", licenseNumber: "5901", vehicleType: "SEDAN" }),
  ]);
  const draft = await readyDraft(repository);
  const store = new MemoryImportStore();
  await store.save(draft);
  let captured: Record<string, unknown> | null = null;
  const result = await prepareDriverImportProposal(admin, {
    draft_id: draft.id,
    revision: draft.revision,
  }, {
    store,
    repository,
    createDraftId: () => "unused",
    createRowId: () => "unused",
    now: () => now,
    async prepareAction(input) {
      captured = input;
      return {
        ok: true,
        action: {
          actionId: "import-action-1",
          actionType: "IMPORT_DRIVERS",
          riskLevel: "WRITE",
          status: "PENDING",
          expiresAt: new Date(now.getTime() + 600_000).toISOString(),
          preview: input.preview,
          confirmationLabel: input.confirmationLabel,
        },
      };
    },
  });
  assert.equal(result.kind, "ACTION_PREVIEW");
  assert.equal((captured?.payload as DriverImportActionPayload).creates.length, 1);
  assert.equal((captured?.payload as DriverImportActionPayload).updates.length, 1);
  assert.equal((captured?.payload as DriverImportActionPayload).duplicatesSkipped, 1);
  assert.equal("status" in (captured?.payload as JsonObject), false);
  assert.equal(captured?.confirmationLabel, "Confirm Import");
  assert.match(JSON.stringify(captured?.preview), /names, codes, status, subscriptions, and finance/i);

  const wrongRevision = await prepareDriverImportProposal(admin, { draft_id: draft.id, revision: 999 }, {
    store,
    repository,
    createDraftId: () => "unused",
    createRowId: () => "unused",
    async prepareAction() { throw new Error("must not prepare"); },
  });
  assert.equal(wrongRevision.kind, "DRAFT_CHANGED");
});

test("a maximum-size reviewed import stays inside pending-action and preview bounds", async () => {
  const rows = Array.from({ length: 48 }, (_, index) => {
    const suffix = `${String.fromCharCode(65 + Math.floor(index / 26))}${String.fromCharCode(65 + (index % 26))}`;
    const name = `${"Longname ".repeat(21)}${suffix}`;
    const licenseNumber = String(1_000 + index);
    return {
      line: `${name} ${licenseNumber} Caddy`,
      existing: existing({
        id: `existing-maximum-${index}-${"x".repeat(24)}`,
        name,
        licenseNumber,
        vehicleType: "SEDAN",
      }),
    };
  });
  const repository = new ExistingRepository(rows.map((row) => row.existing));
  const parsed = await createDriverImportDraft({
    id: "driver-import-maximum",
    ownerUserId: admin.userId,
    ownerEmail: admin.email,
    text: rows.map((row) => row.line).join("\n"),
    createRowId: (index) => `maximum-${index}`,
    repository,
    now,
  });
  const draft = await updateDriverImportDraft(
    parsed,
    { rows: [], confirm_complete: true },
    repository,
    now,
  );
  const store = new MemoryImportStore();
  await store.save(draft);
  let captured: Parameters<NonNullable<Parameters<typeof prepareDriverImportProposal>[2]["prepareAction"]>>[0] | null = null;
  const result = await prepareDriverImportProposal(admin, {
    draft_id: draft.id,
    revision: draft.revision,
  }, {
    store,
    repository,
    createDraftId: () => "unused",
    createRowId: () => "unused",
    now: () => now,
    async prepareAction(input) {
      captured = input;
      return {
        ok: true,
        action: {
          actionId: "maximum-action",
          actionType: "IMPORT_DRIVERS",
          riskLevel: "WRITE",
          status: "PENDING",
          expiresAt: new Date(now.getTime() + 600_000).toISOString(),
          preview: input.preview,
          confirmationLabel: input.confirmationLabel,
        },
      };
    },
  });
  assert.equal(result.kind, "ACTION_PREVIEW");
  assert.ok(captured);
  assert.equal((captured.payload as DriverImportActionPayload).updates.length, 48);
  assertJsonObject(captured.payload, "maximum import payload");
  assertJsonObject(captured.precondition, "maximum import precondition");
  const preview = parseAiActionPreview(captured.preview);
  assert.equal(preview.sections.length <= 6, true);
  assert.equal(preview.sections.every((section) => section.facts.length <= 12), true);
  assert.equal(preview.sections.flatMap((section) => section.facts).every((fact) => fact.value.length <= 500), true);
});

type ImportTransaction = {
  action: AiPendingActionRecord;
  drivers: ExistingDriverImportSnapshot[];
  activities: Array<{ action: string; metadata: JsonObject }>;
  failCreateAt: number | null;
  creates: number;
};

function storedImportAction(input: {
  creates?: DriverImportActionPayload["creates"];
  updates?: DriverImportActionPayload["updates"];
  existing?: ExistingDriverImportSnapshot[];
} = {}): AiPendingActionRecord {
  const creates = input.creates ?? [{ name: "Usman Ali", licenseNumber: "4512", vehicleType: "SEDAN" }];
  const updates = input.updates ?? [{ driverId: "existing-ali", vehicleType: "VAN" }];
  const existingRows = input.existing ?? [existing({ id: "existing-ali", name: "Ali Tehreem", licenseNumber: "5901", vehicleType: "SEDAN" })];
  const payload: DriverImportActionPayload = {
    draftId: "driver-import-ready",
    draftRevision: 2,
    creates,
    updates,
    duplicatesSkipped: 2,
    noOpCount: 1,
  };
  const precondition: DriverImportActionPrecondition = {
    ownerUserId: admin.userId,
    ownerEmail: admin.email,
    preparedAt: now.toISOString(),
    existing: existingRows,
    newDrivers: creates.map(({ name, licenseNumber }) => ({ name, licenseNumber })),
  };
  return {
    id: "import-action-1",
    userId: admin.userId,
    actionType: "IMPORT_DRIVERS",
    riskLevel: "WRITE",
    status: "PENDING",
    payload: serializeDriverImportActionPayload(payload),
    preview: { title: "Import drivers", sections: [{ heading: "Summary", facts: [{ label: "New drivers", value: String(creates.length) }] }] },
    precondition: serializeDriverImportActionPrecondition(precondition),
    confirmationLabel: "Confirm Import",
    idempotencyKey: "import-idempotency-1",
    expiresAt: new Date(now.getTime() + 600_000),
    confirmedAt: null,
    executedAt: null,
    result: null,
    failureCode: null,
    createdAt: now,
    updatedAt: now,
  };
}

class TransactionalImportStore implements AiPendingActionStore<ImportTransaction> {
  action: AiPendingActionRecord;
  drivers: ExistingDriverImportSnapshot[];
  activities: Array<{ action: string; metadata: JsonObject }> = [];
  failCreateAt: number | null = null;
  creates = 0;
  private tail = Promise.resolve();

  constructor(action = storedImportAction(), drivers?: ExistingDriverImportSnapshot[]) {
    this.action = structuredClone(action);
    this.drivers = structuredClone(drivers ?? [existing({ id: "existing-ali", name: "Ali Tehreem", licenseNumber: "5901", vehicleType: "SEDAN" })]);
  }
  async transaction<Result>(callback: (transaction: ImportTransaction) => Promise<Result>) {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const transaction: ImportTransaction = {
      action: structuredClone(this.action),
      drivers: structuredClone(this.drivers),
      activities: structuredClone(this.activities),
      failCreateAt: this.failCreateAt,
      creates: this.creates,
    };
    try {
      const result = await callback(transaction);
      this.action = structuredClone(transaction.action);
      this.drivers = structuredClone(transaction.drivers);
      this.activities = structuredClone(transaction.activities);
      this.creates = transaction.creates;
      return result;
    } finally {
      release();
    }
  }
  async findCanonicalActor(_transaction: ImportTransaction, identity: { userId: string; email: string }) {
    return identity.userId === admin.userId && identity.email === admin.email ? admin : identity.userId === user.userId ? user : null;
  }
  async findAction(transaction: ImportTransaction, actionId: string) {
    return transaction.action.id === actionId ? structuredClone(transaction.action) : null;
  }
  async createAction() { throw new Error("not used"); }
  async transitionAction(transaction: ImportTransaction, input: {
    actionId: string;
    userId: string;
    from: AiPendingActionRecord["status"];
    update: AiPendingActionUpdate;
  }) {
    if (transaction.action.id !== input.actionId || transaction.action.userId !== input.userId || transaction.action.status !== input.from) return false;
    transaction.action = { ...transaction.action, ...structuredClone(input.update) };
    return true;
  }
  async createActivityLog(transaction: ImportTransaction, input: { action: string; metadata: JsonObject }) {
    transaction.activities.push({ action: input.action, metadata: structuredClone(input.metadata) });
  }
}

function mutationRepository(transaction: ImportTransaction): DriverImportMutationRepository {
  return {
    async findCandidates(input) {
      const codes = new Set(input.licenseNumbers.map((code) => code.toUpperCase()));
      const names = new Set(input.names.map((name) => name.toLowerCase()));
      return structuredClone(transaction.drivers.filter((driver) =>
        codes.has(driver.licenseNumber.toUpperCase()) || names.has(driver.name.toLowerCase()),
      ));
    },
    async create(profile) {
      transaction.creates += 1;
      if (transaction.failCreateAt === transaction.creates) throw new Error("database failed");
      if (transaction.drivers.some((driver) => driver.licenseNumber.toUpperCase() === profile.licenseNumber.toUpperCase())) {
        throw new Error("duplicate");
      }
      const created = existing({
        id: `created-${transaction.creates}`,
        name: profile.name,
        licenseNumber: profile.licenseNumber,
        vehicleType: profile.vehicleType,
        status: profile.status,
        subscriptionExempt: profile.subscriptionExempt,
        updatedAt: now,
      });
      transaction.drivers.push(created);
      return { ...created, createdAt: now, vehicleType: created.vehicleType! };
    },
    async updateVehicleType(input) {
      const index = transaction.drivers.findIndex((driver) => driver.id === input.current.id && driver.updatedAt.getTime() === input.current.updatedAt.getTime());
      if (index < 0) return null;
      transaction.drivers[index] = { ...transaction.drivers[index], vehicleType: input.vehicleType, updatedAt: new Date(now.getTime() + 1) };
      return { ...transaction.drivers[index], createdAt: now };
    },
    async createActivity(input) {
      transaction.activities.push({ action: input.action, metadata: structuredClone(input.metadata) });
    },
  };
}

test("IMPORT_DRIVERS confirmation is ADMIN-only, idempotent, transactional, and returns deterministic counts", async () => {
  const store = new TransactionalImportStore();
  const dependencies = {
    store,
    executors: { IMPORT_DRIVERS: createDriverImportExecutor(mutationRepository) } as AiActionExecutorRegistry<ImportTransaction>,
    now: () => now,
  };
  const concurrent = await Promise.all([
    confirmAiPendingAction({ session: admin, actionId: "import-action-1" }, dependencies),
    confirmAiPendingAction({ session: admin, actionId: "import-action-1" }, dependencies),
  ]);
  assert.deepEqual(concurrent.map((result) => result.code).sort(), ["ACTION_ALREADY_EXECUTED", "ACTION_EXECUTED"]);
  const replay = await confirmAiPendingAction({ session: admin, actionId: "import-action-1" }, dependencies);
  assert.equal(replay.code, "ACTION_ALREADY_EXECUTED");
  assert.equal(store.drivers.filter((driver) => driver.licenseNumber === "4512").length, 1);
  assert.equal(store.drivers.find((driver) => driver.id === "existing-ali")?.vehicleType, "VAN");
  assert.equal(store.activities.filter((entry) => entry.action === "drivers_imported").length, 1);
  assert.equal(store.activities.at(-1)?.metadata.actionType, "IMPORT_DRIVERS");
  assert.match(replay.action?.result?.message ?? "", /Created: 1.*Updated: 1.*Duplicates skipped: 2/);

  const forbiddenStore = new TransactionalImportStore({ ...storedImportAction(), userId: user.userId });
  const forbidden = await confirmAiPendingAction(
    { session: user, actionId: "import-action-1" },
    { store: forbiddenStore, executors: dependencies.executors, now: () => now },
  );
  assert.equal(forbidden.code, "ACTION_FORBIDDEN");
  assert.equal(forbiddenStore.drivers.length, 1);
});

test("stale existing state conflicts and a later database failure rolls the entire batch back before persisting failure", async () => {
  const staleStore = new TransactionalImportStore();
  staleStore.drivers[0].updatedAt = new Date(now.getTime() + 1);
  const stale = await confirmAiPendingAction(
    { session: admin, actionId: "import-action-1" },
    { store: staleStore, executors: { IMPORT_DRIVERS: createDriverImportExecutor(mutationRepository) }, now: () => now },
  );
  assert.equal(stale.code, "ACTION_CONFLICTED");
  assert.equal(staleStore.drivers[0].vehicleType, "SEDAN");

  const failureAction = storedImportAction({
    creates: [
      { name: "Driver One", licenseNumber: "7001", vehicleType: "VAN" },
      { name: "Driver Two", licenseNumber: "7002", vehicleType: "SEDAN" },
    ],
    updates: [],
    existing: [],
  });
  const failureStore = new TransactionalImportStore(failureAction, []);
  failureStore.failCreateAt = 2;
  const failed = await confirmAiPendingAction(
    { session: admin, actionId: "import-action-1" },
    { store: failureStore, executors: { IMPORT_DRIVERS: createDriverImportExecutor(mutationRepository) }, now: () => now },
  );
  assert.equal(failed.code, "ACTION_FAILED");
  assert.equal(failureStore.drivers.length, 0);
  assert.equal(failureStore.activities.length, 0);
  assert.equal(failureStore.action.status, "FAILED");
});

function modelCall(name: string, args: unknown) {
  return { type: "function_call", name, call_id: `call-${name}`, arguments: JSON.stringify(args) };
}

test("tool loop emits a bounded driver import draft and rejects parsing text not equal to the current user message", async () => {
  const store = new MemoryImportStore();
  const repository = new ExistingRepository();
  const results: AssistantModelResult[] = [
    { output: [modelCall("parse_driver_list_text", { driver_list_text: "Usman Ali 4512 Corolla" })] },
    { output: [{ type: "message" }] },
  ];
  let index = 0;
  const dependencies: AssistantToolLoopDependencies = {
    streamModel: async () => results[index++] ?? { output: [{ type: "message" }] },
    searchReservations: async () => [],
    getReservation: async () => null,
    searchDrivers: async () => ({ drivers: [], count: 0, hasMore: false, nextCursor: null }),
    getDriverLedgerSummary: async () => null,
    getDriverTransactions: async () => null,
    parseDriverListText: (context, input) => parseDriverListDraft(context, input.driver_list_text, {
      store,
      repository,
      createDraftId: () => "loop-draft",
      createRowId: () => "loop-row",
      now: () => now,
    }),
    getCurrentDriverImportDraft: async () => null,
    now: () => now,
  };
  const events: AssistantStreamEvent[] = [];
  await runReservationAssistantToolLoop({
    message: "Usman Ali 4512 Corolla",
    context: [],
    authContext: admin,
    signal: new AbortController().signal,
    emit(event) { events.push(event); },
  }, dependencies);
  assert.equal(events.some((event) => event.type === "assistant.driver_import_draft"), true);

  const badResults: AssistantModelResult[] = [
    { output: [modelCall("parse_driver_list_text", { driver_list_text: "forged list" })] },
    { output: [{ type: "message" }] },
  ];
  index = 0;
  dependencies.streamModel = async () => badResults[index++] ?? { output: [{ type: "message" }] };
  const badEvents: AssistantStreamEvent[] = [];
  await runReservationAssistantToolLoop({
    message: "Usman Ali 4512 Corolla",
    context: [],
    authContext: admin,
    signal: new AbortController().signal,
    emit(event) { badEvents.push(event); },
  }, dependencies);
  assert.equal(badEvents.some((event) => event.type === "assistant.driver_import_draft"), false);
});

test("typed SSE and mobile source support grouped import review without tables or horizontal overflow classes", async () => {
  const operation = await parseDriverListDraft(admin, "Usman Ali 4512 Corolla", {
    store: new MemoryImportStore(),
    repository: new ExistingRepository(),
    createDraftId: () => "sse-draft",
    createRowId: () => "sse-row",
    now: () => now,
  });
  assert.equal(operation.kind, "DRAFT");
  const draft = (operation as Extract<DriverImportDraftOperationResult, { kind: "DRAFT" }>).draft;
  assert.equal(parseAssistantStreamEvent({ type: "assistant.driver_import_draft", draft }).type, "assistant.driver_import_draft");
  assert.throws(() => parseAssistantStreamEvent({
    type: "assistant.driver_import_draft",
    draft: { ...draft, rows: [{ ...draft.rows[0], subscriptionExempt: true }] },
  }));
  const cardSource = readFileSync("src/components/assistant/DriverImportDraftCard.tsx", "utf8");
  assert.match(cardSource, /break-words/);
  assert.match(cardSource, /details/);
  assert.match(cardSource, /slice\(0, 12\)/);
  assert.doesNotMatch(cardSource, /<table/);
});

test("source regression proves one workflow-draft migration, shared normal driver creation, no unsupported writes, and confirmation has no OpenAI dependency", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const migration = readFileSync("prisma/migrations/20260812120000_add_ai_workflow_drafts/migration.sql", "utf8");
  const normalRoute = readFileSync("src/app/api/drivers/route.ts", "utf8");
  const executor = readFileSync("src/lib/assistant/actions/driver-import-executor.ts", "utf8");
  const confirmation = readFileSync("src/lib/assistant/actions/core.ts", "utf8");
  assert.match(schema, /model AiWorkflowDraft/);
  assert.match(schema, /@@unique\(\[userId, kind\]\)/);
  assert.match(migration, /CREATE TABLE "AiWorkflowDraft"/);
  assert.match(normalRoute, /createDriverProfile/);
  assert.match(executor, /status: "ACTIVE"/);
  assert.match(executor, /subscriptionExempt: false/);
  for (const forbidden of ["commissionEntry", "driverPayment", "subscriptionCharge", "reservation.update", "driver.delete", "status: \"INACTIVE\""]) {
    assert.equal(executor.includes(forbidden), false);
  }
  assert.doesNotMatch(confirmation, /from\s+["']openai["']|require\(["']openai["']\)/i);
});
