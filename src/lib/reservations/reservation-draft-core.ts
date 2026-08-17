import {
  addCalendarDays,
  getMadridDateContext,
  isCalendarDate,
  isClockTime,
} from "../time/madrid.ts";
import { formatCalendarDateDisplay } from "../dateDisplay.ts";

export const RESERVATION_DRAFT_TTL_MS = 15 * 60 * 1_000;
export const RESERVATION_BOOKING_TEXT_MAX_LENGTH = 4_000;

export type ReservationDraftFieldState =
  | "EXPLICIT"
  | "INFERRED"
  | "MISSING"
  | "CONFLICT";

export type ReservationDraftField<T> = {
  state: ReservationDraftFieldState;
  value: T | null;
  alternatives: T[];
  confirmed: boolean;
  message?: string;
};

export type ReservationDraftFields = {
  pickup: ReservationDraftField<string>;
  dropoff: ReservationDraftField<string>;
  phone: ReservationDraftField<string>;
  serviceDate: ReservationDraftField<string>;
  pickupTime: ReservationDraftField<string>;
  passengers: ReservationDraftField<number>;
  priceEuro: ReservationDraftField<number>;
  flight: ReservationDraftField<string>;
  notes: ReservationDraftField<string>;
};

export type ReservationDraftRecord = {
  id: string;
  ownerUserId: string;
  ownerEmail: string;
  revision: number;
  fields: ReservationDraftFields;
  completeConfirmed: boolean;
  duplicateAcknowledged: boolean;
  pendingActionId: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
};

export type ReservationDraftPublic = {
  id: string;
  revision: number;
  fields: ReservationDraftFields;
  blockingFields: string[];
  completeConfirmed: boolean;
  duplicateAcknowledged: boolean;
  readyToPrepare: boolean;
  question: string;
};

export type ReservationDraftUpdateArguments = {
  pickup: string | null;
  dropoff: string | null;
  phone: string | null;
  service_date: string | null;
  pickup_time: string | null;
  passengers: number | null;
  price_euro: number | null;
  flight: string | null;
  notes: string | null;
  confirm_complete: boolean;
  acknowledge_duplicate: boolean;
};

export type PrepareCreateReservationArguments = {
  pickup: string;
  dropoff: string;
  service_date: string;
  pickup_time: string;
  passengers: number;
  price_euro: number | null;
  phone: string | null;
  flight: string | null;
  notes: string | null;
};

export class ReservationDraftInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReservationDraftInputError";
  }
}

const requiredFields = [
  "pickup",
  "dropoff",
  "serviceDate",
  "pickupTime",
  "passengers",
] as const;

function missingField<T>(): ReservationDraftField<T> {
  return { state: "MISSING", value: null, alternatives: [], confirmed: false };
}

function explicitField<T>(value: T): ReservationDraftField<T> {
  return { state: "EXPLICIT", value, alternatives: [], confirmed: true };
}

function inferredField<T>(value: T, message: string): ReservationDraftField<T> {
  return {
    state: "INFERRED",
    value,
    alternatives: [],
    confirmed: false,
    message,
  };
}

function conflictField<T>(alternatives: T[], message: string): ReservationDraftField<T> {
  return {
    state: "CONFLICT",
    value: null,
    alternatives,
    confirmed: false,
    message,
  };
}

function distinct<T>(values: T[]) {
  return [...new Set(values)];
}

function boundedStringField(values: string[], maximum: number, label: string) {
  const normalized = distinct(
    values.map((value) => value.trim().slice(0, maximum)).filter(Boolean),
  );
  if (normalized.length === 0) return missingField<string>();
  if (normalized.length === 1) return explicitField(normalized[0]);
  return conflictField(normalized, `The booking contains different ${label} values.`);
}

type LabelKey =
  | "pickup"
  | "dropoff"
  | "phone"
  | "when"
  | "date"
  | "time"
  | "passengers"
  | "price"
  | "flight"
  | "luggage"
  | "notes";

function labelKey(label: string): LabelKey | null {
  const normalized = label.toLowerCase().replace(/[\s_-]+/g, "").replace(/[^a-z]/g, "");
  if (["pickup", "from", "pickupaddress"].includes(normalized)) return "pickup";
  if (["dropoff", "destination", "to", "dropoffaddress"].includes(normalized)) return "dropoff";
  if (["phone", "telephone", "mobile", "contact"].includes(normalized)) return "phone";
  if (["when", "datetime", "pickupdatetime"].includes(normalized)) return "when";
  if (["date", "servicedate", "pickupdate"].includes(normalized)) return "date";
  if (["time", "pickuptime"].includes(normalized)) return "time";
  if (["passengers", "passenger", "pax", "people", "persons"].includes(normalized)) return "passengers";
  if (["price", "fare", "amount", "agreedprice"].includes(normalized)) return "price";
  if (["flight", "flightnumber", "flightno"].includes(normalized)) return "flight";
  if (["luggage", "bags", "baggage"].includes(normalized)) return "luggage";
  if (["notes", "note", "comments", "specialrequests", "specialrequest"].includes(normalized)) return "notes";
  return null;
}

function labeledValues(text: string) {
  const values = new Map<LabelKey, string[]>();
  let continuation: LabelKey | null = null;
  for (const rawLine of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();
    const match = /^([^:]{1,40}):\s*(.*)$/.exec(line);
    const key = match ? labelKey(match[1]) : null;
    if (key && match) {
      const current = values.get(key) ?? [];
      current.push(match[2].trim());
      values.set(key, current);
      continuation = key === "notes" || key === "pickup" || key === "dropoff" ? key : null;
      continue;
    }
    if (line && continuation) {
      const current = values.get(continuation)!;
      const separator = continuation === "notes" ? "\n" : " ";
      current[current.length - 1] = `${current[current.length - 1]}${separator}${line}`.trim();
    }
  }
  return values;
}

function validCalendarDate(year: number, month: number, day: number) {
  const value = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isCalendarDate(value) ? value : null;
}

function nextWeekday(today: string, weekday: number) {
  const current = new Date(`${today}T00:00:00.000Z`).getUTCDay();
  const days = ((weekday - current + 7) % 7) || 7;
  return addCalendarDays(today, days);
}

function parseDateCandidate(raw: string, now: Date): ReservationDraftField<string> {
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return missingField<string>();
  if (isCalendarDate(normalized)) return explicitField(normalized);

  const numeric = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(normalized);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    const year = Number(numeric[3]);
    if (first <= 12 && second <= 12 && first !== second) {
      const european = validCalendarDate(year, second, first);
      const american = validCalendarDate(year, first, second);
      return conflictField(
        distinct([european, american].filter((value): value is string => Boolean(value))),
        "That numeric date is ambiguous. Which date is correct?",
      );
    }
    const european = validCalendarDate(year, second, first);
    if (european) return explicitField(european);
    const american = validCalendarDate(year, first, second);
    if (american) {
      return inferredField(
        american,
        `I interpreted the service date as ${formatCalendarDateDisplay(american)}. Please confirm it.`,
      );
    }
    return conflictField([], "The booking date is invalid.");
  }

  const dateContext = getMadridDateContext(now);
  if (normalized === "today") {
    return inferredField(
      dateContext.today,
      `I interpreted “today” as ${formatCalendarDateDisplay(dateContext.today)}.`,
    );
  }
  if (normalized === "tomorrow") {
    return inferredField(
      dateContext.tomorrow,
      `I interpreted “tomorrow” as ${formatCalendarDateDisplay(dateContext.tomorrow)}.`,
    );
  }
  const weekdays: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };
  const weekdayName = normalized.replace(/^next\s+/, "");
  if (weekdayName in weekdays) {
    const value = nextWeekday(dateContext.today, weekdays[weekdayName]);
    return inferredField(
      value,
      `I interpreted “${raw.trim()}” as ${formatCalendarDateDisplay(value)}.`,
    );
  }
  return conflictField([], "The booking date could not be interpreted safely.");
}

function mergeDateFields(fields: ReservationDraftField<string>[]) {
  const present = fields.filter((field) => field.state !== "MISSING");
  if (present.length === 0) return missingField<string>();
  const firstConflict = present.find((field) => field.state === "CONFLICT");
  if (firstConflict) return firstConflict;
  const values = distinct(present.map((field) => field.value).filter((value): value is string => Boolean(value)));
  if (values.length > 1) return conflictField(values, "The booking contains different service dates.");
  const explicit = present.some((field) => field.state === "EXPLICIT");
  return explicit
    ? explicitField(values[0])
    : inferredField(values[0], present[0].message ?? "Please confirm the interpreted date.");
}

function parseTimeValues(values: string[]) {
  const normalized: string[] = [];
  for (const value of values) {
    const match = /(?:^|\s)(\d{1,2}):(\d{2})(?:\s|$)/.exec(value.trim());
    if (!match) return conflictField<string>([], "The pickup time could not be interpreted safely.");
    const time = `${match[1].padStart(2, "0")}:${match[2]}`;
    if (!isClockTime(time)) return conflictField<string>([], "The pickup time is invalid.");
    normalized.push(time);
  }
  return boundedStringField(normalized, 5, "pickup time");
}

function parsePassengerField(values: string[], notes: string[]) {
  const candidates: number[] = [];
  let invalid = false;
  for (const value of values) {
    if (!/^\d+$/.test(value.trim())) {
      invalid = true;
      continue;
    }
    const passengers = Number(value.trim());
    if (!Number.isInteger(passengers) || passengers < 1 || passengers > 99) invalid = true;
    else candidates.push(passengers);
  }
  for (const note of notes) {
    for (const match of note.matchAll(/\b(\d{1,2})\s*(?:pax|passengers?|people|persons?)\b/gi)) {
      const passengers = Number(match[1]);
      if (passengers >= 1 && passengers <= 99) candidates.push(passengers);
    }
  }
  const unique = distinct(candidates);
  if (invalid) return conflictField(unique, "The passenger count is invalid.");
  if (unique.length === 0) return missingField<number>();
  if (unique.length === 1) return explicitField(unique[0]);
  return conflictField(
    unique,
    `The form says ${unique[0]} passengers, but the notes mention ${unique[1]}. Which is correct?`,
  );
}

function parsePriceField(values: string[]) {
  const prices: number[] = [];
  for (const value of values) {
    const normalized = value.trim().replace(/[€\s]/g, "").replace(",", ".");
    if (!/^[-+]?\d+(?:\.\d+)?$/.test(normalized)) {
      return conflictField<number>([], "The booking price is invalid.");
    }
    const price = Number(normalized);
    if (!Number.isFinite(price)) return conflictField<number>([], "The booking price is invalid.");
    prices.push(price);
  }
  const unique = distinct(prices);
  if (unique.length === 0) return missingField<number>();
  if (unique.length === 1) return explicitField(unique[0]);
  return conflictField(unique, "The booking contains different agreed prices.");
}

function blockingFields(fields: ReservationDraftFields) {
  const blockers = new Set<string>();
  for (const [name, field] of Object.entries(fields)) {
    if (field.state === "CONFLICT" || (field.state === "INFERRED" && !field.confirmed)) {
      blockers.add(name);
    }
  }
  for (const name of requiredFields) {
    if (fields[name].state === "MISSING" || fields[name].value === null) blockers.add(name);
  }
  return [...blockers];
}

function fieldQuestion(name: string, field: ReservationDraftField<unknown>) {
  if (field.message) return field.message;
  const labels: Record<string, string> = {
    pickup: "Pickup address?",
    dropoff: "Drop-off address?",
    serviceDate: "Service date?",
    pickupTime: "Pickup time?",
    passengers: "Passenger count?",
    phone: "Client phone?",
    priceEuro: "Agreed price?",
  };
  return labels[name] ?? `Please confirm ${name}.`;
}

function draftQuestion(fields: ReservationDraftFields, completeConfirmed: boolean) {
  const blockers = blockingFields(fields);
  if (blockers.length === 0) {
    return completeConfirmed
      ? "The booking is complete and ready for a creation preview."
      : "I found the booking details. Are they complete and correct?";
  }
  const questions = blockers.map((name) => fieldQuestion(name, fields[name as keyof ReservationDraftFields]));
  if (questions.length === 1) return `I need one detail:\n• ${questions[0]}`;
  return `I need ${questions.length} details:\n${questions.map((question) => `• ${question}`).join("\n")}`;
}

export function extractReservationDraft(input: {
  id: string;
  ownerUserId: string;
  ownerEmail: string;
  bookingText: string;
  now?: Date;
}): ReservationDraftRecord {
  const bookingText = input.bookingText.trim();
  if (!bookingText || bookingText.length > RESERVATION_BOOKING_TEXT_MAX_LENGTH) {
    throw new ReservationDraftInputError("Booking text is empty or too long.");
  }
  const now = input.now ?? new Date();
  const values = labeledValues(bookingText);
  const whenValues = values.get("when") ?? [];
  const dateValues = [...(values.get("date") ?? [])];
  const timeValues = [...(values.get("time") ?? [])];
  for (const when of whenValues) {
    const time = /(\d{1,2}:\d{2})/.exec(when);
    if (time) timeValues.push(time[1]);
    const datePart = when
      .replace(/\b(?:at\s*)?\d{1,2}:\d{2}\b/i, "")
      .replace(/[,·]/g, " ")
      .trim();
    if (datePart) dateValues.push(datePart);
  }

  const noteValues = (values.get("notes") ?? []).filter(Boolean);
  const luggageValues = (values.get("luggage") ?? []).map((value) => value.trim()).filter(Boolean);
  const notes = [...noteValues, ...luggageValues.map((value) => `Luggage: ${value}`)];
  const dateFields = dateValues.map((value) => parseDateCandidate(value, now));
  const fields: ReservationDraftFields = {
    pickup: boundedStringField(values.get("pickup") ?? [], 500, "pickup"),
    dropoff: boundedStringField(values.get("dropoff") ?? [], 500, "drop-off"),
    phone: boundedStringField(values.get("phone") ?? [], 40, "phone"),
    serviceDate: mergeDateFields(dateFields),
    pickupTime: timeValues.length > 0 ? parseTimeValues(timeValues) : missingField<string>(),
    passengers: parsePassengerField(values.get("passengers") ?? [], noteValues),
    priceEuro: parsePriceField(values.get("price") ?? []),
    flight: boundedStringField(values.get("flight") ?? [], 40, "flight"),
    notes: notes.length > 0 ? explicitField(notes.join("\n").slice(0, 2000)) : missingField<string>(),
  };
  return {
    id: input.id,
    ownerUserId: input.ownerUserId,
    ownerEmail: input.ownerEmail.trim().toLowerCase(),
    revision: 1,
    fields,
    completeConfirmed: false,
    duplicateAcknowledged: false,
    pendingActionId: null,
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(now.getTime() + RESERVATION_DRAFT_TTL_MS),
  };
}

function updateString(value: string, maximum: number, required: boolean) {
  const normalized = value.trim().slice(0, maximum);
  return normalized ? explicitField(normalized) : required ? missingField<string>() : explicitField<string | null>(null);
}

export function updateReservationDraft(
  draft: ReservationDraftRecord,
  input: ReservationDraftUpdateArguments,
  now = new Date(),
) {
  const fields = structuredClone(draft.fields);
  let changed = false;
  const set = <Key extends keyof ReservationDraftFields>(
    key: Key,
    value: ReservationDraftFields[Key],
  ) => {
    fields[key] = value;
    changed = true;
  };

  if (input.pickup !== null) set("pickup", updateString(input.pickup, 500, true) as ReservationDraftFields["pickup"]);
  if (input.dropoff !== null) set("dropoff", updateString(input.dropoff, 500, true) as ReservationDraftFields["dropoff"]);
  if (input.phone !== null) set("phone", updateString(input.phone, 40, false) as ReservationDraftFields["phone"]);
  if (input.flight !== null) set("flight", updateString(input.flight, 40, false) as ReservationDraftFields["flight"]);
  if (input.notes !== null) set("notes", updateString(input.notes, 2000, false) as ReservationDraftFields["notes"]);
  if (input.service_date !== null) {
    if (!isCalendarDate(input.service_date)) throw new ReservationDraftInputError("Invalid service date.");
    set("serviceDate", explicitField(input.service_date));
  }
  if (input.pickup_time !== null) {
    if (!isClockTime(input.pickup_time)) throw new ReservationDraftInputError("Invalid pickup time.");
    set("pickupTime", explicitField(input.pickup_time));
  }
  if (input.passengers !== null) {
    if (!Number.isInteger(input.passengers) || input.passengers < 1 || input.passengers > 99) {
      throw new ReservationDraftInputError("Invalid passenger count.");
    }
    set("passengers", explicitField(input.passengers));
  }
  if (input.price_euro !== null) {
    if (!Number.isFinite(input.price_euro)) throw new ReservationDraftInputError("Invalid price.");
    set("priceEuro", explicitField(input.price_euro));
  }

  if (input.confirm_complete) {
    for (const field of Object.values(fields)) {
      if (field.state === "INFERRED") field.confirmed = true;
    }
  }
  const blockers = blockingFields(fields);
  return {
    ...draft,
    revision: draft.revision + 1,
    fields,
    completeConfirmed: input.confirm_complete && blockers.length === 0,
    duplicateAcknowledged: input.acknowledge_duplicate
      ? true
      : changed
        ? false
        : draft.duplicateAcknowledged,
    pendingActionId: changed ? null : draft.pendingActionId,
    updatedAt: now,
    expiresAt: new Date(now.getTime() + RESERVATION_DRAFT_TTL_MS),
  } satisfies ReservationDraftRecord;
}

export function toPublicReservationDraft(draft: ReservationDraftRecord): ReservationDraftPublic {
  const blockers = blockingFields(draft.fields);
  return {
    id: draft.id,
    revision: draft.revision,
    fields: structuredClone(draft.fields),
    blockingFields: blockers,
    completeConfirmed: draft.completeConfirmed,
    duplicateAcknowledged: draft.duplicateAcknowledged,
    readyToPrepare: blockers.length === 0 && draft.completeConfirmed,
    question: draftQuestion(draft.fields, draft.completeConfirmed),
  };
}

export function reservationDraftPrepareArguments(
  draft: ReservationDraftRecord,
): PrepareCreateReservationArguments {
  const fields = draft.fields;
  const blockers = blockingFields(fields);
  if (blockers.length > 0 || !draft.completeConfirmed) {
    throw new ReservationDraftInputError("The reservation draft is not complete and confirmed.");
  }
  return {
    pickup: fields.pickup.value!,
    dropoff: fields.dropoff.value!,
    service_date: fields.serviceDate.value!,
    pickup_time: fields.pickupTime.value!,
    passengers: fields.passengers.value!,
    price_euro: fields.priceEuro.value,
    phone: fields.phone.value,
    flight: fields.flight.value,
    notes: fields.notes.value,
  };
}

export function samePrepareCreateReservationArguments(
  left: PrepareCreateReservationArguments,
  right: PrepareCreateReservationArguments,
) {
  return (Object.keys(left) as Array<keyof PrepareCreateReservationArguments>)
    .every((key) => left[key] === right[key]);
}
