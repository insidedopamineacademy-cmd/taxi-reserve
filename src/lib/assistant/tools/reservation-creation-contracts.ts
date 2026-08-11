import type { FunctionTool } from "openai/resources/responses/responses";
import { AssistantTransportError } from "../errors.ts";
import {
  RESERVATION_BOOKING_TEXT_MAX_LENGTH,
  type PrepareCreateReservationArguments,
  type ReservationDraftUpdateArguments,
} from "../../reservations/reservation-draft-core.ts";

export type ParseReservationTextArguments = { booking_text: string };

const nullableText = (maximum: number, description: string) => ({
  type: ["string", "null"],
  maxLength: maximum,
  description,
}) as const;

export const parseReservationTextTool = {
  type: "function",
  name: "parse_reservation_text",
  description:
    "Parse pasted Taxi Reserve WhatsApp booking text into a bounded structured draft. This never creates or edits a reservation.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      booking_text: {
        type: "string",
        minLength: 1,
        maxLength: RESERVATION_BOOKING_TEXT_MAX_LENGTH,
        description: "The exact pasted text from the current user message.",
      },
    },
    required: ["booking_text"],
    additionalProperties: false,
  },
} satisfies FunctionTool;

export const updateReservationDraftTool = {
  type: "function",
  name: "update_reservation_draft",
  description:
    "Apply only explicit user clarifications to the current server-owned reservation draft. Null means unchanged. Empty optional text means explicitly none.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      pickup: nullableText(500, "Explicit corrected pickup, or null when unchanged."),
      dropoff: nullableText(500, "Explicit corrected drop-off, or null when unchanged."),
      phone: nullableText(40, "Explicit phone, empty for none, or null when unchanged."),
      service_date: nullableText(10, "Explicit YYYY-MM-DD date, or null when unchanged."),
      pickup_time: nullableText(5, "Explicit HH:mm Europe/Madrid time, or null when unchanged."),
      passengers: {
        type: ["integer", "null"],
        minimum: 1,
        maximum: 99,
        description: "Explicit passenger count, or null when unchanged.",
      },
      price_euro: {
        type: ["number", "null"],
        description: "Explicit agreed EUR price, or null when unchanged/not supplied.",
      },
      flight: nullableText(40, "Explicit flight, empty for none, or null when unchanged."),
      notes: nullableText(2000, "Explicit complete notes, empty for none, or null when unchanged."),
      confirm_complete: {
        type: "boolean",
        description: "True only when the user explicitly confirms the shown draft is complete and correct.",
      },
      acknowledge_duplicate: {
        type: "boolean",
        description: "True only when the user explicitly chooses to continue after a duplicate warning.",
      },
    },
    required: [
      "pickup",
      "dropoff",
      "phone",
      "service_date",
      "pickup_time",
      "passengers",
      "price_euro",
      "flight",
      "notes",
      "confirm_complete",
      "acknowledge_duplicate",
    ],
    additionalProperties: false,
  },
} satisfies FunctionTool;

export const prepareCreateReservationTool = {
  type: "function",
  name: "prepare_create_reservation",
  description:
    "Prepare a confirmed, complete server-owned reservation draft for explicit Confirm & Create. This never creates the reservation during the model turn.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      pickup: { type: "string", minLength: 1, maxLength: 500 },
      dropoff: { type: "string", minLength: 1, maxLength: 500 },
      service_date: { type: "string", minLength: 10, maxLength: 10 },
      pickup_time: { type: "string", minLength: 5, maxLength: 5 },
      passengers: { type: "integer", minimum: 1, maximum: 99 },
      price_euro: { type: ["number", "null"] },
      phone: nullableText(40, "Phone or null."),
      flight: nullableText(40, "Flight or null."),
      notes: nullableText(2000, "Notes or null."),
    },
    required: [
      "pickup",
      "dropoff",
      "service_date",
      "pickup_time",
      "passengers",
      "price_euro",
      "phone",
      "flight",
      "notes",
    ],
    additionalProperties: false,
  },
} satisfies FunctionTool;

export const reservationCreationTools = [
  parseReservationTextTool,
  updateReservationDraftTool,
  prepareCreateReservationTool,
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
  if (Object.keys(object).length !== keys.length || keys.some((key) => !(key in object))) {
    throw new AssistantTransportError("TOOL_VALIDATION_FAILED");
  }
  return object;
}

function nullableString(value: unknown, maximum: number) {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > maximum) {
    throw new AssistantTransportError("TOOL_VALIDATION_FAILED");
  }
  return value;
}

function integerOrNull(value: unknown) {
  if (value === null) return null;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 99) {
    throw new AssistantTransportError("TOOL_VALIDATION_FAILED");
  }
  return value as number;
}

function numberOrNull(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new AssistantTransportError("TOOL_VALIDATION_FAILED");
  }
  return value;
}

export function parseParseReservationTextArguments(raw: string): ParseReservationTextArguments {
  const value = parseObject(raw, ["booking_text"]);
  if (
    typeof value.booking_text !== "string" ||
    !value.booking_text.trim() ||
    value.booking_text.length > RESERVATION_BOOKING_TEXT_MAX_LENGTH
  ) {
    throw new AssistantTransportError("TOOL_VALIDATION_FAILED");
  }
  return { booking_text: value.booking_text };
}

const updateKeys = [
  "pickup",
  "dropoff",
  "phone",
  "service_date",
  "pickup_time",
  "passengers",
  "price_euro",
  "flight",
  "notes",
  "confirm_complete",
  "acknowledge_duplicate",
] as const;

export function parseUpdateReservationDraftArguments(
  raw: string,
): ReservationDraftUpdateArguments {
  const value = parseObject(raw, updateKeys);
  if (typeof value.confirm_complete !== "boolean" || typeof value.acknowledge_duplicate !== "boolean") {
    throw new AssistantTransportError("TOOL_VALIDATION_FAILED");
  }
  return {
    pickup: nullableString(value.pickup, 500),
    dropoff: nullableString(value.dropoff, 500),
    phone: nullableString(value.phone, 40),
    service_date: nullableString(value.service_date, 10),
    pickup_time: nullableString(value.pickup_time, 5),
    passengers: integerOrNull(value.passengers),
    price_euro: numberOrNull(value.price_euro),
    flight: nullableString(value.flight, 40),
    notes: nullableString(value.notes, 2000),
    confirm_complete: value.confirm_complete,
    acknowledge_duplicate: value.acknowledge_duplicate,
  };
}

const prepareKeys = [
  "pickup",
  "dropoff",
  "service_date",
  "pickup_time",
  "passengers",
  "price_euro",
  "phone",
  "flight",
  "notes",
] as const;

export function parsePrepareCreateReservationArguments(
  raw: string,
): PrepareCreateReservationArguments {
  const value = parseObject(raw, prepareKeys);
  const pickup = nullableString(value.pickup, 500);
  const dropoff = nullableString(value.dropoff, 500);
  const serviceDate = nullableString(value.service_date, 10);
  const pickupTime = nullableString(value.pickup_time, 5);
  const passengers = integerOrNull(value.passengers);
  if (!pickup?.trim() || !dropoff?.trim() || !serviceDate || !pickupTime || passengers === null) {
    throw new AssistantTransportError("TOOL_VALIDATION_FAILED");
  }
  return {
    pickup,
    dropoff,
    service_date: serviceDate,
    pickup_time: pickupTime,
    passengers,
    price_euro: numberOrNull(value.price_euro),
    phone: nullableString(value.phone, 40),
    flight: nullableString(value.flight, 40),
    notes: nullableString(value.notes, 2000),
  };
}
