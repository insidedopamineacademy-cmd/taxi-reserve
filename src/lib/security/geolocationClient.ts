export type LocationGateState = "checking" | "prompt" | "locating" | "denied" | "blocked" | "timeout" | "unavailable" | "unsupported" | "insecure" | "server-error" | "ready";

export async function queryLocationPermission(permissions: Permissions | undefined): Promise<PermissionStatus | null> {
  if (!permissions?.query) return null;
  try { return await permissions.query({ name: "geolocation" }); }
  catch { return null; } // Older Safari versions may not support this permission query.
}

export function locationErrorState(error: { code: number }, permission: PermissionState | undefined): LocationGateState {
  if (error.code === 1) return permission === "denied" ? "blocked" : "denied";
  return error.code === 3 ? "timeout" : "unavailable";
}

export function getOnePosition(geolocation: Geolocation) {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, maximumAge: 0, timeout: 12000 });
  });
}
