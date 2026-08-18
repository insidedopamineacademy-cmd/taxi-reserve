const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const MONTH_ABBREVIATIONS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isValidCalendarParts(year: number, month: number, day: number) {
  return (
    year >= 100 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month)
  );
}

// "aug" -> 8, etc. Built from the same fixed abbreviations used for display so
// parsing and formatting can never drift apart.
const MONTH_INDEX: Record<string, number> = Object.fromEntries(
  MONTH_ABBREVIATIONS.map((abbreviation, index) => [
    abbreviation.toLowerCase(),
    index + 1,
  ]),
);

const NAMED_DATE_PATTERN = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/;

/**
 * Formats a canonical calendar date without interpreting it as an instant.
 */
export function formatCalendarDateDisplay(calendarDate: string) {
  const match = CALENDAR_DATE_PATTERN.exec(calendarDate);
  if (!match) throw new RangeError("Invalid calendar date");

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidCalendarParts(year, month, day)) {
    throw new RangeError("Invalid calendar date");
  }

  return `${match[3]} ${MONTH_ABBREVIATIONS[month - 1]} ${match[1]}`;
}

/**
 * The inverse of {@link formatCalendarDateDisplay}: deterministically normalizes
 * a human or canonical calendar date to the internal `YYYY-MM-DD` form.
 *
 * Accepts the two Taxi Reserve calendar formats and nothing else:
 *   - canonical `2026-08-18`
 *   - human `18 Aug 2026` (fixed English abbreviations, case-insensitive)
 *
 * Returns `null` for any other shape or an impossible Gregorian date. Uses pure
 * string + arithmetic parsing (never constructs a `Date`), so the result is
 * identical under every runtime timezone and locale.
 */
export function parseCalendarDateInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const iso = CALENDAR_DATE_PATTERN.exec(trimmed);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    return isValidCalendarParts(year, month, day) ? trimmed : null;
  }

  const named = NAMED_DATE_PATTERN.exec(trimmed);
  if (named) {
    const day = Number(named[1]);
    const month = MONTH_INDEX[named[2].toLowerCase()];
    const year = Number(named[3]);
    if (!month || !isValidCalendarParts(year, month, day)) return null;
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  return null;
}

/**
 * Preserves the runtime's existing local-instant conversion, then applies the
 * deterministic calendar-date presentation.
 */
export function formatLocalInstantDateDisplay(instant: Date) {
  if (!Number.isFinite(instant.getTime())) throw new RangeError("Invalid instant");
  const calendarDate = [
    String(instant.getFullYear()).padStart(4, "0"),
    String(instant.getMonth() + 1).padStart(2, "0"),
    String(instant.getDate()).padStart(2, "0"),
  ].join("-");
  return formatCalendarDateDisplay(calendarDate);
}
