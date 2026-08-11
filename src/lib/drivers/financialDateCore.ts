export function parseFinancialCivilDate(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : null;
}

export function formatFinancialCivilDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function addFinancialCalendarDays(date: Date, days: number) {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + days,
  ));
}

export function getMadridFinancialPeriods(now = new Date()) {
  const today = parseFinancialCivilDate(formatMadridDate(now));
  if (!today) throw new Error("Invalid Madrid financial date");
  const mondayOffset = (today.getUTCDay() + 6) % 7;
  const weekStart = addFinancialCalendarDays(today, -mondayOffset);
  const weekEnd = addFinancialCalendarDays(weekStart, 7);
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
  const previousMonthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));

  return {
    today,
    weekStart,
    weekEnd,
    monthStart,
    monthEnd,
    previousMonthStart,
    previousMonthEnd: monthStart,
  };
}
import { formatMadridDate } from "../time/madrid.ts";
