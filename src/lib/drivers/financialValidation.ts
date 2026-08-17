import "server-only";

import { DriverPaymentMethod, Prisma } from "@prisma/client";
import { formatCalendarDateDisplay } from "../dateDisplay.ts";
import {
  formatMadridDate,
  madridCalendarDateAsUtc,
} from "../time/madrid.ts";
import {
  formatFinancialCivilDate,
  parseFinancialCivilDate,
} from "./financialDateCore.ts";

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
  const date = parseFinancialCivilDate(value);
  return date
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
  return formatFinancialCivilDate(date);
}

export function formatFinancialDateDisplay(date: Date) {
  if (!Number.isFinite(date.getTime())) throw new RangeError("Invalid financial date");
  const calendarDate = [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
  return formatCalendarDateDisplay(calendarDate);
}

export function currentFinancialDateInput(now = new Date()) {
  return formatMadridDate(now);
}

export function financialDateFromMadridInstant(instant: Date) {
  return madridCalendarDateAsUtc(instant);
}
