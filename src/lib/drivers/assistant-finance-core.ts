import { Prisma } from "@prisma/client";
import { isDriverAdminRole } from "./access-core.ts";
import {
  addFinancialCalendarDays,
  formatFinancialCivilDate,
  parseFinancialCivilDate,
} from "./financialDateCore.ts";
import {
  calculateDriverFinancialSummary,
  type DriverFinancialSummary,
} from "./financialMath.ts";
import type { ReservationAccessContext } from "../reservations/assistant-read-core.ts";

export const ASSISTANT_DRIVER_DEFAULT_LIMIT = 10;
export const ASSISTANT_DRIVER_MAX_LIMIT = 20;
export const ASSISTANT_DRIVER_TRANSACTION_DEFAULT_LIMIT = 10;
export const ASSISTANT_DRIVER_TRANSACTION_MAX_LIMIT = 25;
export const ASSISTANT_DRIVER_MAX_SEARCH_SCAN = 200;
export const ASSISTANT_DRIVER_MAX_TRANSACTION_OFFSET = 500;

export type AssistantDriverStatus = "ACTIVE" | "INACTIVE";
export type AssistantDriverVehicleType = "VAN" | "SEDAN" | null;
export type AssistantBalancePosition = "DUE" | "SETTLED" | "CREDIT";
export type AssistantDriverTransactionType =
  | "ALL"
  | "COMMISSION"
  | "PAYMENT"
  | "SUBSCRIPTION";

export class DriverAssistantForbiddenError extends Error {
  constructor() {
    super("Driver finance access is restricted.");
    this.name = "DriverAssistantForbiddenError";
  }
}

export class DriverAssistantInputError extends Error {
  constructor(message = "Invalid driver finance filters.") {
    super(message);
    this.name = "DriverAssistantInputError";
  }
}

export type AssistantDriverRecord = {
  id: string;
  name: string;
  licenseNumber: string;
  vehicleType: AssistantDriverVehicleType;
  subscriptionExempt: boolean;
  status: AssistantDriverStatus;
};

export type AssistantDriverIdentityData = {
  id: string;
  name: string;
  status: AssistantDriverStatus;
  vehicleType: AssistantDriverVehicleType;
  href: string;
};

export type AssistantDriverResultData = AssistantDriverIdentityData & {
  licenseNumber?: string;
  balance: string;
  balancePosition: AssistantBalancePosition;
  currency: "EUR";
};

export type AssistantDriverSearchResult = {
  drivers: AssistantDriverResultData[];
  count: number;
  hasMore: boolean;
  nextCursor: string | null;
};

export type AssistantDriverLedgerSummaryData = {
  driver: AssistantDriverIdentityData;
  currency: "EUR";
  totalCommissions: string;
  totalPayments: string;
  totalSubscriptionCharges: string;
  balance: string;
  balancePosition: AssistantBalancePosition;
  calculatedAt: string;
};

export type AssistantCommissionTransactionRecord = {
  id: string;
  type: "COMMISSION";
  date: Date;
  createdAt: Date;
  amount: Prisma.Decimal;
  manualPickupText: string | null;
  manualDropoffText: string | null;
  reservation: {
    id: string;
    pickupText: string | null;
    dropoffText: string | null;
  } | null;
};

export type AssistantPaymentTransactionRecord = {
  id: string;
  type: "PAYMENT";
  date: Date;
  createdAt: Date;
  amount: Prisma.Decimal;
  method: "CASH" | "BANK" | "OTHER";
};

export type AssistantSubscriptionTransactionRecord = {
  id: string;
  type: "SUBSCRIPTION";
  date: Date;
  createdAt: Date;
  amount: Prisma.Decimal;
};

export type AssistantDriverTransactionRecord =
  | AssistantCommissionTransactionRecord
  | AssistantPaymentTransactionRecord
  | AssistantSubscriptionTransactionRecord;

export type AssistantDriverTransactionRowData =
  | {
      id: string;
      type: "COMMISSION";
      date: string;
      amount: string;
      source: "RESERVATION" | "MANUAL";
      route: { pickup: string | null; dropoff: string | null };
      reservation: { id: string; href: string } | null;
    }
  | {
      id: string;
      type: "PAYMENT";
      date: string;
      amount: string;
      method: "CASH" | "BANK" | "OTHER";
    }
  | {
      id: string;
      type: "SUBSCRIPTION";
      date: string;
      amount: string;
    };

export type AssistantDriverTransactionsData = {
  driver: AssistantDriverIdentityData;
  transactionType: AssistantDriverTransactionType;
  period: { from: string | null; to: string | null };
  pageCursor: string | null;
  currency: "EUR";
  totals: {
    commissions: string;
    payments: string;
    subscriptionCharges: string;
    netChange: string;
  };
  rows: AssistantDriverTransactionRowData[];
  hasMore: boolean;
  nextCursor: string | null;
};

export type AssistantDriverSearchFilters = {
  query?: string;
  status?: AssistantDriverStatus;
  vehicleType?: AssistantDriverVehicleType | "UNSPECIFIED";
  balancePosition?: AssistantBalancePosition;
  limit?: number;
  cursor?: string;
};

export type AssistantDriverTransactionFilters = {
  driverId: string;
  transactionType: AssistantDriverTransactionType;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  cursor?: string;
};

export type AssistantDriverCandidateQuery = {
  query?: string;
  status?: AssistantDriverStatus;
  vehicleType?: AssistantDriverVehicleType | "UNSPECIFIED";
  offset: number;
  limit: number;
};

export type AssistantDriverTransactionQuery = {
  driverId: string;
  transactionType: AssistantDriverTransactionType;
  fromInclusive?: Date;
  toExclusive?: Date;
  offset: number;
  limit: number;
};

export type AssistantDriverPeriodTotals = {
  commissions: Prisma.Decimal | null;
  payments: Prisma.Decimal | null;
  subscriptionCharges: Prisma.Decimal | null;
};

export interface AssistantDriverFinanceRepository {
  searchDriverCandidates(query: AssistantDriverCandidateQuery): Promise<{
    drivers: AssistantDriverRecord[];
    hasMore: boolean;
  }>;
  getDriver(driverId: string): Promise<AssistantDriverRecord | null>;
  getFinancialSummaries(driverIds: string[]): Promise<Map<string, DriverFinancialSummary>>;
  getFinancialSummary(driverId: string): Promise<DriverFinancialSummary>;
  listTransactions(query: AssistantDriverTransactionQuery): Promise<{
    rows: AssistantDriverTransactionRecord[];
    hasMore: boolean;
  }>;
  getPeriodTotals(query: Omit<AssistantDriverTransactionQuery, "offset" | "limit">): Promise<AssistantDriverPeriodTotals>;
}

function requireDriverAdmin(context: ReservationAccessContext) {
  if (!isDriverAdminRole(context.role)) throw new DriverAssistantForbiddenError();
}

function validateDriverId(driverId: string) {
  const normalized = driverId.trim();
  if (!normalized || normalized.length > 100) throw new DriverAssistantInputError();
  return normalized;
}

function validateLimit(value: number | undefined, fallback: number, maximum: number) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new DriverAssistantInputError();
  }
  return value;
}

function decodeCursor(cursor: string | undefined, prefix: string, maximum: number) {
  if (cursor === undefined) return 0;
  const match = new RegExp(`^${prefix}_([0-9a-z]+)$`).exec(cursor);
  if (!match) throw new DriverAssistantInputError("Invalid pagination cursor.");
  const offset = Number.parseInt(match[1], 36);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > maximum) {
    throw new DriverAssistantInputError("Invalid pagination cursor.");
  }
  return offset;
}

function encodeCursor(prefix: string, offset: number) {
  return `${prefix}_${offset.toString(36)}`;
}

export function getAssistantBalancePosition(
  balance: Prisma.Decimal,
): AssistantBalancePosition {
  if (balance.greaterThan(0)) return "DUE";
  if (balance.lessThan(0)) return "CREDIT";
  return "SETTLED";
}

function driverIdentity(driver: AssistantDriverRecord): AssistantDriverIdentityData {
  return {
    id: driver.id,
    name: driver.name,
    status: driver.status,
    vehicleType: driver.vehicleType,
    href: `/drivers/${encodeURIComponent(driver.id)}`,
  };
}

export async function searchAssistantDrivers(
  context: ReservationAccessContext,
  filters: AssistantDriverSearchFilters,
  repository: AssistantDriverFinanceRepository,
): Promise<AssistantDriverSearchResult> {
  requireDriverAdmin(context);
  const limit = validateLimit(filters.limit, ASSISTANT_DRIVER_DEFAULT_LIMIT, ASSISTANT_DRIVER_MAX_LIMIT);
  const query = filters.query?.trim();
  if (query && query.length > 100) throw new DriverAssistantInputError();
  let offset = decodeCursor(filters.cursor, "drv", 10_000);
  let scanned = 0;
  let repositoryHasMore = false;
  let unprocessedInBatch = false;
  const matches: Array<{ driver: AssistantDriverRecord; summary: DriverFinancialSummary }> = [];

  while (matches.length < limit && scanned < ASSISTANT_DRIVER_MAX_SEARCH_SCAN) {
    const batchLimit = Math.min(25, ASSISTANT_DRIVER_MAX_SEARCH_SCAN - scanned);
    const page = await repository.searchDriverCandidates({
      ...(query ? { query } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.vehicleType !== undefined ? { vehicleType: filters.vehicleType } : {}),
      offset,
      limit: batchLimit,
    });
    repositoryHasMore = page.hasMore;
    if (page.drivers.length === 0) break;
    const summaries = await repository.getFinancialSummaries(page.drivers.map((driver) => driver.id));

    let processed = 0;
    for (const driver of page.drivers) {
      processed += 1;
      scanned += 1;
      const summary = summaries.get(driver.id);
      if (!summary) throw new Error("Missing canonical driver financial summary");
      if (
        filters.balancePosition &&
        getAssistantBalancePosition(summary.balance) !== filters.balancePosition
      ) {
        continue;
      }
      matches.push({ driver, summary });
      if (matches.length === limit) break;
    }
    offset += processed;
    unprocessedInBatch = processed < page.drivers.length;
    if (matches.length === limit || !page.hasMore || unprocessedInBatch) break;
  }

  const names = new Map<string, number>();
  for (const { driver } of matches) {
    const key = driver.name.trim().toLocaleLowerCase("en");
    names.set(key, (names.get(key) ?? 0) + 1);
  }
  const hasMore = repositoryHasMore || unprocessedInBatch;
  const drivers = matches.map(({ driver, summary }) => {
    const duplicateName = (names.get(driver.name.trim().toLocaleLowerCase("en")) ?? 0) > 1;
    return {
      ...driverIdentity(driver),
      ...(duplicateName ? { licenseNumber: driver.licenseNumber } : {}),
      balance: summary.balance.toFixed(2),
      balancePosition: getAssistantBalancePosition(summary.balance),
      currency: "EUR" as const,
    };
  });

  return {
    drivers,
    count: drivers.length,
    hasMore,
    nextCursor: hasMore ? encodeCursor("drv", offset) : null,
  };
}

export async function getAssistantDriverLedgerSummary(
  context: ReservationAccessContext,
  driverId: string,
  repository: AssistantDriverFinanceRepository,
  now = new Date(),
): Promise<AssistantDriverLedgerSummaryData | null> {
  requireDriverAdmin(context);
  const normalizedId = validateDriverId(driverId);
  const driver = await repository.getDriver(normalizedId);
  if (!driver) return null;
  const summary = await repository.getFinancialSummary(driver.id);
  return {
    driver: driverIdentity(driver),
    currency: "EUR",
    totalCommissions: summary.totalCommissions.toFixed(2),
    totalPayments: summary.totalPayments.toFixed(2),
    totalSubscriptionCharges: summary.totalSubscriptionCharges.toFixed(2),
    balance: summary.balance.toFixed(2),
    balancePosition: getAssistantBalancePosition(summary.balance),
    calculatedAt: now.toISOString(),
  };
}

function parseOptionalDate(value: string | undefined) {
  if (value === undefined) return undefined;
  const parsed = parseFinancialCivilDate(value);
  if (!parsed) throw new DriverAssistantInputError("Invalid financial date.");
  return parsed;
}

function toTransactionRow(
  row: AssistantDriverTransactionRecord,
): AssistantDriverTransactionRowData {
  const date = formatFinancialCivilDate(row.date);
  const amount = row.amount.toFixed(2);
  if (row.type === "COMMISSION") {
    const reservation = row.reservation
      ? {
          id: row.reservation.id,
          href: `/reservations/${encodeURIComponent(row.reservation.id)}/edit`,
        }
      : null;
    return {
      id: row.id,
      type: row.type,
      date,
      amount,
      source: reservation ? "RESERVATION" : "MANUAL",
      route: {
        pickup: row.reservation?.pickupText ?? row.manualPickupText,
        dropoff: row.reservation?.dropoffText ?? row.manualDropoffText,
      },
      reservation,
    };
  }
  if (row.type === "PAYMENT") {
    return { id: row.id, type: row.type, date, amount, method: row.method };
  }
  return { id: row.id, type: row.type, date, amount };
}

export async function getAssistantDriverTransactions(
  context: ReservationAccessContext,
  filters: AssistantDriverTransactionFilters,
  repository: AssistantDriverFinanceRepository,
): Promise<AssistantDriverTransactionsData | null> {
  requireDriverAdmin(context);
  const driverId = validateDriverId(filters.driverId);
  const limit = validateLimit(
    filters.limit,
    ASSISTANT_DRIVER_TRANSACTION_DEFAULT_LIMIT,
    ASSISTANT_DRIVER_TRANSACTION_MAX_LIMIT,
  );
  const offset = decodeCursor(
    filters.cursor,
    "txn",
    ASSISTANT_DRIVER_MAX_TRANSACTION_OFFSET,
  );
  const fromInclusive = parseOptionalDate(filters.fromDate);
  const toInclusive = parseOptionalDate(filters.toDate);
  if (fromInclusive && toInclusive && fromInclusive > toInclusive) {
    throw new DriverAssistantInputError("The start date must not follow the end date.");
  }
  const toExclusive = toInclusive ? addFinancialCalendarDays(toInclusive, 1) : undefined;
  const driver = await repository.getDriver(driverId);
  if (!driver) return null;
  const common = {
    driverId,
    transactionType: filters.transactionType,
    ...(fromInclusive ? { fromInclusive } : {}),
    ...(toExclusive ? { toExclusive } : {}),
  };
  const [page, rawTotals] = await Promise.all([
    repository.listTransactions({ ...common, offset, limit }),
    repository.getPeriodTotals(common),
  ]);
  const totals = calculateDriverFinancialSummary(
    rawTotals.commissions,
    rawTotals.payments,
    rawTotals.subscriptionCharges,
  );
  const hasMore = page.hasMore;
  return {
    driver: driverIdentity(driver),
    transactionType: filters.transactionType,
    period: { from: filters.fromDate ?? null, to: filters.toDate ?? null },
    pageCursor: filters.cursor ?? null,
    currency: "EUR",
    totals: {
      commissions: totals.totalCommissions.toFixed(2),
      payments: totals.totalPayments.toFixed(2),
      subscriptionCharges: totals.totalSubscriptionCharges.toFixed(2),
      netChange: totals.balance.toFixed(2),
    },
    rows: page.rows.map(toTransactionRow),
    hasMore,
    nextCursor: hasMore ? encodeCursor("txn", offset + page.rows.length) : null,
  };
}
