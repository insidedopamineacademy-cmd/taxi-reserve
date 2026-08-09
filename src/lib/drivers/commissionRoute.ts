export const MANUAL_COMMISSION_ROUTE_MAX_LENGTH = 500;

type RouteTextResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

export function parseManualCommissionRouteText(
  value: unknown,
  label: "Pickup" | "Drop-off",
): RouteTextResult {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null };
  }
  if (typeof value !== "string") {
    return { ok: false, error: `${label} must be text.` };
  }

  const text = value.trim();
  if (text.length > MANUAL_COMMISSION_ROUTE_MAX_LENGTH) {
    return {
      ok: false,
      error: `${label} must be ${MANUAL_COMMISSION_ROUTE_MAX_LENGTH} characters or fewer.`,
    };
  }

  return { ok: true, value: text || null };
}

export type CommissionRouteInput = {
  reservation?: {
    id: string;
    pickupText: string | null;
    dropoffText: string | null;
  } | null;
  manualPickupText?: string | null;
  manualDropoffText?: string | null;
};

export function resolveCommissionRoute(entry: CommissionRouteInput) {
  if (entry.reservation) {
    return {
      pickupText: entry.reservation.pickupText,
      dropoffText: entry.reservation.dropoffText,
      source: "reservation" as const,
      reservationId: entry.reservation.id,
    };
  }

  return {
    pickupText: entry.manualPickupText ?? null,
    dropoffText: entry.manualDropoffText ?? null,
    source: "manual" as const,
    reservationId: null,
  };
}

export function formatCommissionRoute(
  route: Pick<ReturnType<typeof resolveCommissionRoute>, "pickupText" | "dropoffText">,
) {
  return `${route.pickupText || "Pickup not set"} → ${route.dropoffText || "Drop-off not set"}`;
}
