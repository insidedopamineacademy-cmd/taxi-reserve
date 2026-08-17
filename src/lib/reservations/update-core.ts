import {
  formatMadridDate,
  formatMadridTime,
  isCalendarDate,
  isClockTime,
  madridDateTimeToInstant,
} from "../time/madrid.ts";

export const RESERVATION_UPDATE_FIELDS = [
  "pickupText",
  "dropoffText",
  "startAt",
  "endAt",
  "pax",
  "phone",
  "flight",
  "notes",
] as const;

export type ReservationUpdateField = (typeof RESERVATION_UPDATE_FIELDS)[number];

export type ReservationUpdateSnapshot = {
  id: string;
  userEmail: string;
  isDeleted: boolean;
  updatedAt: Date;
  pickupText: string | null;
  dropoffText: string | null;
  startAt: Date;
  endAt: Date | null;
  pax: number;
  phone: string | null;
  flight: string | null;
  notes: string | null;
};

export type ReservationUpdatePatch = Partial<{
  pickupText: string | null;
  dropoffText: string | null;
  startAt: Date;
  endAt: Date | null;
  pax: number;
  phone: string | null;
  flight: string | null;
  notes: string | null;
}>;

export type PrepareReservationUpdateArguments = {
  reservation_id: string;
  pickup: string | null;
  dropoff: string | null;
  service_date: string | null;
  pickup_time: string | null;
  end_date: string | null;
  end_time: string | null;
  passengers: number | null;
  phone: string | null;
  flight: string | null;
  notes: string | null;
};

export class ReservationUpdateInputError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "ReservationUpdateInputError";
  }
}

function normalizedText(value: unknown, maximum: number) {
  return String(value ?? "").slice(0, maximum) || null;
}

function parseDate(value: unknown, field: string) {
  if (typeof value !== "string" && typeof value !== "number" && !(value instanceof Date)) {
    throw new ReservationUpdateInputError(`Invalid ${field}.`, field);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new ReservationUpdateInputError(`Invalid ${field}.`, field);
  }
  return parsed;
}

function parseStoredDate(value: unknown, field: string) {
  const parsed = parseDate(value, field);
  if (typeof value !== "string" || parsed.toISOString() !== value) {
    throw new ReservationUpdateInputError(`Invalid stored ${field}.`, field);
  }
  return parsed;
}

function parsePassengers(value: unknown) {
  const passengers = Number(value);
  if (!Number.isInteger(passengers) || passengers < 1 || passengers > 99) {
    throw new ReservationUpdateInputError(
      "Passengers must be an integer between 1 and 99.",
      "passengers",
    );
  }
  return passengers;
}

function madridInstant(date: string, time: string, label: string) {
  if (!isCalendarDate(date) || !isClockTime(time)) {
    throw new ReservationUpdateInputError(
      `${label} must use a valid date and time.`,
      label,
    );
  }
  const instant = madridDateTimeToInstant(date, time);
  // date-fns-tz resolves a nonexistent spring-forward time to another local
  // clock value. A round trip makes that DST gap an explicit validation error.
  if (formatMadridDate(instant) !== date || formatMadridTime(instant) !== time) {
    throw new ReservationUpdateInputError(
      `${label} does not exist in Europe/Madrid because of a clock change.`,
      label,
    );
  }
  return instant;
}

function sameValue(left: ReservationUpdateSnapshot[ReservationUpdateField], right: unknown) {
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() === right.getTime();
  }
  return left === right;
}

export function parseReservationUiUpdate(body: Record<string, unknown>) {
  const patch: ReservationUpdatePatch = {};

  if ("pickupText" in body) patch.pickupText = normalizedText(body.pickupText, 500);
  if ("dropoffText" in body) patch.dropoffText = normalizedText(body.dropoffText, 500);
  if ("startAt" in body) patch.startAt = parseDate(body.startAt, "startAt");
  if ("endAt" in body) {
    patch.endAt = body.endAt ? parseDate(body.endAt, "endAt") : null;
  }
  if ("pax" in body) patch.pax = parsePassengers(body.pax);
  if ("phone" in body) patch.phone = normalizedText(body.phone, 40);
  if ("flight" in body) patch.flight = normalizedText(body.flight, 40);
  if ("notes" in body) patch.notes = normalizedText(body.notes, 2000);

  return patch;
}

export function buildReservationAssistantPatch(
  current: ReservationUpdateSnapshot,
  input: PrepareReservationUpdateArguments,
) {
  const proposed: ReservationUpdatePatch = {};

  if (input.pickup !== null) proposed.pickupText = normalizedText(input.pickup, 500);
  if (input.dropoff !== null) proposed.dropoffText = normalizedText(input.dropoff, 500);

  const changesStart = input.service_date !== null || input.pickup_time !== null;
  if (changesStart) {
    if (input.service_date === null || input.pickup_time === null) {
      throw new ReservationUpdateInputError(
        "service_date and pickup_time must be supplied together.",
        "startAt",
      );
    }
    proposed.startAt = madridInstant(input.service_date, input.pickup_time, "startAt");
  }

  const changesEnd = input.end_date !== null || input.end_time !== null;
  if (changesEnd) {
    if (input.end_date === "" && input.end_time === "") {
      proposed.endAt = null;
    } else {
      if (!input.end_date || !input.end_time) {
        throw new ReservationUpdateInputError(
          "end_date and end_time must be supplied together, or both may be empty to clear the end time.",
          "endAt",
        );
      }
      proposed.endAt = madridInstant(input.end_date, input.end_time, "endAt");
    }
  }

  if (input.passengers !== null) proposed.pax = parsePassengers(input.passengers);
  if (input.phone !== null) proposed.phone = normalizedText(input.phone, 40);
  if (input.flight !== null) proposed.flight = normalizedText(input.flight, 40);
  if (input.notes !== null) proposed.notes = normalizedText(input.notes, 2000);

  const patch: ReservationUpdatePatch = {};
  for (const field of RESERVATION_UPDATE_FIELDS) {
    if (field in proposed && !sameValue(current[field], proposed[field])) {
      Object.assign(patch, { [field]: proposed[field] });
    }
  }
  return patch;
}

export function reservationUpdateChangedFields(patch: ReservationUpdatePatch) {
  return RESERVATION_UPDATE_FIELDS.filter((field) => field in patch);
}

export function assertReservationUpdatePatch(
  value: unknown,
): asserts value is ReservationUpdatePatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ReservationUpdateInputError("Reservation changes must be an object.");
  }
  const patch = value as Record<string, unknown>;
  if (
    Object.keys(patch).some(
      (key) => !RESERVATION_UPDATE_FIELDS.includes(key as ReservationUpdateField),
    )
  ) {
    throw new ReservationUpdateInputError("The reservation update contains a forbidden field.");
  }
  for (const field of Object.keys(patch) as ReservationUpdateField[]) {
    const item = patch[field];
    if (field === "startAt") {
      if (!(item instanceof Date) || !Number.isFinite(item.getTime())) {
        throw new ReservationUpdateInputError("Invalid startAt.", field);
      }
    } else if (field === "endAt") {
      if (item !== null && (!(item instanceof Date) || !Number.isFinite(item.getTime()))) {
        throw new ReservationUpdateInputError("Invalid endAt.", field);
      }
    } else if (field === "pax") {
      parsePassengers(item);
    } else {
      const maximum = field === "notes"
        ? 2000
        : field === "pickupText" || field === "dropoffText"
          ? 500
          : 40;
      if (
        item !== null &&
        (typeof item !== "string" || item.length === 0 || item.length > maximum)
      ) {
        throw new ReservationUpdateInputError(`Invalid ${field}.`, field);
      }
    }
  }
}

export function serializeReservationUpdateValue(
  value: ReservationUpdateSnapshot[ReservationUpdateField],
) {
  return value instanceof Date ? value.toISOString() : value;
}

export function reservationUpdateBeforeValues(
  current: ReservationUpdateSnapshot,
  fields: readonly ReservationUpdateField[],
) {
  return Object.fromEntries(
    fields.map((field) => [field, serializeReservationUpdateValue(current[field])]),
  );
}

export function serializeReservationUpdatePatch(patch: ReservationUpdatePatch) {
  return Object.fromEntries(
    reservationUpdateChangedFields(patch).map((field) => [
      field,
      serializeReservationUpdateValue(patch[field] as ReservationUpdateSnapshot[ReservationUpdateField]),
    ]),
  );
}

export function deserializeReservationUpdatePatch(
  value: Record<string, unknown>,
): ReservationUpdatePatch {
  const patch: ReservationUpdatePatch = {};
  const keys = Object.keys(value);
  if (keys.length === 0 || keys.some((key) => !RESERVATION_UPDATE_FIELDS.includes(key as ReservationUpdateField))) {
    throw new ReservationUpdateInputError("The stored reservation update contains invalid fields.");
  }

  for (const field of keys as ReservationUpdateField[]) {
    const item = value[field];
    if (field === "startAt") {
      if (typeof item !== "string") throw new ReservationUpdateInputError("Invalid stored startAt.");
      patch.startAt = parseStoredDate(item, "startAt");
    } else if (field === "endAt") {
      if (item !== null && typeof item !== "string") {
        throw new ReservationUpdateInputError("Invalid stored endAt.");
      }
      patch.endAt = item === null ? null : parseStoredDate(item, "endAt");
    } else if (field === "pax") {
      patch.pax = parsePassengers(item);
    } else if (field === "pickupText" || field === "dropoffText") {
      if (
        item !== null &&
        (typeof item !== "string" || item.length === 0 || item.length > 500)
      ) {
        throw new ReservationUpdateInputError(`Invalid stored ${field}.`);
      }
      patch[field] = item;
    } else {
      const maximum = field === "notes" ? 2000 : 40;
      if (
        item !== null &&
        (typeof item !== "string" || item.length === 0 || item.length > maximum)
      ) {
        throw new ReservationUpdateInputError(`Invalid stored ${field}.`);
      }
      patch[field] = item;
    }
  }
  assertReservationUpdatePatch(patch);
  return patch;
}

export function snapshotMatchesBeforeValues(
  current: ReservationUpdateSnapshot,
  before: Record<string, unknown>,
) {
  const keys = Object.keys(before);
  if (keys.length === 0 || keys.some((key) => !RESERVATION_UPDATE_FIELDS.includes(key as ReservationUpdateField))) {
    return false;
  }
  return keys.every((key) => {
    const field = key as ReservationUpdateField;
    return serializeReservationUpdateValue(current[field]) === before[field];
  });
}
