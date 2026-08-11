import type {
  ReservationUpdatePatch,
  ReservationUpdateSnapshot,
} from "./update-core.ts";
import { assertReservationUpdatePatch } from "./update-core.ts";

export type OwnedReservationUpdateRepository = {
  findOwnedActive(input: {
    reservationId: string;
    ownerEmail: string;
  }): Promise<ReservationUpdateSnapshot | null>;
  updateOwnedActive(input: {
    reservationId: string;
    ownerEmail: string;
    patch: ReservationUpdatePatch;
    expectedUpdatedAt?: Date;
  }): Promise<boolean>;
  findById(reservationId: string): Promise<ReservationUpdateSnapshot | null>;
};

export class OwnedReservationNotFoundError extends Error {
  constructor() {
    super("Reservation not found.");
    this.name = "OwnedReservationNotFoundError";
  }
}

export class OwnedReservationConflictError extends Error {
  constructor() {
    super("Reservation changed before the update could be applied.");
    this.name = "OwnedReservationConflictError";
  }
}

export async function updateOwnedReservation(
  input: {
    reservationId: string;
    ownerEmail: string;
    patch: ReservationUpdatePatch;
    expectedUpdatedAt?: Date;
  },
  repository: OwnedReservationUpdateRepository,
) {
  assertReservationUpdatePatch(input.patch);
  const ownerEmail = input.ownerEmail.trim().toLowerCase();
  const current = await repository.findOwnedActive({
    reservationId: input.reservationId,
    ownerEmail,
  });
  if (!current) throw new OwnedReservationNotFoundError();

  if (
    input.expectedUpdatedAt &&
    current.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
  ) {
    throw new OwnedReservationConflictError();
  }

  if (Object.keys(input.patch).length === 0) return current;

  const updated = await repository.updateOwnedActive({
    reservationId: input.reservationId,
    ownerEmail,
    patch: input.patch,
    expectedUpdatedAt: input.expectedUpdatedAt,
  });
  if (!updated) {
    const latest = await repository.findById(input.reservationId);
    if (!latest || latest.userEmail.toLowerCase() !== ownerEmail || latest.isDeleted) {
      throw new OwnedReservationNotFoundError();
    }
    throw new OwnedReservationConflictError();
  }

  const result = await repository.findOwnedActive({
    reservationId: input.reservationId,
    ownerEmail,
  });
  if (!result) throw new OwnedReservationNotFoundError();
  return result;
}
