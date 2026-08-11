import type { FunctionTool } from "openai/resources/responses/responses";
import {
  ASSISTANT_RESERVATION_DEFAULT_LIMIT,
  ASSISTANT_RESERVATION_MAX_LIMIT,
  type ReservationReadStatus,
  type ReservationSearchFilters,
} from "../../reservations/assistant-read-core.ts";

export type SearchReservationsToolArguments = {
  date: string | null;
  date_from: string | null;
  date_to: string | null;
  time_from: string | null;
  time_to: string | null;
  pickup: string | null;
  dropoff: string | null;
  phone: string | null;
  driver_id: string | null;
  assigned: boolean | null;
  status: ReservationReadStatus | null;
  limit: number | null;
};

export type GetReservationToolArguments = {
  reservation_id: string;
};

const nullableString = {
  type: ["string", "null"],
} as const;

export const searchReservationsTool = {
  type: "function",
  name: "search_reservations",
  description:
    "Search reservations visible to the authenticated Taxi Reserve user. Driver filters are available only when the authenticated server-side role permits them.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      date: { ...nullableString, description: "Exact Madrid service date, YYYY-MM-DD." },
      date_from: { ...nullableString, description: "Inclusive Madrid start date, YYYY-MM-DD." },
      date_to: { ...nullableString, description: "Inclusive Madrid end date, YYYY-MM-DD." },
      time_from: { ...nullableString, description: "Inclusive time, HH:mm; requires date." },
      time_to: { ...nullableString, description: "Exclusive time, HH:mm; requires date." },
      pickup: { ...nullableString, maxLength: 200 },
      dropoff: { ...nullableString, maxLength: 200 },
      phone: { ...nullableString, maxLength: 40 },
      driver_id: { ...nullableString, maxLength: 100 },
      assigned: { type: ["boolean", "null"] },
      status: {
        type: ["string", "null"],
        enum: [null, "PENDING", "ASSIGNED", "COMPLETED", "R_RECEIVED"],
      },
      limit: {
        type: ["integer", "null"],
        minimum: 1,
        maximum: ASSISTANT_RESERVATION_MAX_LIMIT,
        description: `Maximum results; defaults to ${ASSISTANT_RESERVATION_DEFAULT_LIMIT}.`,
      },
    },
    required: [
      "date",
      "date_from",
      "date_to",
      "time_from",
      "time_to",
      "pickup",
      "dropoff",
      "phone",
      "driver_id",
      "assigned",
      "status",
      "limit",
    ],
    additionalProperties: false,
  },
} satisfies FunctionTool;

export const getReservationTool = {
  type: "function",
  name: "get_reservation",
  description:
    "Retrieve one reservation only when it is visible to the authenticated Taxi Reserve user. Inaccessible records return permission-safe not-found behavior.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      reservation_id: { type: "string", minLength: 1, maxLength: 100 },
    },
    required: ["reservation_id"],
    additionalProperties: false,
  },
} satisfies FunctionTool;

export const reservationReadTools = [
  searchReservationsTool,
  getReservationTool,
] satisfies FunctionTool[];

export function toReservationSearchFilters(
  input: SearchReservationsToolArguments,
): ReservationSearchFilters {
  return {
    ...(input.date ? { serviceDate: input.date } : {}),
    ...(input.date_from ? { dateFrom: input.date_from } : {}),
    ...(input.date_to ? { dateTo: input.date_to } : {}),
    ...(input.time_from ? { timeFrom: input.time_from } : {}),
    ...(input.time_to ? { timeTo: input.time_to } : {}),
    ...(input.pickup ? { pickupQuery: input.pickup } : {}),
    ...(input.dropoff ? { dropoffQuery: input.dropoff } : {}),
    ...(input.phone ? { phone: input.phone } : {}),
    ...(input.driver_id ? { driverId: input.driver_id } : {}),
    ...(input.assigned !== null ? { assigned: input.assigned } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.limit !== null ? { limit: input.limit } : {}),
  };
}

// Reservation strings are untrusted data. Neither these contracts nor their future
// executors may interpret passenger, phone, route, or note content as instructions.
