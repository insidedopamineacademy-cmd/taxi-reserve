export type LocationGateState = "checking" | "prompt" | "locating" | "denied" | "blocked" | "timeout" | "unavailable" | "unsupported" | "insecure" | "server-check-error" | "server-save-error" | "ready";

export type PermissionQueryResult = {
  status: PermissionStatus | null;
  outcome: PermissionState | "unsupported" | "unexpected" | "error";
  errorName?: string;
};

export async function inspectLocationPermission(permissions: Permissions | undefined): Promise<PermissionQueryResult> {
  if (!permissions?.query) return { status: null, outcome: "unsupported" };
  try {
    const status = await permissions.query({ name: "geolocation" });
    if (!["granted", "prompt", "denied"].includes(status.state)) return { status: null, outcome: "unexpected" };
    return { status, outcome: status.state };
  } catch (error) {
    return { status: null, outcome: "error", errorName: error instanceof Error ? error.name : "UnknownError" };
  }
}

export async function queryLocationPermission(permissions: Permissions | undefined): Promise<PermissionStatus | null> {
  return (await inspectLocationPermission(permissions)).status;
}

export function locationErrorState(error: { code: number }, permission: PermissionState | undefined): LocationGateState {
  if (error.code === 1) return permission === "denied" ? "blocked" : "denied";
  return error.code === 3 ? "timeout" : "unavailable";
}

function requestPosition(geolocation: Geolocation, enableHighAccuracy: boolean) {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy, maximumAge: 0, timeout: 18000 });
  });
}

export async function getFreshPosition(geolocation: Geolocation, onAttemptError?: (error: { code?: unknown; message?: unknown }, accuracy: "high" | "normal") => void) {
  try {
    return await requestPosition(geolocation, true);
  } catch (error) {
    onAttemptError?.(error as { code?: unknown; message?: unknown }, "high");
    const code = (error as { code?: unknown })?.code;
    if (code !== 2 && code !== 3) throw error;
    try { return await requestPosition(geolocation, false); }
    catch (fallbackError) {
      onAttemptError?.(fallbackError as { code?: unknown; message?: unknown }, "normal");
      throw fallbackError;
    }
  }
}
