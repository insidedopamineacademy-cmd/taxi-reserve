import "server-only";

import { DriverPaymentMethod, Prisma } from "@prisma/client";

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const MAX_MONEY = new Prisma.Decimal("99999999.99");
export const FINANCIAL_NOTES_MAX_LENGTH = 2000;

export function parsePositiveMoney(
  value: unknown,
  label: string,
): ValidationResult<Prisma.Decimal> {
  const raw =
    typeof value === "string"
      ? value.trim()
      : typeof value === "number" && Number.isFinite(value)
        ? String(value)
        : "";
  const normalized = raw.includes(",") && !raw.includes(".")
    ? raw.replace(",", ".")
    : raw;

  if (!normalized) return { ok: false, error: `${label} is required.` };
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    return {
      ok: false,
      error: `${label} must be a positive amount with no more than 2 decimal places.`,
    };
  }

  const amount = new Prisma.Decimal(normalized);
  if (amount.lessThanOrEqualTo(0)) {
    return { ok: false, error: `${label} must be greater than zero.` };
  }
  if (amount.greaterThan(MAX_MONEY)) {
    return { ok: false, error: `${label} is too large.` };
  }

  return { ok: true, value: amount };
}

export function parseFinancialDate(
  value: unknown,
  label: string,
): ValidationResult<Date> {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { ok: false, error: `${label} is required.` };
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;

  return valid
    ? { ok: true, value: date }
    : { ok: false, error: `${label} must be a valid date.` };
}

export function parseFinancialNotes(value: unknown): ValidationResult<string | null> {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null };
  }
  if (typeof value !== "string") {
    return { ok: false, error: "Notes must be text." };
  }

  const notes = value.trim();
  if (notes.length > FINANCIAL_NOTES_MAX_LENGTH) {
    return {
      ok: false,
      error: `Notes must be ${FINANCIAL_NOTES_MAX_LENGTH} characters or fewer.`,
    };
  }

  return { ok: true, value: notes || null };
}

export function parsePaymentMethod(value: unknown): ValidationResult<DriverPaymentMethod> {
  if (
    value === DriverPaymentMethod.CASH ||
    value === DriverPaymentMethod.BANK ||
    value === DriverPaymentMethod.OTHER
  ) {
    return { ok: true, value };
  }

  return { ok: false, error: "Select a valid payment method." };
}

export function formatFinancialDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function formatFinancialDateDisplay(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

export function currentFinancialDateInput(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = new Map(parts.map((part) => [part.type, part.value]));

  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

export function financialDateFromMadridInstant(instant: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const values = new Map(parts.map((part) => [part.type, part.value]));

  return new Date(
    Date.UTC(
      Number(values.get("year")),
      Number(values.get("month")) - 1,
      Number(values.get("day")),
    ),
  );
}
