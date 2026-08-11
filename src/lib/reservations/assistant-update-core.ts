import type { ReservationAccessContext } from "./assistant-read-core.ts";
import {
  buildReservationAssistantPatch,
  reservationUpdateBeforeValues,
  reservationUpdateChangedFields,
  serializeReservationUpdatePatch,
  type PrepareReservationUpdateArguments,
  type ReservationUpdateField,
  type ReservationUpdatePatch,
  type ReservationUpdateSnapshot,
} from "./update-core.ts";
import type {
  AiActionPreview,
  AiActionPublic,
  JsonObject,
} from "../assistant/actions/contracts.ts";
import { formatMadridDate, formatMadridTime } from "../time/madrid.ts";

export type PrepareReservationUpdateResult =
  | { kind: "ACTION_PREVIEW"; action: AiActionPublic }
  | { kind: "NO_CHANGES"; message: string }
  | { kind: "NOT_FOUND"; message: string }
  | { kind: "UNAVAILABLE"; message: string };

export type ReservationUpdateProposalDependencies = {
  findOwnedActive(input: {
    reservationId: string;
    ownerEmail: string;
  }): Promise<ReservationUpdateSnapshot | null>;
  prepareAction(input: {
    session: { userId: string; email: string };
    actionType: "UPDATE_RESERVATION";
    payload: JsonObject;
    precondition: JsonObject;
    preview: AiActionPreview;
    confirmationLabel: string;
  }): Promise<{ ok: boolean; action?: AiActionPublic }>;
};

function displayText(value: string | null) {
  if (value === null || value === "") return "Not provided";
  return value;
}

function compactText(value: string | null, maximum = 240) {
  const text = displayText(value);
  return text.length > maximum ? `${text.slice(0, maximum - 1)}…` : text;
}

function dateTimeText(value: Date | null) {
  return value
    ? `${formatMadridDate(value)} · ${formatMadridTime(value)}`
    : "Not provided";
}

function patchValue(patch: ReservationUpdatePatch, field: ReservationUpdateField) {
  return patch[field] as ReservationUpdateSnapshot[ReservationUpdateField];
}

function fieldFact(
  current: ReservationUpdateSnapshot,
  patch: ReservationUpdatePatch,
  field: ReservationUpdateField,
) {
  const next = patchValue(patch, field);
  if (field === "startAt") {
    return {
      label: "Pickup date/time",
      previousValue: dateTimeText(current.startAt),
      value: dateTimeText(next as Date),
    };
  }
  if (field === "endAt") {
    return {
      label: "End date/time",
      previousValue: dateTimeText(current.endAt),
      value: dateTimeText(next as Date | null),
    };
  }
  if (field === "pax") {
    return { label: "Passengers", previousValue: String(current.pax), value: String(next) };
  }
  const labels = {
    pickupText: "Pickup",
    dropoffText: "Drop-off",
    phone: "Phone",
    flight: "Flight",
    notes: "Notes",
  } as const;
  const maximum = field === "notes" ? 240 : 500;
  return {
    label: labels[field],
    previousValue: compactText(current[field] as string | null, maximum),
    value: compactText(next as string | null, maximum),
  };
}

function buildPreview(
  current: ReservationUpdateSnapshot,
  patch: ReservationUpdatePatch,
  fields: readonly ReservationUpdateField[],
): AiActionPreview {
  return {
    title: "Update reservation",
    summary: "Review these exact changes before they are applied.",
    sections: [
      {
        heading: "Reservation",
        facts: [
          { label: "Date and time", value: dateTimeText(current.startAt) },
          {
            label: "Route",
            value: `${displayText(current.pickupText)} → ${displayText(current.dropoffText)}`,
          },
        ],
      },
      {
        heading: "Changes",
        facts: fields.map((field) => fieldFact(current, patch, field)),
      },
    ],
  };
}

export async function prepareReservationUpdateProposal(
  context: ReservationAccessContext,
  input: PrepareReservationUpdateArguments,
  dependencies: ReservationUpdateProposalDependencies,
): Promise<PrepareReservationUpdateResult> {
  const current = await dependencies.findOwnedActive({
    reservationId: input.reservation_id,
    ownerEmail: context.email.trim().toLowerCase(),
  });
  if (!current) {
    return { kind: "NOT_FOUND", message: "That reservation is unavailable for this account." };
  }

  const patch = buildReservationAssistantPatch(current, input);
  const fields = reservationUpdateChangedFields(patch);
  if (fields.length === 0) {
    return { kind: "NO_CHANGES", message: "No changes are needed." };
  }

  const payload: JsonObject = {
    reservationId: current.id,
    changes: serializeReservationUpdatePatch(patch),
  };
  const precondition: JsonObject = {
    reservationId: current.id,
    updatedAt: current.updatedAt.toISOString(),
    ownerUserId: context.userId,
    ownerEmail: current.userEmail,
    isDeleted: false,
    before: reservationUpdateBeforeValues(current, fields),
  };
  const result = await dependencies.prepareAction({
    session: { userId: context.userId, email: context.email },
    actionType: "UPDATE_RESERVATION",
    payload,
    precondition,
    preview: buildPreview(current, patch, fields),
    confirmationLabel: "Confirm changes",
  });

  if (result.ok && result.action) {
    return { kind: "ACTION_PREVIEW", action: result.action };
  }
  return { kind: "UNAVAILABLE", message: "The reservation update could not be prepared." };
}
