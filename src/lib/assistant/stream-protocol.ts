export const ASSISTANT_STREAM_CONTENT_TYPE = "text/event-stream; charset=utf-8";
export const ASSISTANT_MAX_STREAM_FRAME_BYTES = 128_000;

export type AssistantReservationCardData = {
  id: string;
  dateLabel: string;
  timeLabel: string;
  pickup: string;
  dropoff: string;
  phone?: string | null;
  passengerCount: number;
  flight?: string | null;
  statusLabel?: string | null;
  driver:
    | { visibility: "assigned"; name: string }
    | { visibility: "unassigned" }
    | { visibility: "hidden" };
  href: string;
};

export type {
  AssistantDriverResultData as AssistantDriverCardData,
  AssistantDriverLedgerSummaryData as AssistantDriverFinancialSummaryCardData,
  AssistantDriverTransactionsData as AssistantDriverTransactionsCardData,
} from "../drivers/assistant-finance-core.ts";
import type {
  AssistantDriverResultData,
  AssistantDriverLedgerSummaryData,
  AssistantDriverTransactionsData,
} from "../drivers/assistant-finance-core.ts";

export type AssistantStreamEvent =
  | {
      type: "assistant.status";
      status: "thinking" | "searching";
      label: string;
    }
  | { type: "assistant.text.delta"; delta: string }
  | {
      type: "assistant.reservation_result";
      reservation: AssistantReservationCardData;
    }
  | { type: "assistant.driver_result"; driver: AssistantDriverResultData }
  | {
      type: "assistant.driver_financial_summary";
      summary: AssistantDriverLedgerSummaryData;
    }
  | {
      type: "assistant.driver_transactions";
      transactions: AssistantDriverTransactionsData;
    }
  | { type: "assistant.complete"; requestId: string }
  | {
      type: "assistant.error";
      error: {
        code: string;
        message: string;
        retryable: boolean;
        requestId: string;
      };
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isDriver(value: unknown): value is AssistantReservationCardData["driver"] {
  if (!isRecord(value) || typeof value.visibility !== "string") return false;
  if (value.visibility === "assigned") {
    return hasOnlyKeys(value, ["visibility", "name"]) && typeof value.name === "string";
  }
  return (
    (value.visibility === "unassigned" || value.visibility === "hidden") &&
    hasOnlyKeys(value, ["visibility"])
  );
}

function isNullableString(value: unknown) {
  return value === undefined || value === null || typeof value === "string";
}

function isReservationCard(value: unknown): value is AssistantReservationCardData {
  if (!isRecord(value)) return false;
  return (
    hasOnlyKeys(value, [
      "id",
      "dateLabel",
      "timeLabel",
      "pickup",
      "dropoff",
      "phone",
      "passengerCount",
      "flight",
      "statusLabel",
      "driver",
      "href",
    ]) &&
    typeof value.id === "string" &&
    typeof value.dateLabel === "string" &&
    typeof value.timeLabel === "string" &&
    typeof value.pickup === "string" &&
    typeof value.dropoff === "string" &&
    isNullableString(value.phone) &&
    Number.isInteger(value.passengerCount) &&
    (value.passengerCount as number) >= 0 &&
    isNullableString(value.flight) &&
    isNullableString(value.statusLabel) &&
    isDriver(value.driver) &&
    typeof value.href === "string" &&
    value.href.startsWith("/reservations/")
  );
}

function isDecimalString(value: unknown) {
  return typeof value === "string" && /^-?\d+\.\d{2}$/.test(value);
}

function isCivilDateString(value: unknown) {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3]);
}

function isDriverStatus(value: unknown) {
  return value === "ACTIVE" || value === "INACTIVE";
}

function isVehicleType(value: unknown) {
  return value === null || value === "VAN" || value === "SEDAN";
}

function isBalancePosition(value: unknown) {
  return value === "DUE" || value === "SETTLED" || value === "CREDIT";
}

function isDriverIdentity(value: unknown) {
  return isRecord(value) &&
    hasOnlyKeys(value, ["id", "name", "status", "vehicleType", "href"]) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    isDriverStatus(value.status) &&
    isVehicleType(value.vehicleType) &&
    typeof value.href === "string" &&
    value.href.startsWith("/drivers/");
}

function isDriverCard(value: unknown): value is AssistantDriverResultData {
  return isRecord(value) &&
    hasOnlyKeys(value, ["id", "name", "status", "vehicleType", "href", "licenseNumber", "balance", "balancePosition", "currency"]) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    isDriverStatus(value.status) &&
    isVehicleType(value.vehicleType) &&
    typeof value.href === "string" &&
    value.href.startsWith("/drivers/") &&
    (value.licenseNumber === undefined || typeof value.licenseNumber === "string") &&
    isDecimalString(value.balance) &&
    isBalancePosition(value.balancePosition) &&
    value.currency === "EUR";
}

function isDriverSummary(value: unknown): value is AssistantDriverLedgerSummaryData {
  return isRecord(value) &&
    hasOnlyKeys(value, ["driver", "currency", "totalCommissions", "totalPayments", "totalSubscriptionCharges", "balance", "balancePosition", "calculatedAt"]) &&
    isDriverIdentity(value.driver) &&
    value.currency === "EUR" &&
    isDecimalString(value.totalCommissions) &&
    isDecimalString(value.totalPayments) &&
    isDecimalString(value.totalSubscriptionCharges) &&
    isDecimalString(value.balance) &&
    isBalancePosition(value.balancePosition) &&
    typeof value.calculatedAt === "string" &&
    Number.isFinite(Date.parse(value.calculatedAt));
}

function isRoute(value: unknown) {
  return isRecord(value) &&
    hasOnlyKeys(value, ["pickup", "dropoff"]) &&
    (value.pickup === null || typeof value.pickup === "string") &&
    (value.dropoff === null || typeof value.dropoff === "string");
}

function isReservationLink(value: unknown) {
  return value === null || (
    isRecord(value) &&
    hasOnlyKeys(value, ["id", "href"]) &&
    typeof value.id === "string" &&
    typeof value.href === "string" &&
    value.href.startsWith("/reservations/")
  );
}

function isTransactionRow(value: unknown) {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  const common = typeof value.id === "string" &&
    isCivilDateString(value.date) &&
    isDecimalString(value.amount);
  if (!common) return false;
  if (value.type === "COMMISSION") {
    return hasOnlyKeys(value, ["id", "type", "date", "amount", "source", "route", "reservation"]) &&
      (value.source === "RESERVATION" || value.source === "MANUAL") &&
      isRoute(value.route) &&
      isReservationLink(value.reservation);
  }
  if (value.type === "PAYMENT") {
    return hasOnlyKeys(value, ["id", "type", "date", "amount", "method"]) &&
      (value.method === "CASH" || value.method === "BANK" || value.method === "OTHER");
  }
  return value.type === "SUBSCRIPTION" &&
    hasOnlyKeys(value, ["id", "type", "date", "amount"]);
}

function isDriverTransactions(value: unknown): value is AssistantDriverTransactionsData {
  if (!isRecord(value) || !hasOnlyKeys(value, ["driver", "transactionType", "period", "pageCursor", "currency", "totals", "rows", "hasMore", "nextCursor"])) {
    return false;
  }
  const period = value.period;
  const totals = value.totals;
  return isDriverIdentity(value.driver) &&
    (value.transactionType === "ALL" || value.transactionType === "COMMISSION" || value.transactionType === "PAYMENT" || value.transactionType === "SUBSCRIPTION") &&
    isRecord(period) &&
    hasOnlyKeys(period, ["from", "to"]) &&
    (period.from === null || isCivilDateString(period.from)) &&
    (period.to === null || isCivilDateString(period.to)) &&
    (value.pageCursor === null || typeof value.pageCursor === "string") &&
    value.currency === "EUR" &&
    isRecord(totals) &&
    hasOnlyKeys(totals, ["commissions", "payments", "subscriptionCharges", "netChange"]) &&
    isDecimalString(totals.commissions) &&
    isDecimalString(totals.payments) &&
    isDecimalString(totals.subscriptionCharges) &&
    isDecimalString(totals.netChange) &&
    Array.isArray(value.rows) &&
    value.rows.length <= 25 &&
    value.rows.every(isTransactionRow) &&
    typeof value.hasMore === "boolean" &&
    (value.nextCursor === null || typeof value.nextCursor === "string");
}

export function parseAssistantStreamEvent(value: unknown): AssistantStreamEvent {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error("Malformed assistant stream event");
  }

  if (value.type === "assistant.status") {
    if (
      hasOnlyKeys(value, ["type", "status", "label"]) &&
      (value.status === "thinking" || value.status === "searching") &&
      typeof value.label === "string"
    ) {
      return value as AssistantStreamEvent;
    }
  } else if (value.type === "assistant.text.delta") {
    if (
      hasOnlyKeys(value, ["type", "delta"]) &&
      typeof value.delta === "string"
    ) {
      return value as AssistantStreamEvent;
    }
  } else if (value.type === "assistant.reservation_result") {
    if (
      hasOnlyKeys(value, ["type", "reservation"]) &&
      isReservationCard(value.reservation)
    ) {
      return value as AssistantStreamEvent;
    }
  } else if (value.type === "assistant.driver_result") {
    if (hasOnlyKeys(value, ["type", "driver"]) && isDriverCard(value.driver)) {
      return value as AssistantStreamEvent;
    }
  } else if (value.type === "assistant.driver_financial_summary") {
    if (hasOnlyKeys(value, ["type", "summary"]) && isDriverSummary(value.summary)) {
      return value as AssistantStreamEvent;
    }
  } else if (value.type === "assistant.driver_transactions") {
    if (hasOnlyKeys(value, ["type", "transactions"]) && isDriverTransactions(value.transactions)) {
      return value as AssistantStreamEvent;
    }
  } else if (value.type === "assistant.complete") {
    if (
      hasOnlyKeys(value, ["type", "requestId"]) &&
      typeof value.requestId === "string"
    ) {
      return value as AssistantStreamEvent;
    }
  } else if (value.type === "assistant.error") {
    const error = value.error;
    if (
      hasOnlyKeys(value, ["type", "error"]) &&
      isRecord(error) &&
      hasOnlyKeys(error, ["code", "message", "retryable", "requestId"]) &&
      typeof error.code === "string" &&
      typeof error.message === "string" &&
      typeof error.retryable === "boolean" &&
      typeof error.requestId === "string"
    ) {
      return value as AssistantStreamEvent;
    }
  }

  throw new Error("Malformed assistant stream event");
}

export function encodeAssistantStreamEvent(event: AssistantStreamEvent) {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export class AssistantSseDecoder {
  private buffer = "";

  push(chunk: string) {
    this.buffer += chunk.replace(/\r\n/g, "\n");
    if (new TextEncoder().encode(this.buffer).byteLength > ASSISTANT_MAX_STREAM_FRAME_BYTES) {
      throw new Error("Assistant stream frame is too large");
    }

    const events: AssistantStreamEvent[] = [];
    let boundary = this.buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const frame = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      if (frame.trim()) events.push(this.parseFrame(frame));
      boundary = this.buffer.indexOf("\n\n");
    }
    return events;
  }

  finish() {
    if (this.buffer.trim()) throw new Error("Assistant stream ended mid-event");
  }

  private parseFrame(frame: string) {
    let eventName = "";
    const data: string[] = [];

    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      else if (line && !line.startsWith(":")) {
        throw new Error("Malformed assistant stream frame");
      }
    }

    if (!eventName || data.length === 0) {
      throw new Error("Malformed assistant stream frame");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(data.join("\n"));
    } catch {
      throw new Error("Malformed assistant stream JSON");
    }

    const event = parseAssistantStreamEvent(parsed);
    if (event.type !== eventName) throw new Error("Assistant stream event mismatch");
    return event;
  }
}
