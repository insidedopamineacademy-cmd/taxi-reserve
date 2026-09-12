export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const LAST_SEEN_INTERVAL_MS = 5 * 60 * 1000;
export const SESSION_POLL_INTERVAL_MS = 60 * 1000;
export const ENDED_SESSION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const SETTINGS_UNLOCK_WINDOW_MS = 10 * 60 * 1000;
export const SETTINGS_PIN_MAX_FAILURES = 5;
export const SETTINGS_PIN_LOCKOUT_MS = 5 * 60 * 1000;

export class SecurityError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
