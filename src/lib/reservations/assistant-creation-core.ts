import type { AiActionPreview, AiActionPublic, JsonObject } from "../assistant/actions/contracts.ts";
import type { ReservationAccessContext } from "./assistant-read-core.ts";
import {
  createOwnedReservation,
  normalizeReservationCreationInput,
  serializeReservationCreation,
  type ReservationCreationRepository,
  type ReservationCreationSnapshot,
} from "./creation-core.ts";
import {
  extractReservationDraft,
  reservationDraftPrepareArguments,
  samePrepareCreateReservationArguments,
  toPublicReservationDraft,
  updateReservationDraft,
  type PrepareCreateReservationArguments,
  type ReservationDraftPublic,
  type ReservationDraftUpdateArguments,
} from "./reservation-draft-core.ts";
import type { ReservationDraftStore } from "./reservation-draft-store.ts";
import { formatMadridDateDisplay, formatMadridTime } from "../time/madrid.ts";

export type ReservationDraftOperationResult =
  | { kind: "DRAFT"; draft: ReservationDraftPublic }
  | { kind: "NO_DRAFT"; message: string }
  | { kind: "INVALID"; message: string };

export type PrepareCreateReservationResult =
  | { kind: "ACTION_PREVIEW"; action: AiActionPublic }
  | { kind: "NO_DRAFT"; message: string }
  | { kind: "NOT_READY"; draft: ReservationDraftPublic; message: string }
  | { kind: "DRAFT_CHANGED"; draft: ReservationDraftPublic; message: string }
  | {
      kind: "DUPLICATE_WARNING";
      draft: ReservationDraftPublic;
      duplicate: ReservationCreationSnapshot;
      message: string;
    }
  | { kind: "UNAVAILABLE"; message: string };

type DraftDependencies = {
  store: ReservationDraftStore;
  createId(): string;
  now?(): Date;
  cancelPendingAction?(input: {
    session: { userId: string; email: string };
    actionId: string;
  }): Promise<unknown>;
};

async function cancelSuperseded(
  context: ReservationAccessContext,
  actionId: string | null,
  dependencies: DraftDependencies,
) {
  if (!actionId || !dependencies.cancelPendingAction) return;
  await dependencies.cancelPendingAction({
    session: { userId: context.userId, email: context.email },
    actionId,
  });
}

export async function parseReservationTextDraft(
  context: ReservationAccessContext,
  bookingText: string,
  dependencies: DraftDependencies,
): Promise<ReservationDraftOperationResult> {
  const previous = await dependencies.store.load(context);
  await cancelSuperseded(
    context,
    previous.kind === "ACTIVE" ? previous.draft.pendingActionId : null,
    dependencies,
  );
  try {
    const draft = extractReservationDraft({
      id: dependencies.createId(),
      ownerUserId: context.userId,
      ownerEmail: context.email,
      bookingText,
      now: dependencies.now?.(),
    });
    await dependencies.store.save(draft);
    return { kind: "DRAFT", draft: toPublicReservationDraft(draft) };
  } catch (error) {
    return {
      kind: "INVALID",
      message: error instanceof Error ? error.message : "The booking text is invalid.",
    };
  }
}

export async function applyReservationDraftClarification(
  context: ReservationAccessContext,
  input: ReservationDraftUpdateArguments,
  dependencies: DraftDependencies,
): Promise<ReservationDraftOperationResult> {
  const loaded = await dependencies.store.load(context);
  if (loaded.kind === "EXPIRED") {
    return { kind: "NO_DRAFT", message: "That booking draft expired. Paste the booking details again." };
  }
  if (loaded.kind === "MISSING") {
    return { kind: "NO_DRAFT", message: "Paste the booking text first." };
  }
  const current = loaded.draft;
  try {
    const updated = updateReservationDraft(current, input, dependencies.now?.());
    if (current.pendingActionId && updated.pendingActionId === null) {
      await cancelSuperseded(context, current.pendingActionId, dependencies);
    }
    await dependencies.store.save(updated);
    return { kind: "DRAFT", draft: toPublicReservationDraft(updated) };
  } catch (error) {
    return {
      kind: "INVALID",
      message: error instanceof Error ? error.message : "The draft update is invalid.",
    };
  }
}

function previewForCreation(
  reservation: ReturnType<typeof normalizeReservationCreationInput>,
): AiActionPreview {
  return {
    title: "Create reservation",
    summary: "No reservation will be created until you tap Confirm & Create.",
    sections: [
      {
        heading: "Date and route",
        facts: [
          {
            label: "Date and time",
            value: `${formatMadridDateDisplay(reservation.startAt)} · ${formatMadridTime(reservation.startAt)}`,
          },
          { label: "Pickup", value: reservation.pickupText! },
          { label: "Drop-off", value: reservation.dropoffText! },
        ],
      },
      {
        heading: "Booking details",
        facts: [
          { label: "Phone", value: reservation.phone || "Not provided" },
          { label: "Passengers", value: String(reservation.pax) },
          {
            label: "Price",
            value: reservation.priceEuro === null
              ? "Not provided"
              : `€${reservation.priceEuro.toFixed(2)}`,
            emphasis: reservation.priceEuro === null ? "warning" : "money",
          },
          { label: "Flight", value: reservation.flight || "None" },
        ],
      },
      {
        heading: "Notes",
        facts: [{ label: "Booking notes", value: reservation.notes || "None" }],
      },
    ],
    warnings: [
      ...(reservation.priceEuro === null ? ["No agreed price was provided."] : []),
      ...(reservation.phone === null ? ["No client phone was provided."] : []),
    ],
  };
}

export async function prepareCreateReservationProposal(
  context: ReservationAccessContext,
  input: PrepareCreateReservationArguments,
  dependencies: {
    store: ReservationDraftStore;
    repository: Pick<ReservationCreationRepository, "findLikelyDuplicate">;
    prepareAction(input: {
      session: { userId: string; email: string };
      actionType: "CREATE_RESERVATION";
      payload: JsonObject;
      precondition: JsonObject;
      preview: AiActionPreview;
      confirmationLabel: string;
    }): Promise<{ ok: boolean; code?: string; action?: AiActionPublic }>;
    cancelPendingAction?(input: {
      session: { userId: string; email: string };
      actionId: string;
    }): Promise<unknown>;
    now?(): Date;
  },
): Promise<PrepareCreateReservationResult> {
  const loaded = await dependencies.store.load(context);
  if (loaded.kind === "EXPIRED") {
    return { kind: "NO_DRAFT", message: "That booking draft expired. Paste the booking details again." };
  }
  if (loaded.kind === "MISSING") {
    return { kind: "NO_DRAFT", message: "Paste the booking text first." };
  }
  const draft = loaded.draft;
  const publicDraft = toPublicReservationDraft(draft);
  if (!publicDraft.readyToPrepare) {
    return {
      kind: "NOT_READY",
      draft: publicDraft,
      message: publicDraft.question,
    };
  }

  const authoritative = reservationDraftPrepareArguments(draft);
  if (!samePrepareCreateReservationArguments(authoritative, input)) {
    return {
      kind: "DRAFT_CHANGED",
      draft: publicDraft,
      message: "The proposed values do not match the current server-owned draft.",
    };
  }

  const normalized = normalizeReservationCreationInput({
    pickupText: authoritative.pickup,
    dropoffText: authoritative.dropoff,
    serviceDate: authoritative.service_date,
    pickupTime: authoritative.pickup_time,
    pax: authoritative.passengers,
    priceEuro: authoritative.price_euro,
    phone: authoritative.phone,
    flight: authoritative.flight,
    notes: authoritative.notes,
  }, { requireOperationalFields: true });

  const duplicate = await dependencies.repository.findLikelyDuplicate({
    ownerEmail: context.email.trim().toLowerCase(),
    reservation: normalized,
  });
  if (duplicate && !draft.duplicateAcknowledged) {
    return {
      kind: "DUPLICATE_WARNING",
      draft: publicDraft,
      duplicate,
      message: "I found a similar reservation already in Taxi Reserve. Do you still want to prepare a new one?",
    };
  }

  if (draft.pendingActionId && dependencies.cancelPendingAction) {
    await dependencies.cancelPendingAction({
      session: { userId: context.userId, email: context.email },
      actionId: draft.pendingActionId,
    });
  }

  const prepared = await dependencies.prepareAction({
    session: { userId: context.userId, email: context.email },
    actionType: "CREATE_RESERVATION",
    payload: serializeReservationCreation(normalized),
    precondition: {
      ownerUserId: context.userId,
      ownerEmail: context.email.trim().toLowerCase(),
      draftId: draft.id,
      draftRevision: draft.revision,
      defaultStatus: "ASSIGNED",
      preparedAt: (dependencies.now?.() ?? new Date()).toISOString(),
    },
    preview: previewForCreation(normalized),
    confirmationLabel: "Confirm & Create",
  });
  if (!prepared.ok || !prepared.action) {
    return { kind: "UNAVAILABLE", message: "The reservation creation could not be prepared." };
  }
  await dependencies.store.save({ ...draft, pendingActionId: prepared.action.actionId });
  return { kind: "ACTION_PREVIEW", action: prepared.action };
}

// Deliberately exported for deterministic route/executor tests. The model never calls it.
export { createOwnedReservation };
