import type { FunctionTool } from "openai/resources/responses/responses";
import { AssistantTransportError } from "../errors.ts";
import {
  ASSISTANT_DRIVER_MAX_LIMIT,
  ASSISTANT_DRIVER_TRANSACTION_MAX_LIMIT,
  type AssistantBalancePosition,
  type AssistantDriverSearchFilters,
  type AssistantDriverStatus,
  type AssistantDriverTransactionFilters,
  type AssistantDriverTransactionType,
} from "../../drivers/assistant-finance-core.ts";

export type SearchDriversToolArguments = {
  query: string | null;
  status: "ANY" | AssistantDriverStatus;
  vehicle_type: "ANY" | "VAN" | "SEDAN" | "UNSPECIFIED";
  balance_position: "ANY" | AssistantBalancePosition;
  limit: number | null;
  cursor: string | null;
};

export type GetDriverLedgerSummaryToolArguments = { driver_id: string };

export type GetDriverTransactionsToolArguments = {
  driver_id: string;
  transaction_type: AssistantDriverTransactionType;
  from_date: string | null;
  to_date: string | null;
  limit: number | null;
  cursor: string | null;
};

const nullableString = { type: ["string", "null"] } as const;

export const searchDriversTool = {
  type: "function",
  name: "search_drivers",
  description:
    "ADMIN only. Search the Taxi Reserve driver directory and server-calculated EUR balance positions with bounded pagination.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      query: { ...nullableString, maxLength: 100, description: "Driver name or license fragment." },
      status: { type: "string", enum: ["ANY", "ACTIVE", "INACTIVE"] },
      vehicle_type: { type: "string", enum: ["ANY", "VAN", "SEDAN", "UNSPECIFIED"] },
      balance_position: { type: "string", enum: ["ANY", "DUE", "SETTLED", "CREDIT"] },
      limit: { type: ["integer", "null"], minimum: 1, maximum: ASSISTANT_DRIVER_MAX_LIMIT },
      cursor: { ...nullableString, maxLength: 32 },
    },
    required: ["query", "status", "vehicle_type", "balance_position", "limit", "cursor"],
    additionalProperties: false,
  },
} satisfies FunctionTool;

export const getDriverLedgerSummaryTool = {
  type: "function",
  name: "get_driver_ledger_summary",
  description:
    "ADMIN only. Get canonical commission, payment, subscription-charge, and balance totals for one driver in EUR.",
  strict: true,
  parameters: {
    type: "object",
    properties: { driver_id: { type: "string", minLength: 1, maxLength: 100 } },
    required: ["driver_id"],
    additionalProperties: false,
  },
} satisfies FunctionTool;

export const getDriverTransactionsTool = {
  type: "function",
  name: "get_driver_transactions",
  description:
    "ADMIN only. Read a bounded page of typed driver commission, payment, or subscription transactions and deterministic period totals.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      driver_id: { type: "string", minLength: 1, maxLength: 100 },
      transaction_type: { type: "string", enum: ["ALL", "COMMISSION", "PAYMENT", "SUBSCRIPTION"] },
      from_date: { ...nullableString, description: "Inclusive financial civil date, YYYY-MM-DD." },
      to_date: { ...nullableString, description: "Inclusive financial civil date, YYYY-MM-DD." },
      limit: { type: ["integer", "null"], minimum: 1, maximum: ASSISTANT_DRIVER_TRANSACTION_MAX_LIMIT },
      cursor: { ...nullableString, maxLength: 32 },
    },
    required: ["driver_id", "transaction_type", "from_date", "to_date", "limit", "cursor"],
    additionalProperties: false,
  },
} satisfies FunctionTool;

export const driverFinanceTools = [
  searchDriversTool,
  getDriverLedgerSummaryTool,
  getDriverTransactionsTool,
] satisfies FunctionTool[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseObject(raw: string, keys: readonly string[]) {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new AssistantTransportError("TOOL_VALIDATION_FAILED");
  }
  if (!isRecord(value)) throw new AssistantTransportError("TOOL_VALIDATION_FAILED");
  if (Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) {
    throw new AssistantTransportError("TOOL_VALIDATION_FAILED");
  }
  return value;
}

function stringValue(value: unknown, maximum: number, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new AssistantTransportError("TOOL_VALIDATION_FAILED");
  }
  return value;
}

function optionalQuery(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 100) {
    throw new AssistantTransportError("TOOL_VALIDATION_FAILED");
  }
  return value;
}

function nullableLimit(value: unknown, maximum: number) {
  if (value === null) return null;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new AssistantTransportError("TOOL_VALIDATION_FAILED");
  }
  return value as number;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new AssistantTransportError("TOOL_VALIDATION_FAILED");
  }
  return value as T;
}

export function parseSearchDriversArguments(raw: string): SearchDriversToolArguments {
  const value = parseObject(raw, ["query", "status", "vehicle_type", "balance_position", "limit", "cursor"]);
  return {
    query: optionalQuery(value.query),
    status: enumValue(value.status, ["ANY", "ACTIVE", "INACTIVE"]),
    vehicle_type: enumValue(value.vehicle_type, ["ANY", "VAN", "SEDAN", "UNSPECIFIED"]),
    balance_position: enumValue(value.balance_position, ["ANY", "DUE", "SETTLED", "CREDIT"]),
    limit: nullableLimit(value.limit, ASSISTANT_DRIVER_MAX_LIMIT),
    cursor: value.cursor === null ? null : stringValue(value.cursor, 32),
  };
}

export function parseGetDriverLedgerSummaryArguments(raw: string): GetDriverLedgerSummaryToolArguments {
  const value = parseObject(raw, ["driver_id"]);
  return { driver_id: stringValue(value.driver_id, 100) as string };
}

export function parseGetDriverTransactionsArguments(raw: string): GetDriverTransactionsToolArguments {
  const value = parseObject(raw, ["driver_id", "transaction_type", "from_date", "to_date", "limit", "cursor"]);
  return {
    driver_id: stringValue(value.driver_id, 100) as string,
    transaction_type: enumValue(value.transaction_type, ["ALL", "COMMISSION", "PAYMENT", "SUBSCRIPTION"]),
    from_date: value.from_date === null ? null : stringValue(value.from_date, 10),
    to_date: value.to_date === null ? null : stringValue(value.to_date, 10),
    limit: nullableLimit(value.limit, ASSISTANT_DRIVER_TRANSACTION_MAX_LIMIT),
    cursor: value.cursor === null ? null : stringValue(value.cursor, 32),
  };
}

export function toAssistantDriverSearchFilters(
  input: SearchDriversToolArguments,
): AssistantDriverSearchFilters {
  return {
    ...(input.query?.trim() ? { query: input.query.trim() } : {}),
    ...(input.status !== "ANY" ? { status: input.status } : {}),
    ...(input.vehicle_type !== "ANY" ? { vehicleType: input.vehicle_type } : {}),
    ...(input.balance_position !== "ANY" ? { balancePosition: input.balance_position } : {}),
    ...(input.limit !== null ? { limit: input.limit } : {}),
    ...(input.cursor ? { cursor: input.cursor } : {}),
  };
}

export function toAssistantDriverTransactionFilters(
  input: GetDriverTransactionsToolArguments,
): AssistantDriverTransactionFilters {
  return {
    driverId: input.driver_id,
    transactionType: input.transaction_type,
    ...(input.from_date ? { fromDate: input.from_date } : {}),
    ...(input.to_date ? { toDate: input.to_date } : {}),
    ...(input.limit !== null ? { limit: input.limit } : {}),
    ...(input.cursor ? { cursor: input.cursor } : {}),
  };
}
