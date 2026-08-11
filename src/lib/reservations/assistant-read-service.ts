import "server-only";

import {
  getReservationForAssistant,
  searchReservationsForAssistant,
  type ReservationAccessContext,
  type ReservationSearchFilters,
} from "./assistant-read-core";
import { prismaAssistantReservationRepository } from "./assistant-read-repository";

export function searchVisibleReservations(
  context: ReservationAccessContext,
  filters: ReservationSearchFilters,
) {
  return searchReservationsForAssistant(
    context,
    filters,
    prismaAssistantReservationRepository,
  );
}

export function getVisibleReservation(
  context: ReservationAccessContext,
  reservationId: string,
) {
  return getReservationForAssistant(
    context,
    reservationId,
    prismaAssistantReservationRepository,
  );
}
