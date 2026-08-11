import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export const TAXI_RESERVE_TIME_ZONE = "Europe/Madrid";

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK_TIME_PATTERN = /^(\d{2}):(\d{2})$/;

function calendarDateParts(value: string) {
  const match = value.match(CALENDAR_DATE_PATTERN);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));

  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

export function isCalendarDate(value: string) {
  return calendarDateParts(value) !== null;
}

export function isClockTime(value: string) {
  const match = value.match(CLOCK_TIME_PATTERN);
  if (!match) return false;

  return Number(match[1]) <= 23 && Number(match[2]) <= 59;
}

export function formatMadridDate(instant: Date) {
  if (!Number.isFinite(instant.getTime())) throw new Error("Invalid instant");
  return formatInTimeZone(instant, TAXI_RESERVE_TIME_ZONE, "yyyy-MM-dd");
}

export function formatMadridTime(instant: Date) {
  if (!Number.isFinite(instant.getTime())) throw new Error("Invalid instant");
  return formatInTimeZone(instant, TAXI_RESERVE_TIME_ZONE, "HH:mm");
}

export function addCalendarDays(calendarDate: string, days: number) {
  const parts = calendarDateParts(calendarDate);
  if (!parts || !Number.isInteger(days)) throw new Error("Invalid calendar date");

  const result = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return result.toISOString().slice(0, 10);
}

export function madridDateTimeToInstant(calendarDate: string, clockTime = "00:00") {
  if (!isCalendarDate(calendarDate) || !isClockTime(clockTime)) {
    throw new Error("Invalid Madrid date or time");
  }

  return fromZonedTime(
    `${calendarDate}T${clockTime}:00.000`,
    TAXI_RESERVE_TIME_ZONE,
  );
}

export function getMadridDayRange(calendarDate: string) {
  if (!isCalendarDate(calendarDate)) throw new Error("Invalid calendar date");

  return {
    start: madridDateTimeToInstant(calendarDate),
    end: madridDateTimeToInstant(addCalendarDays(calendarDate, 1)),
  };
}

export function getMadridDateContext(now = new Date()) {
  const today = formatMadridDate(now);

  return {
    timeZone: TAXI_RESERVE_TIME_ZONE,
    today,
    tomorrow: addCalendarDays(today, 1),
  } as const;
}

export function madridCalendarDateAsUtc(instant: Date) {
  const calendarDate = formatMadridDate(instant);
  const parts = calendarDateParts(calendarDate);
  if (!parts) throw new Error("Invalid Madrid calendar date");

  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}
