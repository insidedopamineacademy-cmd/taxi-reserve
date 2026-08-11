import { AiActionExecutionRollback, type AiActionExecutor } from "./core.ts";
import {
  existingDriverMatches,
  hasIdentityCollision,
  parseStoredDriverImportAction,
  type DriverImportMutationRepository,
} from "../../drivers/import-action-core.ts";
import { normalizeDriverProfileInput } from "../../drivers/profile-core.ts";

export function createDriverImportExecutor<Transaction>(
  createRepository: (transaction: Transaction) => DriverImportMutationRepository,
): AiActionExecutor<Transaction> {
  return {
    async checkPreconditions({ transaction, action, actor }) {
      let stored;
      try {
        stored = parseStoredDriverImportAction(action.payload, action.precondition);
      } catch {
        return { kind: "CONFLICTED", code: "ACTION_INVALID_PAYLOAD" };
      }
      if (
        action.actionType !== "IMPORT_DRIVERS" ||
        actor.role !== "ADMIN" ||
        stored.precondition.ownerUserId !== actor.userId ||
        stored.precondition.ownerEmail !== actor.email.trim().toLowerCase()
      ) return { kind: "CONFLICTED", code: "ACTION_AUTHORIZATION_CHANGED" };

      const repository = createRepository(transaction);
      const candidates = await repository.findCandidates({
        licenseNumbers: [
          ...stored.precondition.existing.map((driver) => driver.licenseNumber),
          ...stored.precondition.newDrivers.map((driver) => driver.licenseNumber),
        ],
        names: [
          ...stored.precondition.existing.map((driver) => driver.name),
          ...stored.precondition.newDrivers.map((driver) => driver.name),
        ],
      });
      for (const expected of stored.precondition.existing) {
        const current = candidates.find((candidate) => candidate.id === expected.id);
        if (!current || !existingDriverMatches(current, expected)) {
          return { kind: "CONFLICTED", code: "DRIVER_IMPORT_STALE_EXISTING" };
        }
      }
      const existingIds = new Set(stored.precondition.existing.map((driver) => driver.id));
      const unrelated = candidates.filter((candidate) => !existingIds.has(candidate.id));
      if (stored.precondition.newDrivers.some((driver) => hasIdentityCollision(unrelated, driver))) {
        return { kind: "CONFLICTED", code: "DRIVER_IMPORT_NEW_IDENTITY_EXISTS" };
      }
      return { kind: "VALID" };
    },

    async execute({ transaction, action, actor }) {
      const stored = parseStoredDriverImportAction(action.payload, action.precondition);
      if (
        action.actionType !== "IMPORT_DRIVERS" ||
        actor.role !== "ADMIN" ||
        stored.precondition.ownerUserId !== actor.userId ||
        stored.precondition.ownerEmail !== actor.email.trim().toLowerCase()
      ) return { kind: "CONFLICTED", code: "ACTION_AUTHORIZATION_CHANGED" };
      const repository = createRepository(transaction);
      let updatedCount = 0;
      for (const update of stored.payload.updates) {
        const current = stored.precondition.existing.find((driver) => driver.id === update.driverId);
        if (!current) throw new AiActionExecutionRollback("CONFLICTED", "ACTION_INVALID_PAYLOAD");
        const updated = await repository.updateVehicleType({ current, vehicleType: update.vehicleType });
        if (!updated) throw new AiActionExecutionRollback("CONFLICTED", "DRIVER_IMPORT_STALE_EXISTING");
        updatedCount += 1;
        await repository.createActivity({
          action: "driver_updated",
          driverId: updated.id,
          userEmail: actor.email,
          metadata: { changedFields: ["vehicleType"], source: "driver_import" },
        });
      }

      let createdCount = 0;
      for (const create of stored.payload.creates) {
        const profile = normalizeDriverProfileInput({
          ...create,
          status: "ACTIVE",
          subscriptionExempt: false,
        });
        const created = await repository.create(profile);
        createdCount += 1;
        await repository.createActivity({
          action: "driver_created",
          driverId: created.id,
          userEmail: actor.email,
          metadata: {
            status: "ACTIVE",
            vehicleType: created.vehicleType,
            subscriptionExempt: false,
            source: "driver_import",
          },
        });
      }

      return {
        kind: "EXECUTED",
        result: {
          title: "Driver import complete",
          message: `Created: ${createdCount} · Updated: ${updatedCount} · Duplicates skipped: ${stored.payload.duplicatesSkipped}`,
          reference: { label: "Open Drivers", href: "/drivers" },
        },
        audit: {
          action: "drivers_imported",
          entityType: "driver_import",
          metadata: {
            draftId: stored.payload.draftId,
            draftRevision: stored.payload.draftRevision,
            createdCount,
            updatedCount,
            duplicateSkippedCount: stored.payload.duplicatesSkipped,
            unchangedCount: stored.payload.noOpCount,
            failureCount: 0,
          },
        },
      };
    },
  };
}
