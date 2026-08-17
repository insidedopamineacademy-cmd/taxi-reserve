// src/lib/parseStartAt.ts

import { formatLocalInstantDateDisplay } from "./dateDisplay.ts";

/**
 * Turn an <input type="datetime-local"> value (local wall time)
 * directly into a UTC ISO string for the API/DB.
 * No manual offset arithmetic – JavaScript handles it.
 */
export function localDateTimeToUtcIso(dateTimeLocal: string) {
  if (!dateTimeLocal) return "";
  const s = dateTimeLocal.replace(" ", "T"); // "YYYY-MM-DDTHH:mm"
  const d = new Date(s);                     // interpreted as LOCAL time
  if (isNaN(d.getTime())) return "";
  return d.toISOString();                    // UTC ISO (ends with "Z")
}

/** Short relative time like "in 2h 15m" / "5m ago". */
export function relTimeFromNow(value: string | number | Date) {
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  const diff = d.getTime() - Date.now();
  const mins = Math.round(Math.abs(diff) / 60000);
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  const label = hrs >= 1 ? `${hrs}h${rem ? ` ${rem}m` : ""}` : `${mins}m`;
  return diff >= 0 ? `in ${label}` : `${label} ago`;
}

/** Local-friendly absolute formatter for display. */
export function formatLocalDateTime(value: string | number | Date) {
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${formatLocalInstantDateDisplay(d)} · ${time}`;
}
