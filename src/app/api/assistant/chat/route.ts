export const runtime = "nodejs";

import { randomUUID } from "node:crypto";
import { getAssistantAuthContext } from "@/lib/assistant/auth-context";
import { admitAssistantRequest } from "@/lib/assistant/admission";
import {
  getAssistantMaxInputChars,
  getAssistantMaxOutputTokens,
  getAssistantModelName,
  getAssistantRequestTimeoutMs,
  isAssistantEmailAllowed,
  isAssistantEnabled,
} from "@/lib/assistant/config";
import { streamOpenAIResponse } from "@/lib/assistant/openai";
import { createAssistantSafetyIdentifier } from "@/lib/assistant/privacy";
import { runReservationAssistantToolLoop } from "@/lib/assistant/tool-loop";
import { handleAssistantChatRequest } from "@/lib/assistant/transport";
import {
  getVisibleReservation,
  searchVisibleReservations,
} from "@/lib/reservations/assistant-read-service";
import { prepareReservationUpdateAction } from "@/lib/reservations/assistant-update-service";
import {
  prepareAssignDriverAction,
  prepareClearDriverAction,
} from "@/lib/reservations/assistant-driver-assignment-service";
import {
  prepareAssignDriverWithCommissionAction,
  prepareClearDriverAndCommissionAction,
  prepareUpdateReservationCommissionAction,
} from "@/lib/reservations/assistant-commission-aware-assignment-service";
import {
  getAssistantDriverLedgerSummary,
  getAssistantDriverTransactions,
  searchAssistantDrivers,
} from "@/lib/drivers/assistant-finance-service";
import {
  getCurrentReservationDraft,
  parseReservationTextAction,
  prepareCreateReservationAction,
  updateReservationDraftAction,
} from "@/lib/reservations/assistant-creation-service";
import {
  getCurrentDriverImportDraft,
  parseDriverListTextAction,
  prepareDriverImportAction,
  updateDriverImportDraftAction,
} from "@/lib/drivers/assistant-import-service";

export async function POST(request: Request) {
  return handleAssistantChatRequest(request, {
    isEnabled: isAssistantEnabled,
    isAllowed: (context) => isAssistantEmailAllowed(context.email),
    getAuthContext: getAssistantAuthContext,
    admit: admitAssistantRequest,
    run(input) {
      return runReservationAssistantToolLoop(input, {
        streamModel: streamOpenAIResponse,
        searchReservations: searchVisibleReservations,
        getReservation: getVisibleReservation,
        searchDrivers: searchAssistantDrivers,
        getDriverLedgerSummary: getAssistantDriverLedgerSummary,
        getDriverTransactions: getAssistantDriverTransactions,
        prepareUpdateReservation: prepareReservationUpdateAction,
        prepareAssignDriver: prepareAssignDriverAction,
        prepareClearDriver: prepareClearDriverAction,
        prepareAssignDriverWithCommission: prepareAssignDriverWithCommissionAction,
        prepareUpdateReservationCommission: prepareUpdateReservationCommissionAction,
        prepareClearDriverAndCommission: prepareClearDriverAndCommissionAction,
        parseReservationText: parseReservationTextAction,
        updateReservationDraft: updateReservationDraftAction,
        prepareCreateReservation: prepareCreateReservationAction,
        getCurrentReservationDraft,
        parseDriverListText: parseDriverListTextAction,
        updateDriverImportDraft: updateDriverImportDraftAction,
        prepareDriverImport: prepareDriverImportAction,
        getCurrentDriverImportDraft,
        getMaxOutputTokens: getAssistantMaxOutputTokens,
        getSafetyIdentifier: createAssistantSafetyIdentifier,
      });
    },
    getTimeoutMs: getAssistantRequestTimeoutMs,
    getMaxInputChars: getAssistantMaxInputChars,
    getModelName: getAssistantModelName,
    createRequestId: randomUUID,
    log(event) {
      const payload = {
        requestId: event.requestId,
        userId: event.userId,
        role: event.role,
        startedAt: event.startedAt,
        endedAt: event.endedAt,
        durationMs: event.durationMs,
        outcome: event.outcome,
        code: event.code,
        model: event.model,
        toolNames: event.toolNames,
        toolCallCount: event.toolCallCount,
        resultCounts: event.resultCounts,
        tokenUsage: event.tokenUsage,
        upstreamResponseId: event.upstreamResponseId,
      };
      if (event.outcome === "failure") {
        console.warn("Assistant request failed", payload);
      } else {
        console.info("Assistant request completed", payload);
      }
    },
  });
}
