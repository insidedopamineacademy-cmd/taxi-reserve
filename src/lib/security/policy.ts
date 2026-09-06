export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const LAST_SEEN_INTERVAL_MS = 5 * 60 * 1000;
export const LOCATION_MAX_AGE_MS = 30 * 60 * 1000;
export const LOCATION_RESUME_AFTER_MS = 5 * 60 * 1000;
export const SESSION_POLL_INTERVAL_MS = 60 * 1000;
export const ENDED_SESSION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export function hasFreshLocation(verifiedAt: Date | string | null | undefined, now = new Date()) {
  if (!verifiedAt) return false;
  const age = now.getTime() - new Date(verifiedAt).getTime();
  return Number.isFinite(age) && age >= 0 && age < LOCATION_MAX_AGE_MS;
}

export function safeReturnPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\r\n]/.test(value)) return "/reservations";
  const path = value.split(/[?#]/)[0];
  if (path === "/location" || path === "/login" || path === "/register" || path.startsWith("/api/")) return "/reservations";
  return value;
}

export class SecurityError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export function parseLocationInput(body: unknown, now = new Date()) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new SecurityError(400, "INVALID_LOCATION", "Invalid location payload.");
  const data = body as Record<string, unknown>;
  if (Object.keys(data).some(key => !["latitude", "longitude", "accuracy", "capturedAt"].includes(key))) {
    throw new SecurityError(400, "INVALID_LOCATION", "Unexpected location field.");
  }
  const number = (key: string, min: number, max: number) => {
    const value = data[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
      throw new SecurityError(400, "INVALID_LOCATION", "Location coordinates or accuracy are invalid.");
    }
    return value;
  };
  const latitude = number("latitude", -90, 90);
  const longitude = number("longitude", -180, 180);
  const accuracy = number("accuracy", 0, 100000);
  const capturedAt = typeof data.capturedAt === "string" ? new Date(data.capturedAt) : new Date(NaN);
  const age = now.getTime() - capturedAt.getTime();
  if (!Number.isFinite(age) || age > 5 * 60 * 1000 || age < -60 * 1000) {
    throw new SecurityError(400, "STALE_LOCATION", "Request a fresh location and check your device clock.");
  }
  return { latitude: Number(latitude.toFixed(4)), longitude: Number(longitude.toFixed(4)), accuracy, locationCapturedAt: capturedAt, locationVerifiedAt: now };
}
