export const runtime = "nodejs";

import { getAssistantAuthContext } from "@/lib/assistant/auth-context";
import {
  aiActionJsonResponse,
  invalidAiActionRequestResponse,
  isSameOriginAiActionRequest,
  validateEmptyAiActionRequest,
} from "@/lib/assistant/actions/http";
import { cancelAssistantAction } from "@/lib/assistant/actions/service";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  if (!isSameOriginAiActionRequest(request)) return invalidAiActionRequestResponse(403);
  if (!(await validateEmptyAiActionRequest(request))) {
    return invalidAiActionRequestResponse();
  }

  const context = await getAssistantAuthContext();
  if (!context) {
    return aiActionJsonResponse({ ok: false, code: "UNAUTHENTICATED" });
  }
  const { id } = await params;
  if (!id || id.length > 200) return invalidAiActionRequestResponse();

  const result = await cancelAssistantAction({
    session: { userId: context.userId, email: context.email },
    actionId: id,
  });
  return aiActionJsonResponse(result);
}
