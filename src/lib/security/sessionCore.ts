import { randomUUID } from "node:crypto";
import type { PrismaClient, Prisma } from "@prisma/client";
import { parseDeviceMetadata, trustedNetworkMetadata } from "./deviceMetadata.ts";
import { ENDED_SESSION_RETENTION_MS, LAST_SEEN_INTERVAL_MS, SESSION_MAX_AGE_SECONDS, SecurityError } from "./policy.ts";

export type SessionIdentity = { sid?: unknown; sub?: unknown };
type Reader = Pick<PrismaClient, "deviceSession">;
// Nullable GPS columns remain only for migration compatibility. New sessions never
// populate them; clearing them retires any data written by an older deployment.
const clearedPrivateData = {
  latitude: null, longitude: null, accuracy: null, locationCapturedAt: null, locationVerifiedAt: null,
  ipAddress: null, networkCity: null, networkRegion: null, networkCountry: null, userAgent: null,
};

export async function validateDeviceSession(db: Reader, identity: SessionIdentity, now = new Date(), touch = true) {
  if (typeof identity.sid !== "string" || !/^[0-9a-f-]{36}$/i.test(identity.sid) || typeof identity.sub !== "string") return null;
  const record = await db.deviceSession.findUnique({ where: { id: identity.sid }, select: {
    id: true, userId: true, lastSeenAt: true, expiresAt: true, revokedAt: true,
    user: { select: { id: true, email: true, name: true, role: true } },
  } });
  if (!record || record.userId !== identity.sub || record.revokedAt || record.expiresAt <= now) return null;
  if (touch && record.lastSeenAt.getTime() <= now.getTime() - LAST_SEEN_INTERVAL_MS) {
    // The predicate prevents simultaneous requests from causing duplicate writes.
    await db.deviceSession.updateMany({
      where: { id: record.id, revokedAt: null, expiresAt: { gt: now }, lastSeenAt: { lte: new Date(now.getTime() - LAST_SEEN_INTERVAL_MS) } },
      data: { lastSeenAt: now },
    });
  }
  return record;
}

export async function createDeviceSession(db: PrismaClient, userId: string, verifiedPasswordHash: string, headers: Headers, now = new Date()) {
  return db.$transaction(async tx => {
    // Serialize login with password changes / account-wide revocation. Re-check
    // the hash after obtaining the lock so a password changed during bcrypt
    // verification cannot create a new session using the old password.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || user.password !== verifiedPasswordHash) throw new SecurityError(401, "LOGIN_CHANGED", "Please sign in again.");
    const session = await tx.deviceSession.create({ data: {
      id: randomUUID(), userId, createdAt: now, lastSeenAt: now,
      expiresAt: new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000),
      ...parseDeviceMetadata(headers.get("user-agent")), ...trustedNetworkMetadata(headers),
    }, select: {
      id: true, userId: true, createdAt: true, lastSeenAt: true, expiresAt: true,
      revokedAt: true, revokedByUserId: true, revokeReason: true, userAgent: true,
      device: true, browser: true, os: true, ipAddress: true, networkCity: true,
      networkRegion: true, networkCountry: true,
    } });
    await tx.activityLog.create({ data: {
      action: "user_login", entityType: "device_session", entityId: session.id, userEmail: user.email,
      createdAt: now,
      // One immutable login snapshot per new session. Explicit fields keep
      // credentials, cookies, raw UA and legacy GPS columns out.
      metadata: {
        eventType: "LOGIN", userId, sessionId: session.id, role: user.role,
        isCurrentSessionAtLogin: true,
        device: session.device, browser: session.browser, os: session.os,
        ipAddress: session.ipAddress, networkCity: session.networkCity,
        networkRegion: session.networkRegion, networkCountry: session.networkCountry,
      },
    } });
    return { session, user };
  });
}

async function requireAdmin(tx: Prisma.TransactionClient, identity: SessionIdentity, now: Date) {
  const actor = await validateDeviceSession(tx, identity, now, false);
  if (!actor) throw new SecurityError(401, "UNAUTHORIZED", "Sign in again.");
  if (actor.user.role !== "ADMIN") throw new SecurityError(403, "FORBIDDEN", "Administrator access required.");
  return actor;
}

export async function revokeDeviceSession(db: PrismaClient, identity: SessionIdentity, targetId: string, now = new Date()) {
  return db.$transaction(async tx => {
    const actor = await requireAdmin(tx, identity, now);
    if (targetId === actor.id) throw new SecurityError(409, "CURRENT_DEVICE", "Use Sign out to log out this device.");
    const target = await tx.deviceSession.findUnique({ where: { id: targetId } });
    if (!target) throw new SecurityError(404, "NOT_FOUND", "Session not found.");
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${target.userId} FOR UPDATE`;
    const result = await tx.deviceSession.updateMany({ where: { id: targetId, revokedAt: null, expiresAt: { gt: now } }, data: {
      revokedAt: now, revokedByUserId: actor.userId, revokeReason: "ADMIN_REVOKED", ...clearedPrivateData,
    } });
    if (result.count) await tx.activityLog.create({ data: {
      action: "device_session_revoked", entityType: "device_session", entityId: targetId, userEmail: actor.user.email,
      metadata: { targetUserId: target.userId, actorSessionId: actor.id },
    } });
    return { changed: result.count };
  });
}

export async function revokeOtherSessions(db: PrismaClient, identity: SessionIdentity, userId: string, expectedIds: string[], now = new Date()) {
  return db.$transaction(async tx => {
    const actor = await requireAdmin(tx, identity, now);
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const targets = await tx.deviceSession.findMany({ where: { userId, id: { not: actor.id }, revokedAt: null, expiresAt: { gt: now } }, select: { id: true } });
    const ids = targets.map(row => row.id).sort();
    if (ids.length === 0) return { changed: 0 };
    if (JSON.stringify(ids) !== JSON.stringify([...new Set(expectedIds)].sort())) {
      throw new SecurityError(409, "SESSIONS_CHANGED", "The device list changed. Refresh it and confirm the new count.");
    }
    const result = await tx.deviceSession.updateMany({ where: { id: { in: ids }, revokedAt: null }, data: {
      revokedAt: now, revokedByUserId: actor.userId, revokeReason: "ADMIN_REVOKED_ALL", ...clearedPrivateData,
    } });
    await tx.activityLog.create({ data: {
      action: "other_device_sessions_revoked", entityType: "user", entityId: userId, userEmail: actor.user.email,
      metadata: { sessionIds: ids, count: result.count, actorSessionId: actor.id },
    } });
    return { changed: result.count };
  });
}

export async function logoutDeviceSession(db: PrismaClient, identity: SessionIdentity, now = new Date()) {
  return db.$transaction(async tx => {
    const record = await validateDeviceSession(tx, identity, now, false);
    if (!record) return;
    const result = await tx.deviceSession.updateMany({ where: { id: record.id, revokedAt: null }, data: {
      revokedAt: now, revokedByUserId: record.userId, revokeReason: "SIGNED_OUT", ...clearedPrivateData,
    } });
    if (result.count) await tx.activityLog.create({ data: {
      action: "user_logout", entityType: "device_session", entityId: record.id, userEmail: record.user.email,
    } });
  });
}

export async function changePasswordAndRevokeOthers(db: PrismaClient, identity: SessionIdentity, previousHash: string, newHash: string, now = new Date()) {
  return db.$transaction(async tx => {
    const actor = await validateDeviceSession(tx, identity, now, false);
    if (!actor) throw new SecurityError(401, "UNAUTHORIZED", "Sign in again.");
    const changed = await tx.user.updateMany({ where: { id: actor.userId, password: previousHash }, data: { password: newHash } });
    if (!changed.count) throw new SecurityError(409, "PASSWORD_CHANGED", "The password changed. Try again.");
    const revoked = await tx.deviceSession.updateMany({ where: { userId: actor.userId, id: { not: actor.id }, revokedAt: null, expiresAt: { gt: now } }, data: {
      revokedAt: now, revokedByUserId: actor.userId, revokeReason: "PASSWORD_CHANGED", ...clearedPrivateData,
    } });
    await tx.activityLog.create({ data: {
      action: "user_password_changed", entityType: "user", entityId: actor.userId, userEmail: actor.user.email,
      metadata: { otherSessionsRevoked: revoked.count, actorSessionId: actor.id },
    } });
    return { revoked: revoked.count };
  });
}

export async function cleanupDeviceSessions(db: PrismaClient, now = new Date()) {
  return db.$transaction(async tx => {
    const scrubbed = await tx.deviceSession.updateMany({ where: {
      OR: [{ expiresAt: { lte: now } }, { revokedAt: { not: null } }],
      AND: [{ OR: [{ latitude: { not: null } }, { ipAddress: { not: null } }, { userAgent: { not: null } }, { networkCity: { not: null } }, { networkRegion: { not: null } }, { networkCountry: { not: null } }] }],
    }, data: clearedPrivateData });
    const cutoff = new Date(now.getTime() - ENDED_SESSION_RETENTION_MS);
    const deleted = await tx.deviceSession.deleteMany({ where: { OR: [{ expiresAt: { lte: cutoff } }, { revokedAt: { lte: cutoff } }] } });
    return { scrubbed: scrubbed.count, deleted: deleted.count };
  });
}
