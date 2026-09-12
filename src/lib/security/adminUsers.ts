import bcrypt from "bcryptjs";
import { Prisma, type PrismaClient } from "@prisma/client";
import { requireUnlockedAdmin } from "./adminSecurity.ts";
import { endedSessionPrivateData, type SessionIdentity } from "./sessionCore.ts";
import { SecurityError } from "./policy.ts";

export type ManagedUserInput = { name: unknown; email: unknown; password: unknown };

function normalizeName(value: unknown) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > 100) throw new SecurityError(400, "INVALID_NAME", "Name must be 1–100 characters.");
  return name;
}

function normalizeEmail(value: unknown) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new SecurityError(400, "INVALID_EMAIL", "Enter a valid email address.");
  }
  return email;
}

function validatePassword(value: unknown) {
  if (typeof value !== "string" || value.length < 8 || value.length > 128) {
    throw new SecurityError(400, "INVALID_PASSWORD", "Password must be 8–128 characters.");
  }
  return value;
}

function safeUser(user: { id: string; name: string | null; email: string; role: string; status: string; createdAt: Date }) {
  return { ...user, createdAt: user.createdAt.toISOString() };
}

export async function listManagedUsers(db: PrismaClient, identity: SessionIdentity, now = new Date()) {
  return db.$transaction(async tx => {
    const actor = await requireUnlockedAdmin(tx, identity, now);
    const users = await tx.user.findMany({
      orderBy: [{ name: "asc" }, { email: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        _count: { select: { deviceSessions: { where: { revokedAt: null, expiresAt: { gt: now } } } } },
      },
    });
    const activeAdminCount = users.filter(user => user.role === "ADMIN" && user.status === "ACTIVE").length;
    return {
      currentUserId: actor.userId,
      users: users.map(({ _count, ...user }) => ({
        ...safeUser(user),
        activeSessions: _count.deviceSessions,
        canChangePassword: user.role === "USER",
        canDeactivate: user.status === "ACTIVE" && user.id !== actor.userId && (user.role !== "ADMIN" || activeAdminCount > 1),
        canReactivate: user.status === "INACTIVE",
      })),
    };
  });
}

export async function createManagedUser(
  db: PrismaClient,
  identity: SessionIdentity,
  input: ManagedUserInput,
  now = new Date(),
) {
  const name = normalizeName(input.name);
  const email = normalizeEmail(input.email);
  const passwordHash = await bcrypt.hash(validatePassword(input.password), 12);
  try {
    return await db.$transaction(async tx => {
      const actor = await requireUnlockedAdmin(tx, identity, now);
      const user = await tx.user.create({
        data: { name, email, password: passwordHash, role: "USER", status: "ACTIVE" },
        select: { id: true, name: true, email: true, role: true, status: true, createdAt: true },
      });
      await tx.activityLog.create({ data: {
        action: "ADMIN_USER_CREATED",
        entityType: "user",
        entityId: user.id,
        userEmail: actor.user.email,
        createdAt: now,
        metadata: {
          targetUserId: user.id,
          targetEmail: user.email,
          targetRole: user.role,
          actorUserId: actor.userId,
          actorEmail: actor.user.email,
        },
      } });
      return safeUser(user);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new SecurityError(409, "EMAIL_EXISTS", "A user with this email already exists.");
    }
    throw error;
  }
}

export async function resetManagedUserPassword(
  db: PrismaClient,
  identity: SessionIdentity,
  targetUserId: string,
  passwordInput: unknown,
  now = new Date(),
) {
  const passwordHash = await bcrypt.hash(validatePassword(passwordInput), 12);
  return db.$transaction(async tx => {
    const actor = await requireUnlockedAdmin(tx, identity, now);
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${targetUserId} FOR UPDATE`;
    const target = await tx.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, email: true, role: true, status: true },
    });
    if (!target) throw new SecurityError(404, "USER_NOT_FOUND", "User not found.");
    if (target.role !== "USER") throw new SecurityError(409, "ADMIN_PASSWORD_PROTECTED", "Administrator passwords must be changed from their own Settings page.");
    await tx.user.update({ where: { id: target.id }, data: { password: passwordHash } });
    const revoked = await tx.deviceSession.updateMany({
      where: { userId: target.id, revokedAt: null, expiresAt: { gt: now } },
      data: { revokedAt: now, revokedByUserId: actor.userId, revokeReason: "ADMIN_PASSWORD_RESET", ...endedSessionPrivateData },
    });
    await tx.activityLog.create({ data: {
      action: "ADMIN_USER_PASSWORD_CHANGED",
      entityType: "user",
      entityId: target.id,
      userEmail: actor.user.email,
      createdAt: now,
      metadata: {
        targetUserId: target.id,
        targetEmail: target.email,
        targetRole: target.role,
        actorUserId: actor.userId,
        actorEmail: actor.user.email,
        sessionsRevoked: revoked.count,
      },
    } });
    return { userId: target.id, sessionsRevoked: revoked.count };
  });
}

export async function setManagedUserActive(
  db: PrismaClient,
  identity: SessionIdentity,
  targetUserId: string,
  active: boolean,
  now = new Date(),
) {
  return db.$transaction(async tx => {
    const actor = await requireUnlockedAdmin(tx, identity, now);
    if (targetUserId === actor.userId) {
      throw new SecurityError(409, "CURRENT_ADMIN_PROTECTED", "You cannot deactivate your current administrator account.");
    }
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${targetUserId} FOR UPDATE`;
    const target = await tx.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, email: true, role: true, status: true },
    });
    if (!target) throw new SecurityError(404, "USER_NOT_FOUND", "User not found.");
    const desiredStatus = active ? "ACTIVE" : "INACTIVE";
    if (target.status === desiredStatus) return { userId: target.id, status: target.status, sessionsRevoked: 0, changed: false };
    if (!active && target.role === "ADMIN") {
      const otherActiveAdmins = await tx.user.count({ where: { id: { not: target.id }, role: "ADMIN", status: "ACTIVE" } });
      if (otherActiveAdmins === 0) throw new SecurityError(409, "LAST_ADMIN_PROTECTED", "The final active administrator cannot be deactivated.");
    }
    await tx.user.update({ where: { id: target.id }, data: { status: desiredStatus } });
    const revoked = active ? { count: 0 } : await tx.deviceSession.updateMany({
      where: { userId: target.id, revokedAt: null, expiresAt: { gt: now } },
      data: { revokedAt: now, revokedByUserId: actor.userId, revokeReason: "USER_DEACTIVATED", ...endedSessionPrivateData },
    });
    await tx.activityLog.create({ data: {
      action: active ? "ADMIN_USER_REACTIVATED" : "ADMIN_USER_DEACTIVATED",
      entityType: "user",
      entityId: target.id,
      userEmail: actor.user.email,
      createdAt: now,
      metadata: {
        targetUserId: target.id,
        targetEmail: target.email,
        targetRole: target.role,
        actorUserId: actor.userId,
        actorEmail: actor.user.email,
        sessionsRevoked: revoked.count,
      },
    } });
    return { userId: target.id, status: desiredStatus, sessionsRevoked: revoked.count, changed: true };
  });
}
