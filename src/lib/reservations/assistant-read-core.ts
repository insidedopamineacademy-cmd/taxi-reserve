import {
  getMadridDayRange,
  isCalendarDate,
  isClockTime,
  madridDateTimeToInstant,
  formatMadridDate,
  formatMadridTime,
} from "../time/madrid.ts";

export const ASSISTANT_RESERVATION_DEFAULT_LIMIT = 10;
export const ASSISTANT_RESERVATION_MAX_LIMIT = 20;

export type ReservationAccessRole = "USER" | "ADMIN";

export type ReservationAccessContext = {
  userId: string;
  email: string;
  role: ReservationAccessRole;
};

export type ReservationReadStatus =
  | "PENDING"
  | "ASSIGNED"
  | "COMPLETED"
  | "R_RECEIVED";

export type ReservationSearchFilters = {
  serviceDate?: string;
  dateFrom?: string;
  dateTo?: string;
  timeFrom?: string;
  timeTo?: string;
  pickupQuery?: string;
  dropoffQuery?: string;
  phone?: string;
  driverId?: string;
  assigned?: boolean;
  status?: ReservationReadStatus;
  limit?: number;
};

export type ReservationRepositoryQuery = {
  ownerEmail: string;
  startAtGte?: Date;
  startAtLt?: Date;
  pickupContains?: string;
  dropoffContains?: string;
  phoneContains?: string;
  driverId?: string;
  assigned?: boolean;
  status?: ReservationReadStatus;
  limit: number;
};

export type ReservationReadRow = {
  id: string;
  startAt: Date;
  pickupText: string | null;
  dropoffText: string | null;
  pax: number;
  phone: string | null;
  flight: string | null;
  status: ReservationReadStatus;
  driverId: string | null;
  driver: { id: string; name: string } | null;
};

export type AssistantReservationDto = {
  id: string;
  serviceDate: string;
  pickupTime: string;
  pickup: string | null;
  dropoff: string | null;
  phone: string | null;
  passengerCount: number;
  flightNumber: string | null;
  status: ReservationReadStatus;
  driver?: { id: string; name: string } | null;
};

export type ReservationReadRepository = {
  search(query: ReservationRepositoryQuery): Promise<ReservationReadRow[]>;
  getById(query: {
    ownerEmail: string;
    reservationId: string;
  }): Promise<ReservationReadRow | null>;
};

export class ReservationReadInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReservationReadInputError";
  }
}

export class ReservationReadForbiddenError extends Error {
  constructor() {
    super("Driver assignment information is restricted to administrators.");
    this.name = "ReservationReadForbiddenError";
  }
}

function optionalQuery(value: string | undefined, label: string, maxLength: number) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ReservationReadInputError(`${label} must be text.`);
  }
  const normalized = value.trim();
  if (!normalized) throw new ReservationReadInputError(`${label} cannot be blank.`);
  if (normalized.length > maxLength) {
    throw new ReservationReadInputError(`${label} is too long.`);
  }
  return normalized;
}

function assertDate(value: string | undefined, label: string) {
  if (value !== undefined && (typeof value !== "string" || !isCalendarDate(value))) {
    throw new ReservationReadInputError(`${label} must use YYYY-MM-DD.`);
  }
}

function assertTime(value: string | undefined, label: string) {
  if (value !== undefined && (typeof value !== "string" || !isClockTime(value))) {
    throw new ReservationReadInputError(`${label} must use HH:mm.`);
  }
}

export function buildReservationRepositoryQuery(
  context: ReservationAccessContext,
  filters: ReservationSearchFilters,
): ReservationRepositoryQuery {
  assertDate(filters.serviceDate, "serviceDate");
  assertDate(filters.dateFrom, "dateFrom");
  assertDate(filters.dateTo, "dateTo");
  assertTime(filters.timeFrom, "timeFrom");
  assertTime(filters.timeTo, "timeTo");

  if (filters.assigned !== undefined && typeof filters.assigned !== "boolean") {
    throw new ReservationReadInputError("assigned must be true or false.");
  }
  if (
    filters.status !== undefined &&
    !["PENDING", "ASSIGNED", "COMPLETED", "R_RECEIVED"].includes(filters.status)
  ) {
    throw new ReservationReadInputError("status is invalid.");
  }

  if (filters.serviceDate && (filters.dateFrom || filters.dateTo)) {
    throw new ReservationReadInputError(
      "serviceDate cannot be combined with dateFrom or dateTo.",
    );
  }
  if ((filters.timeFrom || filters.timeTo) && !filters.serviceDate) {
    throw new ReservationReadInputError(
      "A serviceDate is required when filtering by time.",
    );
  }
  if (
    context.role !== "ADMIN" &&
    (filters.driverId !== undefined || filters.assigned !== undefined)
  ) {
    throw new ReservationReadForbiddenError();
  }

  const limit = filters.limit ?? ASSISTANT_RESERVATION_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > ASSISTANT_RESERVATION_MAX_LIMIT) {
    throw new ReservationReadInputError(
      `limit must be between 1 and ${ASSISTANT_RESERVATION_MAX_LIMIT}.`,
    );
  }

  let startAtGte: Date | undefined;
  let startAtLt: Date | undefined;

  if (filters.serviceDate) {
    const day = getMadridDayRange(filters.serviceDate);
    startAtGte = filters.timeFrom
      ? madridDateTimeToInstant(filters.serviceDate, filters.timeFrom)
      : day.start;
    startAtLt = filters.timeTo
      ? madridDateTimeToInstant(filters.serviceDate, filters.timeTo)
      : day.end;
  } else {
    if (filters.dateFrom) startAtGte = getMadridDayRange(filters.dateFrom).start;
    if (filters.dateTo) startAtLt = getMadridDayRange(filters.dateTo).end;
  }

  if (startAtGte && startAtLt && startAtGte >= startAtLt) {
    throw new ReservationReadInputError("The reservation date/time range is empty.");
  }

  const driverId = optionalQuery(filters.driverId, "driverId", 100);
  if (driverId && filters.assigned === false) {
    throw new ReservationReadInputError(
      "driverId cannot be combined with assigned=false.",
    );
  }

  return {
    ownerEmail: context.email,
    startAtGte,
    startAtLt,
    pickupContains: optionalQuery(filters.pickupQuery, "pickupQuery", 200),
    dropoffContains: optionalQuery(filters.dropoffQuery, "dropoffQuery", 200),
    phoneContains: optionalQuery(filters.phone, "phone", 40),
    driverId,
    assigned: filters.assigned,
    status: filters.status,
    limit,
  };
}

function toAssistantReservation(
  context: ReservationAccessContext,
  row: ReservationReadRow,
): AssistantReservationDto {
  const reservation: AssistantReservationDto = {
    id: row.id,
    serviceDate: formatMadridDate(row.startAt),
    pickupTime: formatMadridTime(row.startAt),
    pickup: row.pickupText,
    dropoff: row.dropoffText,
    phone: row.phone,
    passengerCount: row.pax,
    flightNumber: row.flight,
    status: row.status,
  };

  if (context.role === "ADMIN") {
    reservation.driver = row.driverId && row.driver
      ? { id: row.driver.id, name: row.driver.name }
      : null;
  }

  return reservation;
}

export async function searchReservationsForAssistant(
  context: ReservationAccessContext,
  filters: ReservationSearchFilters,
  repository: ReservationReadRepository,
) {
  const query = buildReservationRepositoryQuery(context, filters);
  const rows = await repository.search(query);
  return rows.map((row) => toAssistantReservation(context, row));
}

export async function getReservationForAssistant(
  context: ReservationAccessContext,
  reservationId: string,
  repository: ReservationReadRepository,
) {
  const normalizedId = optionalQuery(reservationId, "reservationId", 100);
  if (!normalizedId) throw new ReservationReadInputError("reservationId is required.");

  const row = await repository.getById({
    ownerEmail: context.email,
    reservationId: normalizedId,
  });

  return row ? toAssistantReservation(context, row) : null;
}
