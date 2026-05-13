export type EditableReservationStatusCode = "PENDING" | "ASSIGNED" | "COMPLETED";
export type ReservationStatusLabel = "Pending" | "Paid Confirmed" | "Unpaid Confirmed";

export const RESERVATION_STATUS_OPTIONS: Array<{
  code: EditableReservationStatusCode;
  label: ReservationStatusLabel;
}> = [
  { code: "PENDING", label: "Pending" },
  { code: "COMPLETED", label: "Paid Confirmed" },
  { code: "ASSIGNED", label: "Unpaid Confirmed" },
];

export function parseReservationStatusCode(value: unknown): EditableReservationStatusCode | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, "_");

  switch (normalized) {
    case "PENDING":
      return "PENDING";
    case "ASSIGNED":
    case "R_RECEIVED":
    case "UNPAID_CONFIRMED":
      return "ASSIGNED";
    case "COMPLETED":
    case "PAID_CONFIRMED":
      return "COMPLETED";
    default:
      return null;
  }
}

export function normalizeReservationStatusCode(value: unknown): EditableReservationStatusCode {
  return parseReservationStatusCode(value) ?? "PENDING";
}

export function reservationStatusLabel(value: unknown): ReservationStatusLabel {
  const code = normalizeReservationStatusCode(value);
  return RESERVATION_STATUS_OPTIONS.find((option) => option.code === code)?.label ?? "Pending";
}

export function nextReservationStatusCode(value: unknown): EditableReservationStatusCode {
  const current = normalizeReservationStatusCode(value);
  const index = RESERVATION_STATUS_OPTIONS.findIndex((option) => option.code === current);
  return RESERVATION_STATUS_OPTIONS[(index + 1) % RESERVATION_STATUS_OPTIONS.length].code;
}
