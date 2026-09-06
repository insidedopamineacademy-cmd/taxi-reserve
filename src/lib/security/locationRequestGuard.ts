export const LOCATION_REQUEST_HEADER = "X-Taxi-Location-Request";
export const LOCATION_REQUEST_MARKER = "location-v1";

export type LocationRequestTrustInput = {
  expectedOrigin: string;
  origin: string | null;
  secFetchSite: string | null;
  marker: string | null;
};

/**
 * Location writes use a non-safelisted header as their CSRF proof. Some iOS
 * Home Screen WebKit requests omit Origin, so Origin remains a strict check
 * when present instead of being the only proof that a request came from the
 * app. Cross-origin JavaScript cannot add this marker without a CORS preflight.
 */
export function isTrustedLocationRequest(input: LocationRequestTrustInput) {
  if (input.marker !== LOCATION_REQUEST_MARKER) return false;
  if (input.origin !== null && input.origin !== input.expectedOrigin) return false;
  if (input.secFetchSite !== null && !["same-origin", "none"].includes(input.secFetchSite)) return false;
  return true;
}

export function locationRequestHeaders(json = false): Record<string, string> {
  return {
    [LOCATION_REQUEST_HEADER]: LOCATION_REQUEST_MARKER,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}
