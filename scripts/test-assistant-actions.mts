import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  cancelAiPendingAction,
  confirmAiPendingAction,
  prepareAiPendingAction,
  type AiActionExecutorRegistry,
  type AiCanonicalActor,
  type AiPendingActionRecord,
  type AiPendingActionStore,
  type AiPendingActionUpdate,
  type AiSessionIdentity,
} from "../src/lib/assistant/actions/core.ts";
import {
  AI_PENDING_ACTION_TTL_MS,
  isAiActionType,
  parseAiActionPublic,
  type AiActionPreview,
  type AiActionType,
  type JsonObject,
} from "../src/lib/assistant/actions/contracts.ts";
import {
  isSameOriginAiActionRequest,
  validateEmptyAiActionRequest,
} from "../src/lib/assistant/actions/http.ts";
import { parseAssistantStreamEvent } from "../src/lib/assistant/stream-protocol.ts";

type Transaction = { readonly kind: "test-transaction" };

function cloneAction(action: AiPendingActionRecord) {
  return structuredClone(action);
}

class MemoryActionStore implements AiPendingActionStore<Transaction> {
  users = new Map<string, AiCanonicalActor>();
  actions = new Map<string, AiPendingActionRecord>();
  audits: Array<{
    action: string;
    entityType: string;
    entityId?: string | null;
    userEmail: string;
    metadata: JsonObject;
  }> = [];
  private sequence = 0;
  private transactionTail = Promise.resolve();

  constructor(users: AiCanonicalActor[]) {
    users.forEach((user) => this.users.set(user.userId, structuredClone(user)));
  }

  async transaction<Result>(callback: (transaction: Transaction) => Promise<Result>) {
    const previous = this.transactionTail;
    let release!: () => void;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await callback({ kind: "test-transaction" });
    } finally {
      release();
    }
  }

  async findCanonicalActor(_transaction: Transaction, identity: AiSessionIdentity) {
    const user = this.users.get(identity.userId);
    if (!user || user.email !== identity.email.trim().toLowerCase()) return null;
    return structuredClone(user);
  }

  async findAction(_transaction: Transaction, actionId: string) {
    const action = this.actions.get(actionId);
    return action ? cloneAction(action) : null;
  }

  async createAction(
    _transaction: Transaction,
    action: Omit<AiPendingActionRecord, "id" | "createdAt" | "updatedAt">,
  ) {
    this.sequence += 1;
    const createdAt = new Date("2026-08-11T10:00:00.000Z");
    const stored: AiPendingActionRecord = {
      ...structuredClone(action),
      id: `action-${this.sequence}`,
      createdAt,
      updatedAt: createdAt,
    };
    assert.equal(
      [...this.actions.values()].some(
        (candidate) => candidate.idempotencyKey === stored.idempotencyKey,
      ),
      false,
      "idempotency keys must be unique",
    );
    this.actions.set(stored.id, stored);
    return cloneAction(stored);
  }

  async transitionAction(
    _transaction: Transaction,
    input: {
      actionId: string;
      userId: string;
      from: AiPendingActionRecord["status"];
      update: AiPendingActionUpdate;
      expiresAfter?: Date;
    },
  ) {
    const current = this.actions.get(input.actionId);
    if (
      !current ||
      current.userId !== input.userId ||
      current.status !== input.from ||
      (input.expiresAfter && current.expiresAt.getTime() <= input.expiresAfter.getTime())
    ) {
      return false;
    }
    this.actions.set(input.actionId, {
      ...current,
      ...structuredClone(input.update),
      updatedAt: new Date("2026-08-11T10:00:01.000Z"),
    });
    return true;
  }

  async createActivityLog(
    _transaction: Transaction,
    input: {
      action: string;
      entityType: string;
      entityId?: string | null;
      userEmail: string;
      metadata: JsonObject;
    },
  ) {
    this.audits.push(structuredClone(input));
  }
}

const owner: AiCanonicalActor = {
  userId: "user-1",
  email: "owner@example.com",
  role: "USER",
};
const other: AiCanonicalActor = {
  userId: "user-2",
  email: "other@example.com",
  role: "USER",
};
const admin: AiCanonicalActor = {
  userId: "admin-1",
  email: "admin@example.com",
  role: "ADMIN",
};
const baseNow = new Date("2026-08-11T10:00:00.000Z");

const preview: AiActionPreview = {
  title: "Update reservation",
  summary: "Review the exact change.",
  sections: [
    {
      heading: "Reservation",
      facts: [
        { label: "Route", value: "BCN Airport → Sabadell" },
        { label: "Pickup time", previousValue: "10:00", value: "08:30" },
      ],
    },
  ],
};

const financialPreview: AiActionPreview = {
  title: "Record driver payment",
  sections: [
    {
      heading: "Driver and reservation",
      facts: [
        { label: "Driver", value: "Fixture Driver" },
        { label: "Reservation", value: "No reservation linked" },
      ],
    },
    {
      heading: "Payment",
      facts: [
        { label: "Amount", value: "€125.00", emphasis: "money" },
        { label: "Payment date", value: "11 Aug 2026" },
      ],
    },
  ],
};

function prepare(
  store: MemoryActionStore,
  options: {
    actor?: AiCanonicalActor;
    actionType?: AiActionType;
    payload?: JsonObject;
    precondition?: JsonObject;
    preview?: AiActionPreview;
    now?: Date;
    key?: string;
  } = {},
) {
  const actor = options.actor ?? owner;
  return prepareAiPendingAction(
    {
      session: { userId: actor.userId, email: actor.email },
      actionType: options.actionType ?? "UPDATE_RESERVATION",
      payload: options.payload ?? { reservationId: "reservation-1", startAt: "08:30" },
      precondition: options.precondition ?? { version: 1 },
      preview: options.preview ?? preview,
      confirmationLabel: "Confirm update",
    },
    {
      store,
      now: () => options.now ?? baseNow,
      createIdempotencyKey: () => options.key ?? "idempotency-1",
    },
  );
}

function successExecutor(counter: { calls: number; storedValue?: unknown }) {
  return {
    async checkPreconditions() {
      return { kind: "VALID" as const };
    },
    async execute({ action }: { action: AiPendingActionRecord }) {
      counter.calls += 1;
      counter.storedValue = action.payload.startAt;
      return {
        kind: "EXECUTED" as const,
        result: {
          title: "Reservation updated",
          message: "The approved fixture action executed once.",
          reference: { label: "Open reservation", href: "/reservations/reservation-1/edit" },
        },
        audit: {
          action: "reservation_updated",
          entityType: "reservation",
          entityId: "reservation-1",
          metadata: { changedFields: ["startAt"] },
        },
      };
    },
  };
}

test("pending action is server-owned, user-bound, short-lived, and contains no payload in its public contract", async () => {
  const store = new MemoryActionStore([owner]);
  const result = await prepare(store);
  assert.equal(result.code, "ACTION_PREPARED");
  assert.equal(result.action?.status, "PENDING");
  assert.equal(result.action?.expiresAt, "2026-08-11T10:10:00.000Z");
  assert.equal("payload" in (result.action ?? {}), false);
  assert.equal(store.actions.get("action-1")?.userId, owner.userId);
  assert.equal(store.actions.get("action-1")?.idempotencyKey, "idempotency-1");
});

test("someone else's action and a modified action ID are denied without revealing the record", async () => {
  const store = new MemoryActionStore([owner, other]);
  await prepare(store);
  const executors = { UPDATE_RESERVATION: successExecutor({ calls: 0 }) };
  const stolen = await confirmAiPendingAction(
    { session: { userId: other.userId, email: other.email }, actionId: "action-1" },
    { store, executors, now: () => baseNow },
  );
  const modified = await confirmAiPendingAction(
    { session: { userId: owner.userId, email: owner.email }, actionId: "action-forged" },
    { store, executors, now: () => baseNow },
  );
  assert.deepEqual(stolen, { ok: false, code: "ACTION_NOT_FOUND" });
  assert.deepEqual(modified, { ok: false, code: "ACTION_NOT_FOUND" });
});

test("forged user identity and forged role never replace the canonical database actor", async () => {
  const store = new MemoryActionStore([owner]);
  const forgedIdentity = await prepareAiPendingAction(
    {
      session: {
        userId: owner.userId,
        email: "attacker@example.com",
        role: "ADMIN",
      } as AiSessionIdentity,
      actionType: "RECORD_DRIVER_PAYMENT",
      payload: { driverId: "driver-1", amount: "100.00" },
      precondition: { driverStatus: "ACTIVE" },
      preview: financialPreview,
      confirmationLabel: "Confirm payment",
    },
    { store, now: () => baseNow, createIdempotencyKey: () => "forged-key" },
  );
  assert.deepEqual(forgedIdentity, { ok: false, code: "UNAUTHENTICATED" });

  const forgedRole = await prepareAiPendingAction(
    {
      session: {
        userId: owner.userId,
        email: owner.email,
        role: "ADMIN",
      } as AiSessionIdentity,
      actionType: "RECORD_DRIVER_PAYMENT",
      payload: { driverId: "driver-1", amount: "100.00" },
      precondition: { driverStatus: "ACTIVE" },
      preview: financialPreview,
      confirmationLabel: "Confirm payment",
    },
    { store, now: () => baseNow, createIdempotencyKey: () => "forged-role-key" },
  );
  assert.deepEqual(forgedRole, { ok: false, code: "ACTION_FORBIDDEN" });
});

test("financial previews fail closed unless exact driver, amount, type, date, and reservation context are visible", async () => {
  const store = new MemoryActionStore([admin]);
  await assert.rejects(
    () =>
      prepare(store, {
        actor: admin,
        actionType: "RECORD_DRIVER_PAYMENT",
        payload: { driverId: "driver-1", amount: "125.00" },
        preview,
      }),
    /driver, amount, type, date, and reservation context/,
  );
  assert.equal(store.actions.size, 0);
});

test("expired action cannot execute and remains expired on replay", async () => {
  const store = new MemoryActionStore([owner]);
  await prepare(store);
  const counter = { calls: 0 };
  const dependencies = {
    store,
    executors: { UPDATE_RESERVATION: successExecutor(counter) },
    now: () => new Date(baseNow.getTime() + AI_PENDING_ACTION_TTL_MS),
  };
  const first = await confirmAiPendingAction(
    { session: owner, actionId: "action-1" },
    dependencies,
  );
  const replay = await confirmAiPendingAction(
    { session: owner, actionId: "action-1" },
    dependencies,
  );
  assert.equal(first.code, "ACTION_EXPIRED");
  assert.equal(replay.code, "ACTION_EXPIRED");
  assert.equal(first.action?.status, "EXPIRED");
  assert.equal(counter.calls, 0);
});

test("cancellation is deterministic and a cancelled action cannot later execute", async () => {
  const store = new MemoryActionStore([owner]);
  await prepare(store);
  const cancelled = await cancelAiPendingAction(
    { session: owner, actionId: "action-1" },
    { store, now: () => baseNow },
  );
  const replay = await cancelAiPendingAction(
    { session: owner, actionId: "action-1" },
    { store, now: () => baseNow },
  );
  const counter = { calls: 0 };
  const confirm = await confirmAiPendingAction(
    { session: owner, actionId: "action-1" },
    { store, executors: { UPDATE_RESERVATION: successExecutor(counter) }, now: () => baseNow },
  );
  assert.equal(cancelled.code, "ACTION_CANCELLED");
  assert.equal(replay.code, "ACTION_ALREADY_CANCELLED");
  assert.equal(confirm.code, "ACTION_ALREADY_CANCELLED");
  assert.equal(counter.calls, 0);
});

test("double confirm, replay, and stored result are idempotent", async () => {
  const store = new MemoryActionStore([owner]);
  await prepare(store);
  const counter = { calls: 0 };
  const dependencies = {
    store,
    executors: { UPDATE_RESERVATION: successExecutor(counter) },
    now: () => baseNow,
  };
  const first = await confirmAiPendingAction(
    { session: owner, actionId: "action-1" },
    dependencies,
  );
  const second = await confirmAiPendingAction(
    { session: owner, actionId: "action-1" },
    dependencies,
  );
  assert.equal(first.code, "ACTION_EXECUTED");
  assert.equal(second.code, "ACTION_ALREADY_EXECUTED");
  assert.deepEqual(second.action?.result, first.action?.result);
  assert.equal(counter.calls, 1);
  assert.equal(store.audits.length, 1);
  assert.deepEqual(store.audits[0].metadata, {
    source: "ai_assistant",
    aiAssisted: true,
    pendingActionId: "action-1",
    actionType: "UPDATE_RESERVATION",
    riskLevel: "WRITE",
    idempotencyKey: "idempotency-1",
    changedFields: ["startAt"],
  });
  assert.equal(JSON.stringify(store.audits).includes("prompt"), false);
});

test("concurrent confirmations execute the transaction-bound mutation exactly once", async () => {
  const store = new MemoryActionStore([owner]);
  await prepare(store);
  const counter = { calls: 0 };
  const dependencies = {
    store,
    executors: { UPDATE_RESERVATION: successExecutor(counter) },
    now: () => baseNow,
  };
  const results = await Promise.all([
    confirmAiPendingAction({ session: owner, actionId: "action-1" }, dependencies),
    confirmAiPendingAction({ session: owner, actionId: "action-1" }, dependencies),
  ]);
  assert.deepEqual(
    results.map((result) => result.code).sort(),
    ["ACTION_ALREADY_EXECUTED", "ACTION_EXECUTED"],
  );
  assert.equal(counter.calls, 1);
  assert.equal(store.audits.length, 1);
});

test("driver and commission action variants inherit concurrent-confirm and lost-response replay idempotency", async () => {
  const cases: Array<{
    actionType: AiActionType;
    payload: JsonObject;
    actionPreview?: AiActionPreview;
  }> = [
    {
      actionType: "ASSIGN_DRIVER",
      payload: { reservationId: "reservation-1", targetDriverId: "driver-1" },
    },
    {
      actionType: "CLEAR_DRIVER",
      payload: { reservationId: "reservation-1" },
    },
    {
      actionType: "ASSIGN_DRIVER",
      payload: {
        reservationId: "reservation-1",
        targetDriverId: "driver-1",
        commissionAmount: "25.00",
      },
      actionPreview: financialPreview,
    },
    {
      actionType: "UPDATE_RESERVATION_COMMISSION",
      payload: { reservationId: "reservation-1", commissionAmount: "30.00" },
      actionPreview: financialPreview,
    },
    {
      actionType: "CLEAR_DRIVER",
      payload: { reservationId: "reservation-1", removesCommission: true },
      actionPreview: financialPreview,
    },
    {
      actionType: "CREATE_RESERVATION",
      payload: {
        startAt: "2026-11-21T08:50:00.000Z",
        pickupText: "Barcelona Airport T1",
        dropoffText: "Carrer de Llull 170, Barcelona",
        pax: 8,
      },
    },
  ];

  for (const { actionType, payload, actionPreview } of cases) {
    const store = new MemoryActionStore([admin]);
    await prepare(store, {
      actor: admin,
      actionType,
      payload,
      ...(actionPreview ? { preview: actionPreview } : {}),
    });
    const counter = { calls: 0 };
    const executors: AiActionExecutorRegistry<Transaction> = {
      [actionType]: successExecutor(counter),
    };
    const dependencies = { store, executors, now: () => baseNow };
    const concurrent = await Promise.all([
      confirmAiPendingAction(
        { session: admin, actionId: "action-1" },
        dependencies,
      ),
      confirmAiPendingAction(
        { session: admin, actionId: "action-1" },
        dependencies,
      ),
    ]);
    const replay = await confirmAiPendingAction(
      { session: admin, actionId: "action-1" },
      dependencies,
    );
    assert.deepEqual(
      concurrent.map((result) => result.code).sort(),
      ["ACTION_ALREADY_EXECUTED", "ACTION_EXECUTED"],
    );
    assert.equal(replay.code, "ACTION_ALREADY_EXECUTED");
    assert.equal(counter.calls, 1);
    assert.equal(store.audits.length, 1);
    assert.equal(store.audits[0].metadata.actionType, actionType);
  }
});

test("stored precondition conflict blocks mutation and stays terminal", async () => {
  const store = new MemoryActionStore([owner]);
  await prepare(store, { precondition: { updatedAt: "version-1" } });
  let calls = 0;
  const executors: AiActionExecutorRegistry<Transaction> = {
    UPDATE_RESERVATION: {
      async checkPreconditions({ action }) {
        calls += 1;
        assert.equal(action.precondition.updatedAt, "version-1");
        return { kind: "CONFLICTED", code: "RESERVATION_STALE" };
      },
      async execute() {
        assert.fail("conflicted action must not execute");
      },
    },
  };
  const first = await confirmAiPendingAction(
    { session: owner, actionId: "action-1" },
    { store, executors, now: () => baseNow },
  );
  const replay = await confirmAiPendingAction(
    { session: owner, actionId: "action-1" },
    { store, executors, now: () => baseNow },
  );
  assert.equal(first.code, "ACTION_CONFLICTED");
  assert.equal(first.action?.failure?.code, "RESERVATION_STALE");
  assert.equal(replay.code, "ACTION_CONFLICTED");
  assert.equal(calls, 1);
  assert.equal(store.audits.length, 0);
});

test("authorization is rechecked from the canonical user at confirmation", async () => {
  const store = new MemoryActionStore([admin]);
  await prepare(store, {
    actor: admin,
    actionType: "RECORD_DRIVER_PAYMENT",
    payload: { driverId: "driver-1", amount: "125.00" },
    preview: financialPreview,
  });
  store.users.set(admin.userId, { ...admin, role: "USER" });
  const result = await confirmAiPendingAction(
    { session: admin, actionId: "action-1" },
    {
      store,
      executors: { RECORD_DRIVER_PAYMENT: successExecutor({ calls: 0 }) },
      now: () => baseNow,
    },
  );
  assert.equal(result.code, "ACTION_FORBIDDEN");
  assert.equal(store.actions.get("action-1")?.status, "PENDING");
});

test("failed executor is persisted and never retried implicitly", async () => {
  const store = new MemoryActionStore([owner]);
  await prepare(store);
  let calls = 0;
  const dependencies = {
    store,
    executors: {
      UPDATE_RESERVATION: {
        async checkPreconditions() {
          return { kind: "VALID" as const };
        },
        async execute() {
          calls += 1;
          return { kind: "FAILED" as const, code: "FIXTURE_EXECUTOR_FAILED" };
        },
      },
    },
    now: () => baseNow,
  };
  const first = await confirmAiPendingAction(
    { session: owner, actionId: "action-1" },
    dependencies,
  );
  const replay = await confirmAiPendingAction(
    { session: owner, actionId: "action-1" },
    dependencies,
  );
  assert.equal(first.code, "ACTION_FAILED");
  assert.equal(first.action?.failure?.code, "FIXTURE_EXECUTOR_FAILED");
  assert.equal(replay.code, "ACTION_FAILED");
  assert.equal(calls, 1);
});

test("browser payload and preview tampering are rejected or ignored in favor of stored data", async () => {
  const store = new MemoryActionStore([owner]);
  await prepare(store, { payload: { reservationId: "reservation-1", startAt: "08:30" } });
  const counter = { calls: 0, storedValue: undefined as unknown };
  const result = await confirmAiPendingAction(
    {
      session: owner,
      actionId: "action-1",
      payload: { startAt: "23:59" },
      preview: { title: "Tampered" },
    } as { session: AiSessionIdentity; actionId: string },
    {
      store,
      executors: { UPDATE_RESERVATION: successExecutor(counter) },
      now: () => baseNow,
    },
  );
  assert.equal(result.code, "ACTION_EXECUTED");
  assert.equal(counter.storedValue, "08:30");

  const payloadRequest = new Request("https://taxi.example/api/assistant/actions/a/confirm", {
    method: "POST",
    body: JSON.stringify({ payload: { startAt: "23:59" } }),
  });
  assert.equal(await validateEmptyAiActionRequest(payloadRequest), false);
  assert.throws(() =>
    parseAiActionPublic({
      ...result.action,
      payload: { startAt: "23:59" },
    }),
  );
});

test("confirmation/cancellation request boundary accepts no authoritative browser fields and rejects cross-origin requests", async () => {
  assert.equal(
    await validateEmptyAiActionRequest(
      new Request("https://taxi.example/api/assistant/actions/a/confirm", {
        method: "POST",
      }),
    ),
    true,
  );
  assert.equal(
    isSameOriginAiActionRequest(
      new Request("https://taxi.example/api/assistant/actions/a/confirm", {
        method: "POST",
        headers: { origin: "https://attacker.example", host: "taxi.example" },
      }),
    ),
    false,
  );
});

test("destructive and unknown action types are unavailable", async () => {
  assert.equal(isAiActionType("DELETE_RESERVATION"), false);
  assert.equal(isAiActionType("PERMANENT_DELETE"), false);
  const store = new MemoryActionStore([admin]);
  await assert.rejects(() =>
    prepareAiPendingAction(
      {
        session: admin,
        actionType: "DELETE_RESERVATION" as AiActionType,
        payload: { reservationId: "reservation-1" },
        precondition: {},
        preview,
        confirmationLabel: "Delete",
      },
      { store, now: () => baseNow, createIdempotencyKey: () => "delete-key" },
    ),
  );
});

test("production registers the complete Phase 2 executor set and confirm/cancel have no OpenAI dependency", () => {
  const executorsSource = readFileSync(
    new URL("../src/lib/assistant/actions/executors.ts", import.meta.url),
    "utf8",
  );
  const serviceSource = readFileSync(
    new URL("../src/lib/assistant/actions/service.ts", import.meta.url),
    "utf8",
  );
  const confirmRouteSource = readFileSync(
    new URL(
      "../src/app/api/assistant/actions/[id]/confirm/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(executorsSource, /UPDATE_RESERVATION: updateReservationExecutor/);
  assert.match(executorsSource, /ASSIGN_DRIVER: assignDriverExecutor/);
  assert.match(executorsSource, /CLEAR_DRIVER: clearDriverExecutor/);
  assert.match(
    executorsSource,
    /UPDATE_RESERVATION_COMMISSION: updateReservationCommissionExecutor/,
  );
  assert.match(executorsSource, /CREATE_RESERVATION: createReservationExecutor/);
  assert.match(executorsSource, /IMPORT_DRIVERS: importDriversExecutor/);
  for (const forbidden of [
    "ADD_MANUAL_COMMISSION:",
    "RECORD_DRIVER_PAYMENT:",
  ]) {
    assert.equal(executorsSource.includes(forbidden), false);
  }
  assert.doesNotMatch(serviceSource, /from ["']openai["']|assistant\/openai/);
  assert.doesNotMatch(confirmRouteSource, /from ["']openai["']|assistant\/openai/);
});

test("typed SSE action preview accepts the public contract and rejects raw mutation payloads", async () => {
  const store = new MemoryActionStore([owner]);
  const prepared = await prepare(store);
  const event = parseAssistantStreamEvent({
    type: "assistant.action_preview",
    action: prepared.action,
  });
  assert.equal(event.type, "assistant.action_preview");
  assert.throws(() =>
    parseAssistantStreamEvent({
      type: "assistant.action_preview",
      action: { ...prepared.action, payload: { reservationId: "reservation-1" } },
    }),
  );
});

test("empty production registry leaves a valid action pending instead of mutating data", async () => {
  const store = new MemoryActionStore([owner]);
  await prepare(store);
  const result = await confirmAiPendingAction(
    { session: owner, actionId: "action-1" },
    { store, executors: {}, now: () => baseNow },
  );
  assert.equal(result.code, "ACTION_UNAVAILABLE");
  assert.equal(result.action?.status, "PENDING");
  assert.equal(store.audits.length, 0);
});
