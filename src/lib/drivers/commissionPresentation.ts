import { formatFinancialDateDisplay } from "./financialValidation.ts";
import { formatMadridDateDisplay, formatMadridTime } from "../time/madrid.ts";

export type CommissionPresentationInput = {
  entryDate: Date;
  reservation?: {
    id: string;
    startAt: Date;
    pickupText: string | null;
    dropoffText: string | null;
  } | null;
  subscriptionCharge?: {
    id: string;
    chargeMonth: Date;
  } | null;
  manualPickupText?: string | null;
  manualDropoffText?: string | null;
};

export type CommissionPresentation = {
  date: string;
  time: string | null;
  pickupText: string | null;
  dropoffText: string | null;
  classification: string;
  reference: string | null;
  source: "reservation" | "subscription" | "manual" | "unclassified";
};

function formatMonth(chargeMonth: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(chargeMonth);
}

/**
 * Produces one commission presentation from explicit stored relationships.
 * It never associates a reservation by comparing dates or amounts.
 */
export function resolveCommissionPresentation(
  entry: CommissionPresentationInput,
): CommissionPresentation {
  if (entry.reservation) {
    return {
      date: formatMadridDateDisplay(entry.reservation.startAt),
      time: formatMadridTime(entry.reservation.startAt),
      pickupText: entry.reservation.pickupText,
      dropoffText: entry.reservation.dropoffText,
      classification: "Reservation commission",
      reference: entry.reservation.id,
      source: "reservation",
    };
  }

  if (entry.subscriptionCharge) {
    return {
      date: formatFinancialDateDisplay(entry.entryDate),
      time: null,
      pickupText: null,
      dropoffText: null,
      classification: `Subscription · ${formatMonth(entry.subscriptionCharge.chargeMonth)}`,
      reference: entry.subscriptionCharge.id,
      source: "subscription",
    };
  }

  const hasManualRoute = Boolean(
    entry.manualPickupText || entry.manualDropoffText,
  );
  return {
    date: formatFinancialDateDisplay(entry.entryDate),
    time: null,
    pickupText: entry.manualPickupText ?? null,
    dropoffText: entry.manualDropoffText ?? null,
    classification: hasManualRoute ? "Manual commission" : "Commission entry",
    reference: null,
    source: hasManualRoute ? "manual" : "unclassified",
  };
}
