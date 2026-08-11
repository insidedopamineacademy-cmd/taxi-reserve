export type AssistantRole = "user" | "assistant";

export type AssistantRequestState = "idle" | "submitting" | "generating" | "failed";

export type AssistantStatusKind = "thinking" | "searching" | "complete";

export type AssistantErrorKind =
  | "generic"
  | "network"
  | "timeout"
  | "rate-limited"
  | "unauthorized"
  | "malformed"
  | "no-results";

export type AssistantReservationDriver =
  | { visibility: "assigned"; name: string }
  | { visibility: "unassigned" }
  | { visibility: "hidden" };

export type AssistantReservationResult = {
  id: string;
  dateLabel: string;
  timeLabel: string;
  pickup: string;
  dropoff: string;
  passengerCount: number;
  flight?: string | null;
  passengerName?: string | null;
  statusLabel?: string | null;
  bookingReference?: string | null;
  phone?: string | null;
  driver: AssistantReservationDriver;
  href?: string;
  fixture?: boolean;
};

export type AssistantDriverResult = AssistantDriverCardData & { fixture?: boolean };
export type AssistantDriverFinancialSummary = AssistantDriverFinancialSummaryCardData & { fixture?: boolean };
export type AssistantDriverTransactions = AssistantDriverTransactionsCardData & { fixture?: boolean };

export type AssistantMessagePart =
  | { type: "text"; text: string }
  | { type: "status"; status: AssistantStatusKind; label: string }
  | { type: "reservation"; reservation: AssistantReservationResult }
  | { type: "driver"; driver: AssistantDriverResult }
  | { type: "driver-financial-summary"; summary: AssistantDriverFinancialSummary }
  | { type: "driver-transactions"; transactions: AssistantDriverTransactions }
  | {
      type: "error";
      kind: AssistantErrorKind;
      title: string;
      message: string;
      retryable: boolean;
    }
  | { type: "interrupted"; message: string };

export type AssistantMessage = {
  id: string;
  role: AssistantRole;
  parts: AssistantMessagePart[];
};

export type AssistantPreviewScenario =
  | "empty"
  | "conversation"
  | "thinking"
  | "searching"
  | "reservation"
  | "driver-finance"
  | "long-response"
  | "long-conversation"
  | "error"
  | "stopped";
import type {
  AssistantDriverCardData,
  AssistantDriverFinancialSummaryCardData,
  AssistantDriverTransactionsCardData,
} from "../../lib/assistant/stream-protocol.ts";
