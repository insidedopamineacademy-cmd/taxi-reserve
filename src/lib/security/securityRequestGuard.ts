export const SECURITY_REQUEST_HEADER = "X-Taxi-Security-Request";
export const SECURITY_REQUEST_MARKER = "security-v1";

export type SecurityRequestTrustInput = {
  expectedOrigin: string;
  origin: string | null;
  referer: string | null;
  secFetchSite: string | null;
  marker: string | null;
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
export function isTrustedSecurityRequest(input: SecurityRequestTrustInput) {
  const expectedOrigin = originOf(input.expectedOrigin);
  if (!expectedOrigin) return false;

  if (input.origin !== null && originOf(input.origin) !== expectedOrigin) return false;
  if (input.referer !== null && originOf(input.referer) !== expectedOrigin) return false;
  if (input.secFetchSite !== null && !["same-origin", "none"].includes(input.secFetchSite)) return false;

  return input.origin !== null || input.marker === SECURITY_REQUEST_MARKER;
}

export function securityRequestHeaders(json = true): Record<string, string> {
  return {
    [SECURITY_REQUEST_HEADER]: SECURITY_REQUEST_MARKER,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}
