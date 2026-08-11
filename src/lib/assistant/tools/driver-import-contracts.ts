import type { FunctionTool } from "openai/resources/responses/responses";
import { AssistantTransportError } from "../errors.ts";
import {
  type DriverImportDraftUpdateArguments,
  type DriverImportRowUpdate,
  type PrepareDriverImportArguments,
} from "../../drivers/import-core.ts";

export type ParseDriverListTextArguments = Record<string, never>;

export const parseDriverListTextTool: FunctionTool = {
  type: "function",
  name: "parse_driver_list_text",
  description: "Parse the server-validated current user message as a pasted Taxi Reserve driver list into a review-only structured draft. This never writes Driver records.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    required: [],
    properties: {},
  },
};

export const updateDriverImportDraftTool: FunctionTool = {
  type: "function",
  name: "update_driver_import_draft",
  description: "Apply explicit user corrections to the server-owned driver import draft and optionally confirm that the reviewed list is complete.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["rows", "confirm_complete"],
    properties: {
      rows: {
        type: "array",
        maxItems: 20,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["row_id", "name", "license_number", "vehicle_type"],
          properties: {
            row_id: { type: "string", minLength: 1, maxLength: 200 },
            name: { type: ["string", "null"], maxLength: 200 },
            license_number: { type: ["string", "null"], maxLength: 100 },
            vehicle_type: { type: ["string", "null"], enum: ["VAN", "SEDAN", null] },
          },
        },
      },
      confirm_complete: { type: "boolean" },
    },
  },
};

export const prepareDriverImportTool: FunctionTool = {
  type: "function",
  name: "prepare_driver_import",
  description: "Prepare one server-owned IMPORT_DRIVERS pending action from a complete reviewed driver import draft. This never writes Driver records.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["draft_id", "revision"],
    properties: {
      draft_id: { type: "string", minLength: 1, maxLength: 200 },
      revision: { type: "integer", minimum: 1 },
    },
  },
};

export const driverImportTools = [
  parseDriverListTextTool,
  updateDriverImportDraftTool,
  prepareDriverImportTool,
] satisfies FunctionTool[];

function parseObject(raw: string) {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new AssistantTransportError("TOOL_VALIDATION_FAILED");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AssistantTransportError("TOOL_VALIDATION_FAILED");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) {
    throw new AssistantTransportError("TOOL_VALIDATION_FAILED");
  }
}

export function parseParseDriverListTextArguments(raw: string): ParseDriverListTextArguments {
  const value = parseObject(raw);
  exactKeys(value, []);
  return {};
}

function nullableText(value: unknown, maximum: number) {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > maximum) {
    throw new AssistantTransportError("TOOL_VALIDATION_FAILED");
  }
  return value;
}

function parseRowUpdate(value: unknown): DriverImportRowUpdate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AssistantTransportError("TOOL_VALIDATION_FAILED");
  }
  const row = value as Record<string, unknown>;
  exactKeys(row, ["row_id", "name", "license_number", "vehicle_type"]);
  if (typeof row.row_id !== "string" || !row.row_id || row.row_id.length > 200) {
    throw new AssistantTransportError("TOOL_VALIDATION_FAILED");
  }
  if (row.vehicle_type !== null && row.vehicle_type !== "VAN" && row.vehicle_type !== "SEDAN") {
    throw new AssistantTransportError("TOOL_VALIDATION_FAILED");
  }
  return {
    row_id: row.row_id,
    name: nullableText(row.name, 200),
    license_number: nullableText(row.license_number, 100),
    vehicle_type: row.vehicle_type,
  };
}

export function parseUpdateDriverImportDraftArguments(
  raw: string,
): DriverImportDraftUpdateArguments {
  const value = parseObject(raw);
  exactKeys(value, ["rows", "confirm_complete"]);
  if (
    !Array.isArray(value.rows) ||
    value.rows.length > 20 ||
    typeof value.confirm_complete !== "boolean"
  ) throw new AssistantTransportError("TOOL_VALIDATION_FAILED");
  return {
    rows: value.rows.map(parseRowUpdate),
    confirm_complete: value.confirm_complete,
  };
}

export function parsePrepareDriverImportArguments(raw: string): PrepareDriverImportArguments {
  const value = parseObject(raw);
  exactKeys(value, ["draft_id", "revision"]);
  if (
    typeof value.draft_id !== "string" ||
    !value.draft_id ||
    value.draft_id.length > 200 ||
    !Number.isInteger(value.revision) ||
    (value.revision as number) < 1
  ) throw new AssistantTransportError("TOOL_VALIDATION_FAILED");
  return { draft_id: value.draft_id, revision: value.revision as number };
}
