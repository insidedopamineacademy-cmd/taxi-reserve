import "server-only";

import {
  getAssistantDriverLedgerSummary as getAssistantDriverLedgerSummaryCore,
  getAssistantDriverTransactions as getAssistantDriverTransactionsCore,
  searchAssistantDrivers as searchAssistantDriversCore,
  type AssistantDriverSearchFilters,
  type AssistantDriverTransactionFilters,
} from "@/lib/drivers/assistant-finance-core";
import { assistantDriverFinanceRepository } from "@/lib/drivers/assistant-finance-repository";
import type { ReservationAccessContext } from "@/lib/reservations/assistant-read-core";

export function searchAssistantDrivers(
  context: ReservationAccessContext,
  filters: AssistantDriverSearchFilters,
) {
  return searchAssistantDriversCore(context, filters, assistantDriverFinanceRepository);
}

export function getAssistantDriverLedgerSummary(
  context: ReservationAccessContext,
  driverId: string,
) {
  return getAssistantDriverLedgerSummaryCore(
    context,
    driverId,
    assistantDriverFinanceRepository,
  );
}

export function getAssistantDriverTransactions(
  context: ReservationAccessContext,
  filters: AssistantDriverTransactionFilters,
) {
  return getAssistantDriverTransactionsCore(
    context,
    filters,
    assistantDriverFinanceRepository,
  );
}
