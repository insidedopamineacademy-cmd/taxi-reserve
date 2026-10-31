import bcrypt from "bcryptjs";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  SETTINGS_PIN_LOCKOUT_MS,
  SETTINGS_PIN_MAX_FAILURES,
  SETTINGS_UNLOCK_WINDOW_MS,
  SecurityError,
} from "./policy.ts";
import { validateDeviceSession, type SessionIdentity } from "./sessionCore.ts";

type Database = PrismaClient | Prisma.TransactionClient;

export function validateSettingsPin(pin: unknown) {
  if (typeof pin !== "string" || !/^\d{6,8}$/.test(pin)) {
    throw new SecurityError(400, "INVALID_PIN", "Use a 6–8 digit security PIN.");
  }
  return pin;
}

async function lockIdentity(tx: Prisma.TransactionClient, identity: SessionIdentity, now = new Date()) {
  if (typeof identity.sub !== "string" || typeof identity.sid !== "string") {
    throw new SecurityError(401, "UNAUTHORIZED", "Sign in again.");
  }
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${identity.sub} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "DeviceSession" WHERE "id" = ${identity.sid} FOR UPDATE`;
  const actor = await validateDeviceSession(tx, identity, now, false);
  if (!actor) throw new SecurityError(401, "UNAUTHORIZED", "Sign in again.");
  if (actor.user.role !== "ADMIN") {
    throw new SecurityError(403, "FORBIDDEN", "Administrator access required.");
  }
  return actor;
}

export async function requireUnlockedAdmin(
  tx: Prisma.TransactionClient,
  identity: SessionIdentity,
  now = new Date(),
) {
  const actor = await lockIdentity(tx, identity, now);
  if (!actor.settingsUnlockedUntil || actor.settingsUnlockedUntil <= now) {
    throw new SecurityError(423, "SETTINGS_LOCKED", "Unlock protected settings to continue.");
  }
  return actor;
}

/**
 * Re-verifies, inside a transaction, that the caller is an authenticated, ACTIVE
 * administrator with a valid device session, locking the actor rows FOR UPDATE.
 * Same guarantees as requireUnlockedAdmin minus the Settings PIN gate — for
 * financial-admin actions that, like driver payments/commissions, are not
 * PIN-gated. Never trusts a client-supplied role.
 */
export async function requireActiveAdmin(
  tx: Prisma.TransactionClient,
  identity: SessionIdentity,
  now = new Date(),
) {
  return lockIdentity(tx, identity, now);
}

export async function getAdminSecurityStatus(db: Database, identity: SessionIdentity, now = new Date()) {
  const actor = await validateDeviceSession(db, identity, now, false);
  if (!actor) throw new SecurityError(401, "UNAUTHORIZED", "Sign in again.");
  if (actor.user.role !== "ADMIN") throw new SecurityError(403, "FORBIDDEN", "Administrator access required.");
  const security = await db.user.findUnique({
    where: { id: actor.userId },
    select: { settingsPinHash: true, settingsPinLockedUntil: true },
  });
  if (!security) throw new SecurityError(401, "UNAUTHORIZED", "Sign in again.");
  return {
    configured: Boolean(security.settingsPinHash),
    unlocked: Boolean(actor.settingsUnlockedUntil && actor.settingsUnlockedUntil > now),
    unlockedUntil: actor.settingsUnlockedUntil && actor.settingsUnlockedUntil > now
      ? actor.settingsUnlockedUntil.toISOString()
      : null,
    lockedUntil: security.settingsPinLockedUntil && security.settingsPinLockedUntil > now
      ? security.settingsPinLockedUntil.toISOString()
      : null,
  };
}

export async function setupAdminSecurityPin(
  db: PrismaClient,
  identity: SessionIdentity,
  currentPassword: string,
  pinInput: unknown,
  now = new Date(),
) {
  const pin = validateSettingsPin(pinInput);
  if (!currentPassword) throw new SecurityError(400, "INVALID_PASSWORD", "Current account password is required.");
  const pinHash = await bcrypt.hash(pin, 12);
  return db.$transaction(async tx => {
    const actor = await lockIdentity(tx, identity, now);
    const user = await tx.user.findUnique({ where: { id: actor.userId } });
    if (!user?.password) throw new SecurityError(409, "PASSWORD_UNAVAILABLE", "This account has no password configured.");
    if (user.settingsPinHash) throw new SecurityError(409, "PIN_ALREADY_CONFIGURED", "A Settings PIN is already configured.");
    if (!(await bcrypt.compare(currentPassword, user.password))) {
      throw new SecurityError(400, "INVALID_PASSWORD", "Current account password is incorrect.");
    }
    const unlockedUntil = new Date(now.getTime() + SETTINGS_UNLOCK_WINDOW_MS);
    await tx.user.update({ where: { id: user.id }, data: {
      settingsPinHash: pinHash,
      settingsPinFailedAttempts: 0,
      settingsPinLockedUntil: null,
    } });
    await tx.deviceSession.update({ where: { id: actor.id }, data: { settingsUnlockedUntil: unlockedUntil } });
    await tx.activityLog.create({ data: {
      action: "ADMIN_SETTINGS_PIN_CONFIGURED",
      entityType: "user",
      entityId: user.id,
      userEmail: actor.user.email,
      metadata: { actorUserId: actor.userId, actorEmail: actor.user.email, sessionId: actor.id, unlockedUntil: unlockedUntil.toISOString() },
    } });
    return { unlockedUntil };
  });
}

export async function unlockAdminSettings(
  db: PrismaClient,
  identity: SessionIdentity,
  pinInput: unknown,
  now = new Date(),
) {
  const pin = validateSettingsPin(pinInput);
  const result = await db.$transaction(async tx => {
    const actor = await lockIdentity(tx, identity, now);
    const user = await tx.user.findUnique({ where: { id: actor.userId } });
    if (!user?.settingsPinHash) throw new SecurityError(409, "PIN_NOT_CONFIGURED", "Set a Settings PIN first.");
    if (user.settingsPinLockedUntil && user.settingsPinLockedUntil > now) {
      throw new SecurityError(429, "PIN_LOCKED", "Too many incorrect attempts. Try again in a few minutes.");
    }
    const correct = await bcrypt.compare(pin, user.settingsPinHash);
    if (!correct) {
      const previousFailures = user.settingsPinLockedUntil && user.settingsPinLockedUntil <= now
        ? 0
        : user.settingsPinFailedAttempts;
      const failureCount = previousFailures + 1;
      const lockedUntil = failureCount >= SETTINGS_PIN_MAX_FAILURES
        ? new Date(now.getTime() + SETTINGS_PIN_LOCKOUT_MS)
        : null;
      await tx.user.update({ where: { id: user.id }, data: {
        settingsPinFailedAttempts: lockedUntil ? 0 : failureCount,
        settingsPinLockedUntil: lockedUntil,
      } });
      await tx.activityLog.create({ data: {
        action: "ADMIN_SETTINGS_UNLOCK_FAILED",
        entityType: "user",
        entityId: user.id,
        userEmail: actor.user.email,
        metadata: {
          actorUserId: actor.userId,
          actorEmail: actor.user.email,
          sessionId: actor.id,
          failureCount,
          lockedUntil: lockedUntil?.toISOString() ?? null,
        },
      } });
      return { failure: lockedUntil ? "PIN_LOCKED" as const : "INVALID_PIN" as const };
    }
    const unlockedUntil = new Date(now.getTime() + SETTINGS_UNLOCK_WINDOW_MS);
    await tx.user.update({ where: { id: user.id }, data: { settingsPinFailedAttempts: 0, settingsPinLockedUntil: null } });
    await tx.deviceSession.update({ where: { id: actor.id }, data: { settingsUnlockedUntil: unlockedUntil } });
    await tx.activityLog.create({ data: {
      action: "ADMIN_SETTINGS_UNLOCKED",
      entityType: "device_session",
      entityId: actor.id,
      userEmail: actor.user.email,
      metadata: { actorUserId: actor.userId, actorEmail: actor.user.email, sessionId: actor.id, unlockedUntil: unlockedUntil.toISOString() },
    } });
    return { unlockedUntil, failure: null };
  });
  if (result.failure) {
    throw new SecurityError(
      result.failure === "PIN_LOCKED" ? 429 : 400,
      result.failure,
      result.failure === "PIN_LOCKED" ? "Too many incorrect attempts. Try again in a few minutes." : "Incorrect security PIN.",
    );
  }
  return { unlockedUntil: result.unlockedUntil };
}

export async function lockAdminSettings(db: PrismaClient, identity: SessionIdentity) {
  return db.$transaction(async tx => {
    const actor = await lockIdentity(tx, identity);
    await tx.deviceSession.update({ where: { id: actor.id }, data: { settingsUnlockedUntil: null } });
    await tx.activityLog.create({ data: {
      action: "ADMIN_SETTINGS_LOCKED",
      entityType: "device_session",
      entityId: actor.id,
      userEmail: actor.user.email,
      metadata: { actorUserId: actor.userId, actorEmail: actor.user.email, sessionId: actor.id },
    } });
    return { locked: true };
  });
}
