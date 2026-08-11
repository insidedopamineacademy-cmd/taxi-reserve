import type { AiActionPreview, AiActionPublic } from "../assistant/actions/contracts.ts";
import type { ReservationAccessContext } from "../reservations/assistant-read-core.ts";
import {
  analyzeDriverImportRows,
  createDriverImportDraft,
  driverImportLookup,
  toPublicDriverImportDraft,
  updateDriverImportDraft,
  type DriverImportDraftPublic,
  type DriverImportDraftUpdateArguments,
  type DriverImportExistingRepository,
  type PrepareDriverImportArguments,
} from "./import-core.ts";
import type { DriverImportDraftStore } from "./import-store.ts";
import {
  serializeDriverImportActionPayload,
  serializeDriverImportActionPrecondition,
  type DriverImportActionPayload,
  type DriverImportActionPrecondition,
} from "./import-action-core.ts";

export type DriverImportDraftOperationResult =
  | { kind: "DRAFT"; draft: DriverImportDraftPublic }
  | { kind: "NO_DRAFT"; message: string }
  | { kind: "FORBIDDEN"; message: string }
  | { kind: "INVALID"; message: string };

export type PrepareDriverImportResult =
  | { kind: "ACTION_PREVIEW"; action: AiActionPublic }
  | { kind: "NO_DRAFT"; message: string }
  | { kind: "FORBIDDEN"; message: string }
  | { kind: "NOT_READY"; draft: DriverImportDraftPublic; message: string }
  | { kind: "DRAFT_CHANGED"; draft: DriverImportDraftPublic; message: string }
  | { kind: "NO_CHANGES"; draft: DriverImportDraftPublic; message: string }
  | { kind: "UNAVAILABLE"; message: string };

type DraftDependencies = {
  store: DriverImportDraftStore;
  repository: DriverImportExistingRepository;
  createDraftId(): string;
  createRowId(index: number): string;
  now?(): Date;
  cancelPendingAction?(input: {
    session: { userId: string; email: string };
    actionId: string;
  }): Promise<unknown>;
};

async function cancelSuperseded(
  context: ReservationAccessContext,
  actionId: string | null,
  dependencies: Pick<DraftDependencies, "cancelPendingAction">,
) {
  if (!actionId || !dependencies.cancelPendingAction) return;
  await dependencies.cancelPendingAction({
    session: { userId: context.userId, email: context.email },
    actionId,
  });
}

export async function parseDriverListDraft(
  context: ReservationAccessContext,
  text: string,
  dependencies: DraftDependencies,
): Promise<DriverImportDraftOperationResult> {
  if (context.role !== "ADMIN") {
    return { kind: "FORBIDDEN", message: "Driver import is unavailable for this account." };
  }
  const previous = await dependencies.store.load(context);
  await cancelSuperseded(
    context,
    previous.kind === "ACTIVE" ? previous.draft.pendingActionId : null,
    dependencies,
  );
  try {
    const draft = await createDriverImportDraft({
      id: dependencies.createDraftId(),
      ownerUserId: context.userId,
      ownerEmail: context.email,
      text,
      createRowId: dependencies.createRowId,
      repository: dependencies.repository,
      now: dependencies.now?.(),
    });
    const stored = await dependencies.store.save(draft);
    return { kind: "DRAFT", draft: toPublicDriverImportDraft(stored) };
  } catch (error) {
    return {
      kind: "INVALID",
      message: error instanceof Error ? error.message : "The driver list is invalid.",
    };
  }
}

export async function applyDriverImportClarification(
  context: ReservationAccessContext,
  input: DriverImportDraftUpdateArguments,
  dependencies: DraftDependencies,
): Promise<DriverImportDraftOperationResult> {
  if (context.role !== "ADMIN") {
    return { kind: "FORBIDDEN", message: "Driver import is unavailable for this account." };
  }
  const loaded = await dependencies.store.load(context);
  if (loaded.kind === "EXPIRED") {
    return { kind: "NO_DRAFT", message: "That driver import draft expired. Paste the driver list again." };
  }
  if (loaded.kind === "MISSING") {
    return { kind: "NO_DRAFT", message: "Paste the driver list first." };
  }
  try {
    const updated = await updateDriverImportDraft(
      loaded.draft,
      input,
      dependencies.repository,
      dependencies.now?.(),
    );
    if (loaded.draft.pendingActionId && updated.pendingActionId === null) {
      await cancelSuperseded(context, loaded.draft.pendingActionId, dependencies);
    }
    const stored = await dependencies.store.save(updated);
    return { kind: "DRAFT", draft: toPublicDriverImportDraft(stored) };
  } catch (error) {
    return {
      kind: "INVALID",
      message: error instanceof Error ? error.message : "The driver draft update is invalid.",
    };
  }
}

function analysisSignature(rows: ReturnType<typeof analyzeDriverImportRows>) {
  return JSON.stringify(rows.map((row) => ({
    id: row.id,
    name: row.name,
    licenseNumber: row.licenseNumber,
    vehicleType: row.vehicleType,
    state: row.state,
    issues: row.issues,
    existing: row.existing
      ? {
          id: row.existing.id,
          name: row.existing.name,
          licenseNumber: row.existing.licenseNumber,
          vehicleType: row.existing.vehicleType,
          status: row.existing.status,
          subscriptionExempt: row.existing.subscriptionExempt,
          updatedAt: row.existing.updatedAt.toISOString(),
        }
      : null,
  })));
}

function groupedFacts(lines: string[]) {
  const chunks: Array<{ label: string; value: string }> = [];
  let start = 0;
  let values: string[] = [];
  const flush = () => {
    if (values.length === 0) return;
    const end = start + values.length;
    chunks.push({
      label: lines.length === values.length ? "Drivers" : `${start + 1}–${end}`,
      value: values.join("\n"),
    });
    start = end;
    values = [];
  };
  for (const line of lines) {
    const candidate = [...values, line].join("\n");
    if (values.length > 0 && (values.length >= 6 || candidate.length > 500)) flush();
    values.push(line);
  }
  flush();
  return chunks;
}

function appendFactSections(
  sections: AiActionPreview["sections"],
  heading: string,
  facts: Array<{ label: string; value: string }>,
) {
  for (let index = 0; index < facts.length; index += 12) {
    const slice = facts.slice(index, index + 12);
    sections.push({
      heading: facts.length <= 12
        ? heading
        : `${heading} ${index + 1}–${index + slice.length}`,
      facts: slice,
    });
  }
}

function previewForImport(
  payload: DriverImportActionPayload,
  updateRows: Array<{
    name: string;
    licenseNumber: string;
    vehicleType: string;
    previousVehicleType: string;
  }>,
): AiActionPreview {
  const sections: AiActionPreview["sections"] = [
    {
      heading: "Import summary",
      facts: [
        { label: "New drivers", value: String(payload.creates.length) },
        { label: "Existing drivers to update", value: String(payload.updates.length) },
        { label: "Existing unchanged", value: String(payload.noOpCount) },
        { label: "Duplicates skipped", value: String(payload.duplicatesSkipped) },
      ],
    },
  ];
  if (payload.creates.length > 0) {
    appendFactSections(
      sections,
      "New drivers",
      groupedFacts(payload.creates.map(
        (row) => `${row.name} · ${row.licenseNumber} · ${row.vehicleType}`,
      )),
    );
  }
  if (updateRows.length > 0) {
    appendFactSections(
      sections,
      "Vehicle type updates",
      groupedFacts(updateRows.map(
        (row) => `${row.name} · ${row.licenseNumber}: ${row.previousVehicleType} → ${row.vehicleType}`,
      )),
    );
  }
  return {
    title: "Import drivers",
    summary: "No driver is created or updated until you tap Confirm Import.",
    sections,
    warnings: [
      "New drivers will be ACTIVE and not subscription-exempt.",
      "Only reviewed vehicleType changes can update existing drivers; names, codes, status, subscriptions, and finance will not change.",
      "Source notes and raw vehicle model text are review-only and will not be stored.",
    ],
  };
}

export async function prepareDriverImportProposal(
  context: ReservationAccessContext,
  input: PrepareDriverImportArguments,
  dependencies: DraftDependencies & {
    prepareAction(input: {
      session: { userId: string; email: string };
      actionType: "IMPORT_DRIVERS";
      payload: ReturnType<typeof serializeDriverImportActionPayload>;
      precondition: ReturnType<typeof serializeDriverImportActionPrecondition>;
      preview: AiActionPreview;
      confirmationLabel: string;
    }): Promise<{ ok: boolean; action?: AiActionPublic }>;
  },
): Promise<PrepareDriverImportResult> {
  if (context.role !== "ADMIN") {
    return { kind: "FORBIDDEN", message: "Driver import is unavailable for this account." };
  }
  const loaded = await dependencies.store.load(context);
  if (loaded.kind === "EXPIRED") {
    return { kind: "NO_DRAFT", message: "That driver import draft expired. Paste the driver list again." };
  }
  if (loaded.kind === "MISSING") {
    return { kind: "NO_DRAFT", message: "Paste the driver list first." };
  }
  const draft = loaded.draft;
  if (input.draft_id !== draft.id || input.revision !== draft.revision) {
    return {
      kind: "DRAFT_CHANGED",
      draft: toPublicDriverImportDraft(draft),
      message: "The requested driver import revision does not match the server-owned draft.",
    };
  }
  const existing = await dependencies.repository.findCandidates(driverImportLookup(draft.rows));
  const latestRows = analyzeDriverImportRows(draft.rows, existing);
  if (analysisSignature(latestRows) !== analysisSignature(draft.rows)) {
    await cancelSuperseded(context, draft.pendingActionId, dependencies);
    const refreshed = await dependencies.store.save({
      ...draft,
      revision: draft.revision + 1,
      rows: latestRows,
      completeConfirmed: false,
      pendingActionId: null,
      updatedAt: dependencies.now?.() ?? new Date(),
    });
    return {
      kind: "DRAFT_CHANGED",
      draft: toPublicDriverImportDraft(refreshed),
      message: "Existing driver data changed. Review the refreshed import before confirming.",
    };
  }
  const publicDraft = toPublicDriverImportDraft(draft);
  if (!publicDraft.readyToPrepare) {
    return { kind: "NOT_READY", draft: publicDraft, message: publicDraft.question };
  }

  const creates = draft.rows.filter((row) => row.state === "NEW").map((row) => ({
    name: row.name!,
    licenseNumber: row.licenseNumber!,
    vehicleType: row.vehicleType!,
  }));
  const updateRows = draft.rows.filter((row) => row.state === "EXISTING_UPDATE");
  const updates = updateRows.map((row) => ({
    driverId: row.existing!.id,
    vehicleType: row.vehicleType!,
  }));
  const noOpCount = draft.rows.filter((row) => row.state === "EXISTING_MATCH").length;
  if (creates.length === 0 && updates.length === 0) {
    return {
      kind: "NO_CHANGES",
      draft: publicDraft,
      message: "Every reviewed driver already matches Taxi Reserve; there is nothing to import.",
    };
  }
  const payload: DriverImportActionPayload = {
    draftId: draft.id,
    draftRevision: draft.revision,
    creates,
    updates,
    duplicatesSkipped: publicDraft.duplicateRowsSkipped,
    noOpCount,
  };
  const precondition: DriverImportActionPrecondition = {
    ownerUserId: context.userId,
    ownerEmail: context.email.trim().toLowerCase(),
    preparedAt: (dependencies.now?.() ?? new Date()).toISOString(),
    existing: updateRows.map((row) => row.existing!),
    newDrivers: creates.map(({ name, licenseNumber }) => ({ name, licenseNumber })),
  };
  await cancelSuperseded(context, draft.pendingActionId, dependencies);
  const prepared = await dependencies.prepareAction({
    session: { userId: context.userId, email: context.email },
    actionType: "IMPORT_DRIVERS",
    payload: serializeDriverImportActionPayload(payload),
    precondition: serializeDriverImportActionPrecondition(precondition),
    preview: previewForImport(payload, updateRows.map((row) => ({
      name: row.name!,
      licenseNumber: row.licenseNumber!,
      vehicleType: row.vehicleType!,
      previousVehicleType: row.existing!.vehicleType ?? "Not set",
    }))),
    confirmationLabel: "Confirm Import",
  });
  if (!prepared.ok || !prepared.action) {
    return { kind: "UNAVAILABLE", message: "The driver import could not be prepared." };
  }
  await dependencies.store.save({ ...draft, pendingActionId: prepared.action.actionId });
  return { kind: "ACTION_PREVIEW", action: prepared.action };
}
