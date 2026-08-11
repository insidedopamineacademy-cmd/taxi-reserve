export const AI_PENDING_ACTION_TTL_MS = 10 * 60 * 1_000;
// Bulk driver imports can carry up to 48 exact stale-state snapshots. Keep the
// envelope bounded while leaving room for schema-valid names, codes, and IDs.
export const AI_ACTION_MAX_JSON_BYTES = 32_768;

export const AI_ACTION_TYPES = [
  "UPDATE_RESERVATION",
  "ASSIGN_DRIVER",
  "CLEAR_DRIVER",
  "UPDATE_RESERVATION_COMMISSION",
  "ADD_MANUAL_COMMISSION",
  "RECORD_DRIVER_PAYMENT",
  "CREATE_RESERVATION",
  "IMPORT_DRIVERS",
] as const;

export const AI_ACTION_RISKS = [
  "READ",
  "WRITE",
  "FINANCIAL_WRITE",
  "DESTRUCTIVE",
] as const;

export const AI_ACTION_STATUSES = [
  "PENDING",
  "EXECUTING",
  "EXECUTED",
  "CANCELLED",
  "EXPIRED",
  "FAILED",
  "CONFLICTED",
] as const;

export type AiActionType = (typeof AI_ACTION_TYPES)[number];
export type AiActionRisk = (typeof AI_ACTION_RISKS)[number];
export type AiActionStatus = (typeof AI_ACTION_STATUSES)[number];
export type AiActorRole = "USER" | "ADMIN";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type AiActionPreviewFact = {
  label: string;
  value: string;
  previousValue?: string;
  emphasis?: "normal" | "money" | "warning";
};

export type AiActionPreview = {
  title: string;
  summary?: string;
  sections: Array<{
    heading: string;
    facts: AiActionPreviewFact[];
  }>;
  warnings?: string[];
};

export type AiActionResult = {
  title: string;
  message?: string;
  reference?: {
    label: string;
    href?: string;
  };
};

export type AiActionFailure = {
  code: string;
  message: string;
  retryable: boolean;
};

export type AiActionPublic = {
  actionId: string;
  actionType: AiActionType;
  riskLevel: AiActionRisk;
  status: AiActionStatus;
  expiresAt: string;
  preview: AiActionPreview;
  confirmationLabel: string;
  result?: AiActionResult;
  failure?: AiActionFailure;
};

const ACTION_TYPE_SET = new Set<string>(AI_ACTION_TYPES);
const ACTION_RISK_SET = new Set<string>(AI_ACTION_RISKS);
const ACTION_STATUS_SET = new Set<string>(AI_ACTION_STATUSES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function boundedText(value: unknown, maximum: number) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function isIsoTimestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function isAiActionType(value: unknown): value is AiActionType {
  return typeof value === "string" && ACTION_TYPE_SET.has(value);
}

export function isAiActionRisk(value: unknown): value is AiActionRisk {
  return typeof value === "string" && ACTION_RISK_SET.has(value);
}

export function isAiActionStatus(value: unknown): value is AiActionStatus {
  return typeof value === "string" && ACTION_STATUS_SET.has(value);
}

export function assertJsonObject(value: unknown, label: string): asserts value is JsonObject {
  const visit = (item: unknown, depth: number): item is JsonValue => {
    if (item === null || typeof item === "string" || typeof item === "boolean") return true;
    if (typeof item === "number") return Number.isFinite(item);
    if (depth >= 8) return false;
    if (Array.isArray(item)) {
      return item.length <= 100 && item.every((entry) => visit(entry, depth + 1));
    }
    if (!isRecord(item) || Object.keys(item).length > 100) return false;
    return Object.entries(item).every(
      ([key, entry]) => key.length > 0 && key.length <= 100 && visit(entry, depth + 1),
    );
  };

  if (!isRecord(value) || !visit(value, 0)) {
    throw new Error(`${label} must be a bounded JSON object.`);
  }
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > AI_ACTION_MAX_JSON_BYTES) {
    throw new Error(`${label} is too large.`);
  }
}

export function parseAiActionPreview(value: unknown): AiActionPreview {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["title", "summary", "sections", "warnings"]) ||
    !boundedText(value.title, 120) ||
    (value.summary !== undefined && !boundedText(value.summary, 500)) ||
    !Array.isArray(value.sections) ||
    value.sections.length === 0 ||
    value.sections.length > 6
  ) {
    throw new Error("Invalid AI action preview.");
  }

  for (const section of value.sections) {
    if (
      !isRecord(section) ||
      !hasOnlyKeys(section, ["heading", "facts"]) ||
      !boundedText(section.heading, 100) ||
      !Array.isArray(section.facts) ||
      section.facts.length === 0 ||
      section.facts.length > 12
    ) {
      throw new Error("Invalid AI action preview section.");
    }
    for (const fact of section.facts) {
      if (
        !isRecord(fact) ||
        !hasOnlyKeys(fact, ["label", "value", "previousValue", "emphasis"]) ||
        !boundedText(fact.label, 100) ||
        !boundedText(fact.value, 500) ||
        (fact.previousValue !== undefined && !boundedText(fact.previousValue, 500)) ||
        (fact.emphasis !== undefined &&
          fact.emphasis !== "normal" &&
          fact.emphasis !== "money" &&
          fact.emphasis !== "warning")
      ) {
        throw new Error("Invalid AI action preview fact.");
      }
    }
  }

  if (
    value.warnings !== undefined &&
    (!Array.isArray(value.warnings) ||
      value.warnings.length > 6 ||
      !value.warnings.every((warning) => boundedText(warning, 500)))
  ) {
    throw new Error("Invalid AI action preview warning.");
  }

  return value as AiActionPreview;
}

export function parseAiActionResult(value: unknown): AiActionResult {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["title", "message", "reference"]) ||
    !boundedText(value.title, 120) ||
    (value.message !== undefined && !boundedText(value.message, 500))
  ) {
    throw new Error("Invalid AI action result.");
  }
  if (value.reference !== undefined) {
    if (
      !isRecord(value.reference) ||
      !hasOnlyKeys(value.reference, ["label", "href"]) ||
      !boundedText(value.reference.label, 120) ||
      (value.reference.href !== undefined &&
        (!boundedText(value.reference.href, 500) ||
          !(value.reference.href as string).startsWith("/") ||
          (value.reference.href as string).startsWith("//")))
    ) {
      throw new Error("Invalid AI action result reference.");
    }
  }
  return value as AiActionResult;
}

export function parseAiActionPublic(value: unknown): AiActionPublic {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "actionId",
      "actionType",
      "riskLevel",
      "status",
      "expiresAt",
      "preview",
      "confirmationLabel",
      "result",
      "failure",
    ]) ||
    !boundedText(value.actionId, 200) ||
    !isAiActionType(value.actionType) ||
    !isAiActionRisk(value.riskLevel) ||
    !isAiActionStatus(value.status) ||
    !isIsoTimestamp(value.expiresAt) ||
    !boundedText(value.confirmationLabel, 120)
  ) {
    throw new Error("Invalid AI action contract.");
  }

  const preview = parseAiActionPreview(value.preview);
  const result = value.result === undefined ? undefined : parseAiActionResult(value.result);
  let failure: AiActionFailure | undefined;
  if (value.failure !== undefined) {
    if (
      !isRecord(value.failure) ||
      !hasOnlyKeys(value.failure, ["code", "message", "retryable"]) ||
      !boundedText(value.failure.code, 64) ||
      !boundedText(value.failure.message, 500) ||
      typeof value.failure.retryable !== "boolean"
    ) {
      throw new Error("Invalid AI action failure.");
    }
    failure = value.failure as AiActionFailure;
  }

  return {
    actionId: value.actionId as string,
    actionType: value.actionType,
    riskLevel: value.riskLevel,
    status: value.status,
    expiresAt: value.expiresAt as string,
    preview,
    confirmationLabel: value.confirmationLabel as string,
    ...(result ? { result } : {}),
    ...(failure ? { failure } : {}),
  };
}

export function deriveAiActionRisk(actionType: AiActionType, payload: JsonObject): AiActionRisk {
  if (
    actionType === "UPDATE_RESERVATION_COMMISSION" ||
    actionType === "ADD_MANUAL_COMMISSION" ||
    actionType === "RECORD_DRIVER_PAYMENT"
  ) {
    return "FINANCIAL_WRITE";
  }
  if (
    actionType === "ASSIGN_DRIVER" &&
    ("commissionAmount" in payload || payload.changesCommission === true)
  ) {
    return "FINANCIAL_WRITE";
  }
  if (actionType === "CLEAR_DRIVER" && payload.removesCommission === true) {
    return "FINANCIAL_WRITE";
  }
  return "WRITE";
}

export function assertAiActionPreviewForRisk(
  preview: AiActionPreview,
  risk: AiActionRisk,
) {
  if (risk !== "FINANCIAL_WRITE") return;
  const visibleLabels = [
    preview.title,
    ...preview.sections.flatMap((section) => [
      section.heading,
      ...section.facts.map((fact) => fact.label),
    ]),
  ]
    .join(" ")
    .toLowerCase();
  const requiredContext = ["driver", "amount", "date", "reservation"];
  if (
    requiredContext.some((label) => !visibleLabels.includes(label)) ||
    !/(payment|commission|assign)/.test(visibleLabels)
  ) {
    throw new Error(
      "Financial action previews must show the driver, amount, type, date, and reservation context.",
    );
  }
}

export function canRoleExecuteAiAction(role: AiActorRole, actionType: AiActionType) {
  if (actionType === "UPDATE_RESERVATION" || actionType === "CREATE_RESERVATION") {
    return role === "USER" || role === "ADMIN";
  }
  return role === "ADMIN";
}

export function failureForAiAction(status: AiActionStatus, code?: string | null): AiActionFailure | undefined {
  if (status === "EXPIRED") {
    return {
      code: "ACTION_EXPIRED",
      message: "This action expired. Please create a new proposal.",
      retryable: false,
    };
  }
  if (status === "CONFLICTED") {
    return {
      code: code || "ACTION_CONFLICTED",
      message: "This record changed since the preview was created. Review the updated details before confirming.",
      retryable: false,
    };
  }
  if (status === "FAILED") {
    return {
      code: code || "ACTION_EXECUTION_FAILED",
      message: "The action could not be completed. No retry was performed automatically.",
      retryable: false,
    };
  }
  if (status === "EXECUTING") {
    return {
      code: "ACTION_IN_PROGRESS",
      message: "This action is already being confirmed.",
      retryable: true,
    };
  }
  return undefined;
}
