export type LocationPlatform = "iOS Safari" | "iOS Chrome" | "iOS browser" | "Android Chrome" | "Safari" | "Chrome" | "Other";

export type LocationRuntimeDiagnostic = {
  geolocationAvailable: boolean;
  secureContext: boolean;
  visibility: "visible" | "hidden" | "prerender" | "unknown";
  navigatorStandalone: boolean | null;
  displayModeStandalone: boolean;
  protocol: "https:" | "http:" | "other";
  platform: LocationPlatform;
};

export type SafeGeolocationError = {
  code: number;
  name: "PERMISSION_DENIED" | "POSITION_UNAVAILABLE" | "TIMEOUT" | "UNKNOWN";
  message: string;
};

function isIOS(userAgent: string, platform: string, maxTouchPoints: number) {
  return /iPhone|iPad|iPod/i.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
}

export function classifyLocationPlatform(userAgent: string, platform = "", maxTouchPoints = 0): LocationPlatform {
  if (isIOS(userAgent, platform, maxTouchPoints)) {
    if (/CriOS/i.test(userAgent)) return "iOS Chrome";
    if (/Version\//i.test(userAgent) && /Safari\//i.test(userAgent)) return "iOS Safari";
    return "iOS browser";
  }
  if (/Android/i.test(userAgent) && /Chrome|Chromium/i.test(userAgent)) return "Android Chrome";
  if (/Chrome|Chromium/i.test(userAgent)) return "Chrome";
  if (/Safari/i.test(userAgent)) return "Safari";
  return "Other";
}

export function isStandaloneWebApp(navigatorLike: { standalone?: unknown }, matchMediaLike?: (query: string) => { matches: boolean }) {
  return navigatorLike.standalone === true || Boolean(matchMediaLike?.("(display-mode: standalone)").matches);
}

export function collectLocationRuntimeDiagnostic(
  windowLike: { isSecureContext: boolean; location: { protocol: string }; matchMedia?: (query: string) => { matches: boolean } },
  navigatorLike: { geolocation?: unknown; standalone?: unknown; userAgent: string; platform?: string; maxTouchPoints?: number },
  documentLike: { visibilityState: string },
): LocationRuntimeDiagnostic {
  const protocol = windowLike.location.protocol === "https:" || windowLike.location.protocol === "http:" ? windowLike.location.protocol : "other";
  const visibility = ["visible", "hidden", "prerender"].includes(documentLike.visibilityState)
    ? documentLike.visibilityState as LocationRuntimeDiagnostic["visibility"]
    : "unknown";
  return {
    geolocationAvailable: Boolean(navigatorLike.geolocation),
    secureContext: windowLike.isSecureContext,
    visibility,
    navigatorStandalone: typeof navigatorLike.standalone === "boolean" ? navigatorLike.standalone : null,
    displayModeStandalone: Boolean(windowLike.matchMedia?.("(display-mode: standalone)").matches),
    protocol,
    platform: classifyLocationPlatform(navigatorLike.userAgent, navigatorLike.platform, navigatorLike.maxTouchPoints),
  };
}

export function geolocationErrorName(code: number): SafeGeolocationError["name"] {
  if (code === 1) return "PERMISSION_DENIED";
  if (code === 2) return "POSITION_UNAVAILABLE";
  if (code === 3) return "TIMEOUT";
  return "UNKNOWN";
}

export function safeGeolocationError(error: { code?: unknown; message?: unknown }): SafeGeolocationError {
  const code = typeof error.code === "number" && Number.isFinite(error.code) ? error.code : 0;
  const message = typeof error.message === "string"
    ? error.message.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 160)
    : "";
  return { code, name: geolocationErrorName(code), message };
}
