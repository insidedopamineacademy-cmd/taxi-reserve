import type { AiActionCommandCode, AiActionCommandResult } from "./core.ts";

export function aiActionCommandStatus(code: AiActionCommandCode) {
  if (code === "UNAUTHENTICATED") return 401;
  if (code === "ACTION_FORBIDDEN") return 403;
  if (code === "ACTION_NOT_FOUND") return 404;
  if (code === "ACTION_FAILED") return 422;
  if (
    code === "ACTION_EXPIRED" ||
    code === "ACTION_CONFLICTED" ||
    code === "ACTION_IN_PROGRESS" ||
    code === "ACTION_UNAVAILABLE"
  ) {
    return 409;
  }
  return 200;
}

export function aiActionJsonResponse(result: AiActionCommandResult) {
  return new Response(JSON.stringify(result), {
    status: aiActionCommandStatus(result.code),
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      pragma: "no-cache",
      vary: "Cookie",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function validateEmptyAiActionRequest(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > 2) return false;
  const body = (await request.text()).trim();
  return body === "" || body === "{}";
}

export function isSameOriginAiActionRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost || request.headers.get("host") || new URL(request.url).host;
  const protocol = request.headers.get("x-forwarded-proto") || new URL(request.url).protocol.replace(":", "");
  try {
    return new URL(origin).origin === `${protocol}://${host}`;
  } catch {
    return false;
  }
}

export function invalidAiActionRequestResponse(status = 400) {
  return new Response(
    JSON.stringify({
      ok: false,
      code: status === 403 ? "ACTION_ORIGIN_FORBIDDEN" : "ACTION_REQUEST_INVALID",
    }),
    {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}
