export const SECURITY_REQUEST_HEADER = "X-Taxi-Security-Request";
export const SECURITY_REQUEST_MARKER = "security-v1";

export type SecurityRequestTrustInput = {
  expectedOrigin: string;
  origin: string | null;
  referer: string | null;
  secFetchSite: string | null;
  marker: string | null;
};

export type SecurityRequestDecision = {
  trusted: boolean;
  branch:
    | "invalid-request-origin"
    | "origin-mismatch"
    | "referer-mismatch"
    | "fetch-site-rejected"
    | "explicit-origin"
    | "marker-fallback"
    | "missing-origin-and-marker";
};

function originOf(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Same-origin security mutations normally include Origin. iOS Home Screen
 * WebKit can omit it, so the fallback requires an app-owned, non-safelisted
 * header that cross-origin JavaScript cannot send without a successful CORS
 * preflight. Any browser provenance signal that is present must still agree.
 */
export function evaluateSecurityRequest(input: SecurityRequestTrustInput): SecurityRequestDecision {
  const expectedOrigin = originOf(input.expectedOrigin);
  if (!expectedOrigin) return { trusted: false, branch: "invalid-request-origin" };

  if (input.origin !== null && originOf(input.origin) !== expectedOrigin) {
    return { trusted: false, branch: "origin-mismatch" };
  }
  if (input.referer !== null && originOf(input.referer) !== expectedOrigin) {
    return { trusted: false, branch: "referer-mismatch" };
  }
  if (input.secFetchSite !== null && !["same-origin", "none"].includes(input.secFetchSite)) {
    return { trusted: false, branch: "fetch-site-rejected" };
  }

  if (input.origin !== null) return { trusted: true, branch: "explicit-origin" };
  if (input.marker === SECURITY_REQUEST_MARKER) return { trusted: true, branch: "marker-fallback" };
  return { trusted: false, branch: "missing-origin-and-marker" };
}

export function isTrustedSecurityRequest(input: SecurityRequestTrustInput) {
  return evaluateSecurityRequest(input).trusted;
}

export function securityRequestHeaders(json = true): Record<string, string> {
  return {
    [SECURITY_REQUEST_HEADER]: SECURITY_REQUEST_MARKER,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}
