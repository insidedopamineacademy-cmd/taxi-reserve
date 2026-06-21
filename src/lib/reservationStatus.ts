export type EditableReservationStatusCode = "ASSIGNED" | "COMPLETED";
export type ReservationStatusLabel = "Cobrado" | "Falta cobrar por el conductor";

export const RESERVATION_STATUS_OPTIONS: Array<{
  code: EditableReservationStatusCode;
  label: ReservationStatusLabel;
}> = [
  { code: "COMPLETED", label: "Cobrado" },
  { code: "ASSIGNED", label: "Falta cobrar por el conductor" },
];

export function parseReservationStatusCode(value: unknown): EditableReservationStatusCode | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, "_");

  switch (normalized) {
    case "PENDING":
    case "ASSIGNED":
    case "R_RECEIVED":
    case "UNPAID_CONFIRMED":
    case "FALTA_COBRAR_POR_EL_CONDUCTOR":
      return "ASSIGNED";
    case "COMPLETED":
    case "PAID_CONFIRMED":
    case "COBRADO":
      return "COMPLETED";
    default:
      return null;
  }
}

export function normalizeReservationStatusCode(value: unknown): EditableReservationStatusCode {
  return parseReservationStatusCode(value) ?? "ASSIGNED";
}

export function reservationStatusLabel(value: unknown): ReservationStatusLabel {
  const code = normalizeReservationStatusCode(value);
  return (
    RESERVATION_STATUS_OPTIONS.find((option) => option.code === code)?.label ??
    "Falta cobrar por el conductor"
  );
}

export function nextReservationStatusCode(value: unknown): EditableReservationStatusCode {
  const current = normalizeReservationStatusCode(value);
  const index = RESERVATION_STATUS_OPTIONS.findIndex((option) => option.code === current);
  return RESERVATION_STATUS_OPTIONS[(index + 1) % RESERVATION_STATUS_OPTIONS.length].code;
}
