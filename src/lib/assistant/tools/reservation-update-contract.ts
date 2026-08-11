import type { FunctionTool } from "openai/resources/responses/responses";
import { AssistantTransportError } from "../errors.ts";
import type { PrepareReservationUpdateArguments } from "../../reservations/update-core.ts";

const PREPARE_UPDATE_KEYS = [
  "reservation_id",
  "pickup",
  "dropoff",
  "service_date",
  "pickup_time",
  "end_date",
  "end_time",
  "passengers",
  "phone",
  "flight",
  "notes",
] as const;

const nullableString = { type: ["string", "null"] } as const;

export const prepareUpdateReservationTool = {
  type: "function",
  name: "prepare_update_reservation",
  description:
    "Prepare, but do not execute, an exact reservation update for user confirmation. Only pickup, drop-off, Madrid date/time, passengers, phone, flight, and notes are allowed. Use an exact reservation ID returned by a read tool.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      reservation_id: {
        type: "string",
        minLength: 1,
        maxLength: 100,
        description: "Exact reservation ID returned by get_reservation or search_reservations.",
      },
      pickup: { ...nullableString, maxLength: 500, description: "New pickup text; null means unchanged and an empty string clears it." },
      dropoff: { ...nullableString, maxLength: 500, description: "New drop-off text; null means unchanged and an empty string clears it." },
      service_date: { ...nullableString, maxLength: 10, description: "New Europe/Madrid service date, YYYY-MM-DD; supply with pickup_time or use null for unchanged." },
      pickup_time: { ...nullableString, maxLength: 5, description: "New Europe/Madrid pickup time, HH:mm; supply with service_date or use null for unchanged." },
      end_date: { ...nullableString, maxLength: 10, description: "New Europe/Madrid end date; supply with end_time. Both null mean unchanged; both empty strings clear end time." },
      end_time: { ...nullableString, maxLength: 5, description: "New Europe/Madrid end time; supply with end_date. Both null mean unchanged; both empty strings clear end time." },
      passengers: { type: ["integer", "null"], minimum: 1, maximum: 99, description: "New passenger count or null when unchanged." },
      phone: { ...nullableString, maxLength: 40, description: "New phone text; null means unchanged and an empty string clears it." },
      flight: { ...nullableString, maxLength: 40, description: "New flight text; null means unchanged and an empty string clears it." },
      notes: { ...nullableString, maxLength: 2000, description: "New plain-text notes; null means unchanged and an empty string clears them." },
    },
    required: [...PREPARE_UPDATE_KEYS],
    additionalProperties: false,
  },
} satisfies FunctionTool;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nullableText(value: unknown, maximum: number) {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > maximum) {
    throw new AssistantTransportError("TOOL_VALIDATION_FAILED");
  }
  return value;
}

export function parsePrepareUpdateReservationArguments(
  raw: string,
): PrepareReservationUpdateArguments {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new AssistantTransportError("TOOL_VALIDATION_FAILED");
  }
  if (!isRecord(value)) throw new AssistantTransportError("TOOL_VALIDATION_FAILED");
  if (
    Object.keys(value).length !== PREPARE_UPDATE_KEYS.length ||
    PREPARE_UPDATE_KEYS.some((key) => !(key in value))
  ) {
    throw new AssistantTransportError("TOOL_VALIDATION_FAILED");
  }
  if (
    typeof value.reservation_id !== "string" ||
    !value.reservation_id.trim() ||
    value.reservation_id.length > 100
  ) {
    throw new AssistantTransportError("TOOL_VALIDATION_FAILED");
  }
  if (
    value.passengers !== null &&
    (!Number.isInteger(value.passengers) ||
      (value.passengers as number) < 1 ||
      (value.passengers as number) > 99)
  ) {
    throw new AssistantTransportError("TOOL_VALIDATION_FAILED");
  }

  return {
    reservation_id: value.reservation_id,
    pickup: nullableText(value.pickup, 500),
    dropoff: nullableText(value.dropoff, 500),
    service_date: nullableText(value.service_date, 10),
    pickup_time: nullableText(value.pickup_time, 5),
    end_date: nullableText(value.end_date, 10),
    end_time: nullableText(value.end_time, 5),
    passengers: value.passengers as number | null,
    phone: nullableText(value.phone, 40),
    flight: nullableText(value.flight, 40),
    notes: nullableText(value.notes, 2000),
  };
}
