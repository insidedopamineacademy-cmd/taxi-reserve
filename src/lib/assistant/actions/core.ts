import {
  AI_PENDING_ACTION_TTL_MS,
  assertAiActionPreviewForRisk,
  assertJsonObject,
  canRoleExecuteAiAction,
  deriveAiActionRisk,
  failureForAiAction,
  isAiActionType,
  parseAiActionPreview,
  parseAiActionResult,
  type AiActionPreview,
  type AiActionPublic,
  type AiActionResult,
  type AiActionRisk,
  type AiActionStatus,
  type AiActionType,
  type AiActorRole,
  type JsonObject,
} from "./contracts.ts";

export type AiSessionIdentity = {
  userId: string;
  email: string;
};

export type AiCanonicalActor = AiSessionIdentity & {
  role: AiActorRole;
};

export type AiPendingActionRecord = {
  id: string;
  userId: string;
  actionType: AiActionType;
  riskLevel: AiActionRisk;
  status: AiActionStatus;
  payload: JsonObject;
  preview: AiActionPreview;
  precondition: JsonObject;
  confirmationLabel: string;
  idempotencyKey: string;
  expiresAt: Date;
  confirmedAt: Date | null;
  executedAt: Date | null;
  result: AiActionResult | null;
  failureCode: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AiPendingActionUpdate = {
  status?: AiActionStatus;
  confirmedAt?: Date | null;
  executedAt?: Date | null;
  result?: AiActionResult | null;
  failureCode?: string | null;
};

export type AiActionAudit = {
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: JsonObject;
};

export type AiActionPreconditionOutcome =
  | { kind: "VALID" }
  | { kind: "CONFLICTED"; code?: string };

export type AiActionExecutionOutcome =
  | { kind: "EXECUTED"; result: AiActionResult; audit: AiActionAudit }
  | { kind: "CONFLICTED"; code?: string }
  | { kind: "FAILED"; code: string };

export type AiActionExecutor<Transaction> = {
  /**
   * Re-read every authoritative target and compare it to action.precondition.
   * Financial conflicts must never be auto-merged.
   */
  checkPreconditions(input: {
    transaction: Transaction;
    action: AiPendingActionRecord;
    actor: AiCanonicalActor;
  }): Promise<AiActionPreconditionOutcome>;
  /** Perform the business mutation with this transaction only. No OpenAI or external side effects. */
  execute(input: {
    transaction: Transaction;
    action: AiPendingActionRecord;
    actor: AiCanonicalActor;
  }): Promise<AiActionExecutionOutcome>;
};

export type AiActionExecutorRegistry<Transaction> = Partial<
  Record<AiActionType, AiActionExecutor<Transaction>>
>;

export class AiActionExecutionRollback extends Error {
  constructor(
    readonly outcome: "FAILED" | "CONFLICTED",
    readonly code: string,
  ) {
    super(code);
    this.name = "AiActionExecutionRollback";
  }
}

export type AiPendingActionStore<Transaction> = {
  transaction<Result>(callback: (transaction: Transaction) => Promise<Result>): Promise<Result>;
  findCanonicalActor(
    transaction: Transaction,
    identity: AiSessionIdentity,
  ): Promise<AiCanonicalActor | null>;
  findAction(transaction: Transaction, actionId: string): Promise<AiPendingActionRecord | null>;
  createAction(
    transaction: Transaction,
    action: Omit<AiPendingActionRecord, "id" | "createdAt" | "updatedAt">,
  ): Promise<AiPendingActionRecord>;
  transitionAction(
    transaction: Transaction,
    input: {
      actionId: string;
      userId: string;
      from: AiActionStatus;
      update: AiPendingActionUpdate;
      expiresAfter?: Date;
    },
  ): Promise<boolean>;
  createActivityLog(
    transaction: Transaction,
    input: {
      action: string;
      entityType: string;
      entityId?: string | null;
      userEmail: string;
      metadata: JsonObject;
    },
  ): Promise<void>;
};

export type AiActionCommandCode =
  | "ACTION_PREPARED"
  | "ACTION_EXECUTED"
  | "ACTION_ALREADY_EXECUTED"
  | "ACTION_CANCELLED"
  | "ACTION_ALREADY_CANCELLED"
  | "ACTION_EXPIRED"
  | "ACTION_CONFLICTED"
  | "ACTION_FAILED"
  | "ACTION_IN_PROGRESS"
  | "ACTION_NOT_FOUND"
  | "ACTION_FORBIDDEN"
  | "ACTION_UNAVAILABLE"
  | "UNAUTHENTICATED";

export type AiActionCommandResult = {
  ok: boolean;
  code: AiActionCommandCode;
  action?: AiActionPublic;
};

function applyUpdate(action: AiPendingActionRecord, update: AiPendingActionUpdate) {
  return {
    ...action,
    ...update,
    updatedAt: new Date(),
  };
}

function publicAction(action: AiPendingActionRecord): AiActionPublic {
  return {
    actionId: action.id,
    actionType: action.actionType,
    riskLevel: action.riskLevel,
    status: action.status,
    expiresAt: action.expiresAt.toISOString(),
    preview: action.preview,
    confirmationLabel: action.confirmationLabel,
    ...(action.status === "EXECUTED" && action.result ? { result: action.result } : {}),
    ...(failureForAiAction(action.status, action.failureCode)
      ? { failure: failureForAiAction(action.status, action.failureCode) }
      : {}),
  };
}

function terminalResult(action: AiPendingActionRecord): AiActionCommandResult {
  if (action.status === "EXECUTED") {
    return { ok: true, code: "ACTION_ALREADY_EXECUTED", action: publicAction(action) };
  }
  if (action.status === "CANCELLED") {
    return { ok: true, code: "ACTION_ALREADY_CANCELLED", action: publicAction(action) };
  }
  if (action.status === "EXPIRED") {
    return { ok: false, code: "ACTION_EXPIRED", action: publicAction(action) };
  }
  if (action.status === "CONFLICTED") {
    return { ok: false, code: "ACTION_CONFLICTED", action: publicAction(action) };
  }
  if (action.status === "FAILED") {
    return { ok: false, code: "ACTION_FAILED", action: publicAction(action) };
  }
  return { ok: false, code: "ACTION_IN_PROGRESS", action: publicAction(action) };
}

async function loadOwnedAction<Transaction>(
  transaction: Transaction,
  store: AiPendingActionStore<Transaction>,
  session: AiSessionIdentity,
  actionId: string,
): Promise<
  | { ok: false; code: "UNAUTHENTICATED" | "ACTION_NOT_FOUND" }
  | { ok: true; actor: AiCanonicalActor; action: AiPendingActionRecord }
> {
  const actor = await store.findCanonicalActor(transaction, session);
  if (!actor) return { ok: false, code: "UNAUTHENTICATED" };
  const action = await store.findAction(transaction, actionId);
  if (!action || action.userId !== actor.userId) {
    return { ok: false, code: "ACTION_NOT_FOUND" };
  }
  return { ok: true, actor, action };
}

export async function prepareAiPendingAction<Transaction>(
  input: {
    session: AiSessionIdentity;
    actionType: AiActionType;
    payload: JsonObject;
    preview: AiActionPreview;
    precondition: JsonObject;
    confirmationLabel: string;
  },
  dependencies: {
    store: AiPendingActionStore<Transaction>;
    now?: () => Date;
    createIdempotencyKey: () => string;
    ttlMs?: number;
  },
): Promise<AiActionCommandResult> {
  if (!isAiActionType(input.actionType)) {
    throw new Error("Unsupported AI action type.");
  }
  assertJsonObject(input.payload, "AI action payload");
  assertJsonObject(input.precondition, "AI action precondition");
  const preview = parseAiActionPreview(input.preview);
  assertJsonObject(preview, "AI action preview");
  const riskLevel = deriveAiActionRisk(input.actionType, input.payload);
  if (
    !input.confirmationLabel.trim() ||
    input.confirmationLabel.length > 120
  ) {
    throw new Error("Invalid AI action confirmation label.");
  }

  const now = dependencies.now?.() ?? new Date();
  const ttlMs = dependencies.ttlMs ?? AI_PENDING_ACTION_TTL_MS;
  if (!Number.isInteger(ttlMs) || ttlMs < 60_000 || ttlMs > 15 * 60_000) {
    throw new Error("Invalid AI pending action TTL.");
  }

  return dependencies.store.transaction(async (transaction) => {
    const actor = await dependencies.store.findCanonicalActor(transaction, input.session);
    if (!actor) return { ok: false, code: "UNAUTHENTICATED" };
    if (!canRoleExecuteAiAction(actor.role, input.actionType)) {
      return { ok: false, code: "ACTION_FORBIDDEN" };
    }
    assertAiActionPreviewForRisk(preview, riskLevel);

    const action = await dependencies.store.createAction(transaction, {
      userId: actor.userId,
      actionType: input.actionType,
      riskLevel,
      status: "PENDING",
      payload: input.payload,
      preview,
      precondition: input.precondition,
      confirmationLabel: input.confirmationLabel.trim(),
      idempotencyKey: dependencies.createIdempotencyKey(),
      expiresAt: new Date(now.getTime() + ttlMs),
      confirmedAt: null,
      executedAt: null,
      result: null,
      failureCode: null,
    });
    return { ok: true, code: "ACTION_PREPARED", action: publicAction(action) };
  });
}

export async function confirmAiPendingAction<Transaction>(
  input: { session: AiSessionIdentity; actionId: string },
  dependencies: {
    store: AiPendingActionStore<Transaction>;
    executors: AiActionExecutorRegistry<Transaction>;
    now?: () => Date;
  },
): Promise<AiActionCommandResult> {
  const now = dependencies.now?.() ?? new Date();

  try {
    return await dependencies.store.transaction(async (transaction) => {
    const loaded = await loadOwnedAction(
      transaction,
      dependencies.store,
      input.session,
      input.actionId,
    );
    if (!loaded.ok) return { ok: false, code: loaded.code };
    let { action } = loaded;
    const { actor } = loaded;

    if (action.status !== "PENDING") return terminalResult(action);
    if (action.expiresAt.getTime() <= now.getTime()) {
      const expired = await dependencies.store.transitionAction(transaction, {
        actionId: action.id,
        userId: actor.userId,
        from: "PENDING",
        update: { status: "EXPIRED", failureCode: "ACTION_EXPIRED" },
      });
      if (expired) {
        action = applyUpdate(action, { status: "EXPIRED", failureCode: "ACTION_EXPIRED" });
        return terminalResult(action);
      }
      const latest = await dependencies.store.findAction(transaction, action.id);
      return latest ? terminalResult(latest) : { ok: false, code: "ACTION_NOT_FOUND" };
    }

    if (!canRoleExecuteAiAction(actor.role, action.actionType)) {
      return { ok: false, code: "ACTION_FORBIDDEN", action: publicAction(action) };
    }

    const executor = dependencies.executors[action.actionType];
    if (!executor || action.riskLevel === "READ" || action.riskLevel === "DESTRUCTIVE") {
      return { ok: false, code: "ACTION_UNAVAILABLE", action: publicAction(action) };
    }

    const claimed = await dependencies.store.transitionAction(transaction, {
      actionId: action.id,
      userId: actor.userId,
      from: "PENDING",
      expiresAfter: now,
      update: { status: "EXECUTING", confirmedAt: now },
    });
    if (!claimed) {
      const latest = await dependencies.store.findAction(transaction, action.id);
      return latest ? terminalResult(latest) : { ok: false, code: "ACTION_NOT_FOUND" };
    }
    action = applyUpdate(action, { status: "EXECUTING", confirmedAt: now });

    let preconditionOutcome: AiActionPreconditionOutcome;
    try {
      preconditionOutcome = await executor.checkPreconditions({ transaction, action, actor });
    } catch {
      preconditionOutcome = { kind: "CONFLICTED", code: "ACTION_PRECONDITION_CHECK_FAILED" };
    }

    if (preconditionOutcome.kind === "CONFLICTED") {
      const failureCode = preconditionOutcome.code || "ACTION_CONFLICTED";
      await dependencies.store.transitionAction(transaction, {
        actionId: action.id,
        userId: actor.userId,
        from: "EXECUTING",
        update: { status: "CONFLICTED", failureCode },
      });
      action = applyUpdate(action, { status: "CONFLICTED", failureCode });
      return terminalResult(action);
    }

    let outcome: AiActionExecutionOutcome;
    try {
      outcome = await executor.execute({ transaction, action, actor });
    } catch (error) {
      throw error instanceof AiActionExecutionRollback
        ? error
        : new AiActionExecutionRollback("FAILED", "ACTION_EXECUTOR_FAILED");
    }

    if (outcome.kind === "CONFLICTED") {
      const failureCode = outcome.code || "ACTION_CONFLICTED";
      await dependencies.store.transitionAction(transaction, {
        actionId: action.id,
        userId: actor.userId,
        from: "EXECUTING",
        update: { status: "CONFLICTED", failureCode },
      });
      action = applyUpdate(action, { status: "CONFLICTED", failureCode });
      return terminalResult(action);
    }

    if (outcome.kind === "FAILED") {
      await dependencies.store.transitionAction(transaction, {
        actionId: action.id,
        userId: actor.userId,
        from: "EXECUTING",
        update: { status: "FAILED", failureCode: outcome.code },
      });
      action = applyUpdate(action, { status: "FAILED", failureCode: outcome.code });
      return terminalResult(action);
    }

    const result = parseAiActionResult(outcome.result);
    const executed = await dependencies.store.transitionAction(transaction, {
      actionId: action.id,
      userId: actor.userId,
      from: "EXECUTING",
      update: {
        status: "EXECUTED",
        executedAt: now,
        result,
        failureCode: null,
      },
    });
    if (!executed) throw new Error("AI action execution state transition failed.");

    const auditMetadata: JsonObject = {
      source: "ai_assistant",
      aiAssisted: true,
      pendingActionId: action.id,
      actionType: action.actionType,
      riskLevel: action.riskLevel,
      idempotencyKey: action.idempotencyKey,
      ...(outcome.audit.metadata ?? {}),
    };
    assertJsonObject(auditMetadata, "AI action audit metadata");
    await dependencies.store.createActivityLog(transaction, {
      action: outcome.audit.action,
      entityType: outcome.audit.entityType,
      entityId: outcome.audit.entityId,
      userEmail: actor.email,
      metadata: auditMetadata,
    });

    action = applyUpdate(action, {
      status: "EXECUTED",
      executedAt: now,
      result,
      failureCode: null,
    });
    return { ok: true, code: "ACTION_EXECUTED", action: publicAction(action) };
    });
  } catch (error) {
    if (!(error instanceof AiActionExecutionRollback)) throw error;
    return dependencies.store.transaction(async (transaction) => {
      const loaded = await loadOwnedAction(
        transaction,
        dependencies.store,
        input.session,
        input.actionId,
      );
      if (!loaded.ok) return { ok: false, code: loaded.code };
      let { action } = loaded;
      const { actor } = loaded;
      if (action.status !== "PENDING") return terminalResult(action);
      const status = error.outcome === "CONFLICTED" ? "CONFLICTED" : "FAILED";
      const transitioned = await dependencies.store.transitionAction(transaction, {
        actionId: action.id,
        userId: actor.userId,
        from: "PENDING",
        update: { status, failureCode: error.code },
      });
      if (!transitioned) {
        const latest = await dependencies.store.findAction(transaction, action.id);
        return latest ? terminalResult(latest) : { ok: false, code: "ACTION_NOT_FOUND" };
      }
      action = applyUpdate(action, { status, failureCode: error.code });
      return terminalResult(action);
    });
  }
}

export async function cancelAiPendingAction<Transaction>(
  input: { session: AiSessionIdentity; actionId: string },
  dependencies: {
    store: AiPendingActionStore<Transaction>;
    now?: () => Date;
  },
): Promise<AiActionCommandResult> {
  const now = dependencies.now?.() ?? new Date();

  return dependencies.store.transaction(async (transaction) => {
    const loaded = await loadOwnedAction(
      transaction,
      dependencies.store,
      input.session,
      input.actionId,
    );
    if (!loaded.ok) return { ok: false, code: loaded.code };
    let { action } = loaded;
    const { actor } = loaded;

    if (action.status !== "PENDING") return terminalResult(action);
    if (action.expiresAt.getTime() <= now.getTime()) {
      const expired = await dependencies.store.transitionAction(transaction, {
        actionId: action.id,
        userId: actor.userId,
        from: "PENDING",
        update: { status: "EXPIRED", failureCode: "ACTION_EXPIRED" },
      });
      if (expired) {
        action = applyUpdate(action, { status: "EXPIRED", failureCode: "ACTION_EXPIRED" });
        return terminalResult(action);
      }
      const latest = await dependencies.store.findAction(transaction, action.id);
      return latest ? terminalResult(latest) : { ok: false, code: "ACTION_NOT_FOUND" };
    }

    const cancelled = await dependencies.store.transitionAction(transaction, {
      actionId: action.id,
      userId: actor.userId,
      from: "PENDING",
      update: { status: "CANCELLED", failureCode: null },
    });
    if (!cancelled) {
      const latest = await dependencies.store.findAction(transaction, action.id);
      return latest ? terminalResult(latest) : { ok: false, code: "ACTION_NOT_FOUND" };
    }
    action = applyUpdate(action, { status: "CANCELLED", failureCode: null });
    return { ok: true, code: "ACTION_CANCELLED", action: publicAction(action) };
  });
}
