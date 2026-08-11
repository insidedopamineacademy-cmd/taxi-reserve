import { parseReservationStatusCode } from "../reservationStatus.ts";
import {
  formatMadridDate,
  formatMadridTime,
  isCalendarDate,
  isClockTime,
  madridDateTimeToInstant,
} from "../time/madrid.ts";

export type ReservationCreationStatus = "ASSIGNED" | "COMPLETED";

export type NormalizedReservationCreation = {
  startAt: Date;
  pickupText: string | null;
  dropoffText: string | null;
  pax: number;
  priceEuro: number | null;
  phone: string | null;
  flight: string | null;
  notes: string | null;
  status: ReservationCreationStatus;
};

export type ReservationCreationSnapshot = Omit<NormalizedReservationCreation, "status"> & {
  id: string;
  userEmail: string;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
  status: "PENDING" | "ASSIGNED" | "COMPLETED" | "R_RECEIVED";
};

export type ReservationCreationRepository = {
  create(input: {
    ownerEmail: string;
    reservation: NormalizedReservationCreation;
  }): Promise<ReservationCreationSnapshot>;
  findLikelyDuplicate(input: {
    ownerEmail: string;
    reservation: NormalizedReservationCreation;
  }): Promise<ReservationCreationSnapshot | null>;
};

export class ReservationCreationInputError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "ReservationCreationInputError";
  }
}

function optionalText(value: unknown, maximum: number) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, maximum) : null;
}

function parsePassengers(value: unknown, required: boolean) {
  if ((value === undefined || value === null || value === "") && !required) return 1;
  const passengers = Number(value);
  if (!Number.isInteger(passengers) || passengers < 1 || passengers > 99) {
    throw new ReservationCreationInputError(
      "Passengers must be an integer between 1 and 99.",
      "passengers",
    );
  }
  return passengers;
}

function parsePrice(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const price = Number(value);
  if (!Number.isFinite(price)) {
    throw new ReservationCreationInputError("Price must be a finite number.", "priceEuro");
  }
  return price;
}

function madridInstant(date: string, time: string) {
  if (!isCalendarDate(date) || !isClockTime(time)) {
    throw new ReservationCreationInputError(
      "Service date and pickup time must use valid YYYY-MM-DD and HH:mm values.",
      "startAt",
    );
  }
  const instant = madridDateTimeToInstant(date, time);
  if (formatMadridDate(instant) !== date || formatMadridTime(instant) !== time) {
    throw new ReservationCreationInputError(
      "That pickup time does not exist in Europe/Madrid because of a clock change.",
      "startAt",
    );
  }
  return instant;
}

function parseStartAt(input: Record<string, unknown>) {
  if (input.serviceDate !== undefined || input.pickupTime !== undefined) {
    if (typeof input.serviceDate !== "string" || typeof input.pickupTime !== "string") {
      throw new ReservationCreationInputError(
        "Service date and pickup time are required together.",
        "startAt",
      );
    }
    return madridInstant(input.serviceDate, input.pickupTime);
  }

  if (typeof input.startAtMs === "number" && Number.isFinite(input.startAtMs)) {
    const instant = new Date(input.startAtMs);
    if (Number.isFinite(instant.getTime())) return instant;
  }

  if (input.startAt instanceof Date && Number.isFinite(input.startAt.getTime())) {
    return new Date(input.startAt.getTime());
  }

  const raw = typeof input.startAt === "string" ? input.startAt.trim() : "";
  if (!raw) throw new ReservationCreationInputError("startAt is required.", "startAt");

  const local = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(raw);
  if (local) return madridInstant(`${local[1]}-${local[2]}-${local[3]}`, `${local[4]}:${local[5]}`);

  const european = /^(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})$/.exec(raw);
  if (european) {
    return madridInstant(
      `${european[3]}-${european[2]}-${european[1]}`,
      `${european[4].padStart(2, "0")}:${european[5]}`,
    );
  }

  const instant = new Date(raw);
  if (!Number.isFinite(instant.getTime())) {
    throw new ReservationCreationInputError("Invalid startAt.", "startAt");
  }
  return instant;
}

export function normalizeReservationCreationInput(
  input: Record<string, unknown>,
  options: {
    requireOperationalFields?: boolean;
    allowStatusOverride?: boolean;
  } = {},
): NormalizedReservationCreation {
  const requireOperationalFields = options.requireOperationalFields === true;
  const pickupText = optionalText(input.pickupText, 500);
  const dropoffText = optionalText(input.dropoffText, 500);
  if (requireOperationalFields && !pickupText) {
    throw new ReservationCreationInputError("Pickup is required.", "pickupText");
  }
  if (requireOperationalFields && !dropoffText) {
    throw new ReservationCreationInputError("Drop-off is required.", "dropoffText");
  }

  const status = options.allowStatusOverride
    ? parseReservationStatusCode(input.status) ?? "ASSIGNED"
    : "ASSIGNED";

  return {
    startAt: parseStartAt(input),
    pickupText,
    dropoffText,
    pax: parsePassengers(input.pax, requireOperationalFields),
    priceEuro: parsePrice(input.priceEuro),
    phone: optionalText(input.phone, 40),
    flight: optionalText(input.flight, 40),
    notes: optionalText(input.notes, 2000),
    status,
  };
}

export function serializeReservationCreation(
  reservation: NormalizedReservationCreation,
) {
  return {
    startAt: reservation.startAt.toISOString(),
    pickupText: reservation.pickupText,
    dropoffText: reservation.dropoffText,
    pax: reservation.pax,
    priceEuro: reservation.priceEuro,
    phone: reservation.phone,
    flight: reservation.flight,
    notes: reservation.notes,
    status: reservation.status,
  };
}

export function deserializeReservationCreation(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ReservationCreationInputError("Invalid stored reservation creation payload.");
  }
  const input = value as Record<string, unknown>;
  const keys = [
    "startAt",
    "pickupText",
    "dropoffText",
    "pax",
    "priceEuro",
    "phone",
    "flight",
    "notes",
    "status",
  ];
  if (Object.keys(input).length !== keys.length || keys.some((key) => !(key in input))) {
    throw new ReservationCreationInputError("Invalid stored reservation creation fields.");
  }
  const normalized = normalizeReservationCreationInput(input, {
    requireOperationalFields: true,
    allowStatusOverride: true,
  });
  if (normalized.status !== "ASSIGNED") {
    throw new ReservationCreationInputError("AI-created reservations must use the default status.");
  }
  return normalized;
}

export async function createOwnedReservation(
  input: {
    ownerEmail: string;
    reservation: NormalizedReservationCreation;
  },
  repository: ReservationCreationRepository,
) {
  const ownerEmail = input.ownerEmail.trim().toLowerCase();
  if (!ownerEmail || ownerEmail.length > 320) {
    throw new ReservationCreationInputError("Owner email is invalid.");
  }
  return repository.create({ ownerEmail, reservation: input.reservation });
}
