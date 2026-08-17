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

/**
 * Formats a canonical calendar date without interpreting it as an instant.
 */
export function formatCalendarDateDisplay(calendarDate: string) {
  const match = CALENDAR_DATE_PATTERN.exec(calendarDate);
  if (!match) throw new RangeError("Invalid calendar date");

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    year < 100 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month)
  ) {
    throw new RangeError("Invalid calendar date");
  }

  return `${match[3]} ${MONTH_ABBREVIATIONS[month - 1]} ${match[1]}`;
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
