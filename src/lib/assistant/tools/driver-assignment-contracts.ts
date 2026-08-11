import type { FunctionTool } from "openai/resources/responses/responses";
import { AssistantTransportError } from "../errors.ts";

export type PrepareAssignDriverArguments = {
  reservation_id: string;
  driver_id: string;
};

export type PrepareClearDriverArguments = {
  reservation_id: string;
};

export const prepareAssignDriverTool = {
  type: "function",
  name: "prepare_assign_driver",
  description:
    "ADMIN only. Prepare, but do not execute, assignment of one exact ACTIVE driver to one exact owned reservation for confirmation. Does not create, move, edit, or remove commissions.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      reservation_id: {
        type: "string",
        minLength: 1,
        maxLength: 100,
        description: "Exact reservation ID returned by a reservation read tool.",
      },
      driver_id: {
        type: "string",
        minLength: 1,
        maxLength: 100,
        description: "Exact ACTIVE driver ID returned by an unambiguous driver search.",
      },
    },
    required: ["reservation_id", "driver_id"],
    additionalProperties: false,
  },
} satisfies FunctionTool;

export const prepareClearDriverTool = {
  type: "function",
  name: "prepare_clear_driver",
  description:
    "ADMIN only. Prepare, but do not execute, removal of the current driver from one exact owned reservation for confirmation. Does not remove or otherwise change commissions.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      reservation_id: {
        type: "string",
        minLength: 1,
        maxLength: 100,
        description: "Exact reservation ID returned by a reservation read tool.",
      },
    },
    required: ["reservation_id"],
    additionalProperties: false,
  },
} satisfies FunctionTool;

export const driverAssignmentPrepareTools = [
  prepareAssignDriverTool,
  prepareClearDriverTool,
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

function exactId(value: unknown) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 100
  ) {
    throw new AssistantTransportError("TOOL_VALIDATION_FAILED");
  }
  return value;
}

export function parsePrepareAssignDriverArguments(
  raw: string,
): PrepareAssignDriverArguments {
  const value = parseObject(raw, ["reservation_id", "driver_id"]);
  return {
    reservation_id: exactId(value.reservation_id),
    driver_id: exactId(value.driver_id),
  };
}

export function parsePrepareClearDriverArguments(
  raw: string,
): PrepareClearDriverArguments {
  const value = parseObject(raw, ["reservation_id"]);
  return { reservation_id: exactId(value.reservation_id) };
}
