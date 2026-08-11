import type { FunctionTool } from "openai/resources/responses/responses";
import { AssistantTransportError } from "../errors.ts";

export type PrepareAssignDriverWithCommissionArguments = {
  reservation_id: string;
  driver_id: string;
  commission_amount: string;
};

export type PrepareUpdateReservationCommissionArguments = {
  reservation_id: string;
  commission_amount: string;
};

export type PrepareClearDriverAndCommissionArguments = {
  reservation_id: string;
};

const idSchema = {
  type: "string",
  minLength: 1,
  maxLength: 100,
} as const;

const commissionAmountSchema = {
  type: "string",
  minLength: 1,
  maxLength: 20,
  description:
    "Explicit positive EUR commission amount requested by the user, with no more than two decimal places. The server normalizes it to a fixed two-decimal string.",
} as const;

export const prepareAssignDriverWithCommissionTool = {
  type: "function",
  name: "prepare_assign_driver_with_commission",
  description:
    "ADMIN only. Prepare, but do not execute, an atomic exact-driver assignment plus reservation-linked commission create, move, or update for confirmation.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      reservation_id: {
        ...idSchema,
        description: "Exact reservation ID returned by a reservation read tool.",
      },
      driver_id: {
        ...idSchema,
        description: "Exact ACTIVE driver ID returned by an unambiguous driver search.",
      },
      commission_amount: commissionAmountSchema,
    },
    required: ["reservation_id", "driver_id", "commission_amount"],
    additionalProperties: false,
  },
} satisfies FunctionTool;

export const prepareUpdateReservationCommissionTool = {
  type: "function",
  name: "prepare_update_reservation_commission",
  description:
    "ADMIN only. Prepare, but do not execute, an amount update to the existing reservation-linked commission for the reservation's current driver.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      reservation_id: {
        ...idSchema,
        description: "Exact reservation ID returned by a reservation read tool.",
      },
      commission_amount: commissionAmountSchema,
    },
    required: ["reservation_id", "commission_amount"],
    additionalProperties: false,
  },
} satisfies FunctionTool;

export const prepareClearDriverAndCommissionTool = {
  type: "function",
  name: "prepare_clear_driver_and_commission",
  description:
    "ADMIN only. Prepare, but do not execute, atomic removal of both the current driver and the existing reservation-linked commission.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      reservation_id: {
        ...idSchema,
        description: "Exact reservation ID returned by a reservation read tool.",
      },
    },
    required: ["reservation_id"],
    additionalProperties: false,
  },
} satisfies FunctionTool;

export const commissionAwareAssignmentPrepareTools = [
  prepareAssignDriverWithCommissionTool,
  prepareUpdateReservationCommissionTool,
  prepareClearDriverAndCommissionTool,
] satisfies FunctionTool[];

function parseObject(raw: string, keys: readonly string[]) {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new AssistantTransportError("TOOL_VALIDATION_FAILED");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AssistantTransportError("TOOL_VALIDATION_FAILED");
  }
  const object = value as Record<string, unknown>;
  if (
    Object.keys(object).length !== keys.length ||
    keys.some((key) => !(key in object))
  ) {
    throw new AssistantTransportError("TOOL_VALIDATION_FAILED");
  }
  return object;
}

function exactText(value: unknown, maximum: number) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new AssistantTransportError("TOOL_VALIDATION_FAILED");
  }
  return value;
}

export function parsePrepareAssignDriverWithCommissionArguments(
  raw: string,
): PrepareAssignDriverWithCommissionArguments {
  const value = parseObject(raw, [
    "reservation_id",
    "driver_id",
    "commission_amount",
  ]);
  return {
    reservation_id: exactText(value.reservation_id, 100),
    driver_id: exactText(value.driver_id, 100),
    commission_amount: exactText(value.commission_amount, 20),
  };
}

export function parsePrepareUpdateReservationCommissionArguments(
  raw: string,
): PrepareUpdateReservationCommissionArguments {
  const value = parseObject(raw, ["reservation_id", "commission_amount"]);
  return {
    reservation_id: exactText(value.reservation_id, 100),
    commission_amount: exactText(value.commission_amount, 20),
  };
}

export function parsePrepareClearDriverAndCommissionArguments(
  raw: string,
): PrepareClearDriverAndCommissionArguments {
  const value = parseObject(raw, ["reservation_id"]);
  return { reservation_id: exactText(value.reservation_id, 100) };
}
