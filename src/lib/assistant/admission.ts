import "server-only";

import { getAssistantMaxRequestsPerMinute } from "./config";
import {
  AssistantAdmissionController,
  type AssistantAdmissionDecision,
} from "./admission-core";
import type { ReservationAccessContext } from "../reservations/assistant-read-core";

// This singleton is deliberately process-local. It protects one application instance;
// a shared deployment-level limiter is still required for a globally authoritative cap.
const assistantAdmissionController = new AssistantAdmissionController();

export function admitAssistantRequest(
  context: ReservationAccessContext,
  nowMs: number,
): AssistantAdmissionDecision {
  return assistantAdmissionController.admit(
    context.userId,
    nowMs,
    getAssistantMaxRequestsPerMinute(),
  );
}
