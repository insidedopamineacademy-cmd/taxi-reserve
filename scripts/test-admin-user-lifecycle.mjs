import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import {
  createManagedUser,
  listManagedUsers,
  resetManagedUserPassword,
  setManagedUserActive,
} from "../src/lib/security/adminUsers.ts";
import {
  getAdminSecurityStatus,
  lockAdminSettings,
  requireUnlockedAdmin,
  setupAdminSecurityPin,
  unlockAdminSettings,
} from "../src/lib/security/adminSecurity.ts";
import { createDeviceSession, validateDeviceSession } from "../src/lib/security/sessionCore.ts";

const databaseUrl = process.env.ADMIN_USER_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("Set ADMIN_USER_TEST_DATABASE_URL to a disposable local PostgreSQL database.");
const parsed = new URL(databaseUrl);
if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || !parsed.pathname.toLowerCase().includes("test")) throw new Error("Refusing non-local or non-test database.");

const db = new PrismaClient({ datasourceUrl: databaseUrl });
const run = randomUUID();
const now = new Date();
const adminPassword = "AdminExisting2026!";
const oldWorkerPassword = "WorkerOld2026!";
const newWorkerPassword = "WorkerNew2026!";
const pin = "731905";
const headers = new Headers({ "user-agent": "Mozilla/5.0 Test Safari" });
const identity = session => ({ sid: session.id, sub: session.userId });

async function counts(user) {
  return {
    user: await db.user.count({ where: { id: user.id } }),
    reservations: await db.reservation.count({ where: { userEmail: user.email } }),
    reminders: await db.reminder.count({ where: { userEmail: user.email } }),
    activity: await db.activityLog.count({ where: { userEmail: user.email } }),
    subscriptionRecorder: await db.driverSubscriptionCharge.count({ where: { paidByUserId: user.id } }),
    pendingActions: await db.aiPendingAction.count({ where: { userId: user.id } }),
    workflowDrafts: await db.aiWorkflowDraft.count({ where: { userId: user.id } }),
  };
}

try {
  const adminHash = await bcrypt.hash(adminPassword, 12);
  const workerHash = await bcrypt.hash(oldWorkerPassword, 12);
  const admin = await db.user.create({ data: { email: `arslan-owner-${run}@example.test`, name: "Arslan", role: "ADMIN", password: adminHash } });
  const worker = await db.user.create({ data: { email: `junaid-worker-${run}@example.test`, name: "Junaid", role: "USER", password: workerHash } });
  const driver = await db.driver.create({ data: { name: `History Driver ${run}`, licenseNumber: `H-${run}`, vehicleType: "VAN" } });
  const reservation = await db.reservation.create({ data: { userEmail: worker.email, startAt: now, pickupText: "Historical pickup", driverId: driver.id } });
  await db.reminder.create({ data: { userEmail: worker.email, reservationId: reservation.id, title: "Historical reminder", dueAt: now } });
  await db.activityLog.create({ data: { action: "historical_worker_event", entityType: "reservation", entityId: reservation.id, userEmail: worker.email } });
  await db.driverSubscriptionCharge.create({ data: { driverId: driver.id, chargeMonth: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), amount: "20.00", paymentStatus: "PAID", paidAt: now, paidByUserId: worker.id } });
  await db.aiPendingAction.create({ data: {
    userId: worker.id, actionType: "CREATE_RESERVATION", riskLevel: "WRITE", status: "EXECUTED",
    payloadJson: {}, previewJson: {}, preconditionJson: {}, confirmationLabel: "Historical action",
    idempotencyKey: `history-${run}`, expiresAt: new Date(now.getTime() + 60000), executedAt: now,
  } });
  await db.aiWorkflowDraft.create({ data: { userId: worker.id, kind: `history-${run}`.slice(0, 40), payloadJson: {}, expiresAt: new Date(now.getTime() + 60000) } });
  const adminSession = (await createDeviceSession(db, admin.id, adminHash, headers, now)).session;
  const workerSessionA = (await createDeviceSession(db, worker.id, workerHash, headers, now)).session;
  const workerSessionB = (await createDeviceSession(db, worker.id, workerHash, headers, now)).session;
  const adminIdentity = identity(adminSession);
  const baseline = await counts(worker);

  assert.deepEqual(await getAdminSecurityStatus(db, adminIdentity, now), { configured: false, unlocked: false, unlockedUntil: null, lockedUntil: null });
  await assert.rejects(listManagedUsers(db, adminIdentity, now), { status: 423 });
  await assert.rejects(setupAdminSecurityPin(db, identity(workerSessionA), oldWorkerPassword, pin, now), { status: 403 });
  await assert.rejects(setupAdminSecurityPin(db, adminIdentity, "wrong password", pin, now), { status: 400 });
  const setup = await setupAdminSecurityPin(db, adminIdentity, adminPassword, pin, now);
  assert.equal(setup.unlockedUntil.getTime(), now.getTime() + 10 * 60000);
  const adminSecurityRow = await db.user.findUniqueOrThrow({ where: { id: admin.id } });
  assert.notEqual(adminSecurityRow.settingsPinHash, pin);
  assert.equal(await bcrypt.compare(pin, adminSecurityRow.settingsPinHash), true);
  assert.equal((await getAdminSecurityStatus(db, adminIdentity, now)).unlocked, true);

  const freshAdminSession = (await createDeviceSession(db, admin.id, adminHash, headers, now)).session;
  assert.equal((await getAdminSecurityStatus(db, identity(freshAdminSession), now)).unlocked, false, "fresh sessions never inherit unlock");
  await lockAdminSettings(db, adminIdentity);
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await assert.rejects(unlockAdminSettings(db, adminIdentity, "111111", now), { status: 400 });
  }
  await assert.rejects(unlockAdminSettings(db, adminIdentity, "111111", now), { status: 429 });
  assert.equal(await db.activityLog.count({ where: { entityId: admin.id, action: "ADMIN_SETTINGS_UNLOCK_FAILED" } }), 5);
  await assert.rejects(unlockAdminSettings(db, adminIdentity, pin, new Date(now.getTime() + 4 * 60000)), { status: 429 });
  await unlockAdminSettings(db, adminIdentity, pin, new Date(now.getTime() + 5 * 60000 + 1));
  await db.$transaction(tx => requireUnlockedAdmin(tx, adminIdentity, new Date(now.getTime() + 15 * 60000)));
  await assert.rejects(db.$transaction(tx => requireUnlockedAdmin(tx, adminIdentity, new Date(now.getTime() + 16 * 60000 + 2))), { status: 423 });

  const created = await createManagedUser(db, adminIdentity, { name: "Royal Transfer", email: `ROYAL-${run}@EXAMPLE.TEST`, password: "RoyalInitial2026!" }, new Date(now.getTime() + 6 * 60000));
  assert.equal(created.role, "USER");
  assert.equal(created.status, "ACTIVE");
  assert.equal(created.email, `royal-${run}@example.test`);
  await assert.rejects(createManagedUser(db, adminIdentity, { name: "Duplicate", email: created.email, password: "Duplicate2026!" }, new Date(now.getTime() + 6 * 60000)), { status: 409 });
  const createdRow = await db.user.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(await bcrypt.compare("RoyalInitial2026!", createdRow.password), true);
  assert.ok(await createDeviceSession(db, created.id, createdRow.password, headers, now));

  const workerBeforeReset = await db.user.findUniqueOrThrow({ where: { id: worker.id } });
  const reset = await resetManagedUserPassword(db, adminIdentity, worker.id, newWorkerPassword, new Date(now.getTime() + 6 * 60000));
  assert.equal(reset.userId, worker.id);
  assert.equal(reset.sessionsRevoked, 2);
  const workerAfterReset = await db.user.findUniqueOrThrow({ where: { id: worker.id } });
  assert.equal(workerAfterReset.id, workerBeforeReset.id);
  assert.equal(await bcrypt.compare(oldWorkerPassword, workerAfterReset.password), false);
  assert.equal(await bcrypt.compare(newWorkerPassword, workerAfterReset.password), true);
  await assert.rejects(createDeviceSession(db, worker.id, workerHash, headers, new Date(now.getTime() + 6 * 60000)), { status: 401 });
  assert.equal(await validateDeviceSession(db, identity(workerSessionA), new Date(now.getTime() + 6 * 60000)), null);
  assert.equal(await validateDeviceSession(db, identity(workerSessionB), new Date(now.getTime() + 6 * 60000)), null);
  assert.deepEqual(await counts(worker), { ...baseline, activity: baseline.activity }, "business-history counts remain unchanged under the worker email");
  const postResetCounts = await counts(worker);
  assert.deepEqual(postResetCounts, baseline);

  const postResetSession = (await createDeviceSession(db, worker.id, workerAfterReset.password, headers, new Date(now.getTime() + 7 * 60000))).session;
  const beforeDeactivate = await counts(worker);
  const deactivated = await setManagedUserActive(db, adminIdentity, worker.id, false, new Date(now.getTime() + 8 * 60000));
  assert.equal(deactivated.userId, worker.id);
  assert.equal(deactivated.status, "INACTIVE");
  assert.equal(deactivated.sessionsRevoked, 1);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: worker.id } })).id, worker.id);
  assert.equal(await validateDeviceSession(db, identity(postResetSession), new Date(now.getTime() + 8 * 60000)), null);
  await assert.rejects(createDeviceSession(db, worker.id, workerAfterReset.password, headers, new Date(now.getTime() + 8 * 60000)), { status: 401 });
  assert.deepEqual(await counts(worker), beforeDeactivate);

  const reactivated = await setManagedUserActive(db, adminIdentity, worker.id, true, new Date(now.getTime() + 9 * 60000));
  assert.equal(reactivated.userId, worker.id);
  assert.equal(reactivated.status, "ACTIVE");
  assert.equal(reactivated.sessionsRevoked, 0);
  const relogin = (await createDeviceSession(db, worker.id, workerAfterReset.password, headers, new Date(now.getTime() + 9 * 60000))).session;
  assert.ok(await validateDeviceSession(db, identity(relogin), new Date(now.getTime() + 9 * 60000)));
  assert.deepEqual(await counts(worker), { ...beforeDeactivate, activity: beforeDeactivate.activity + 1 }, "reactivation preserves history and adds only the expected fresh LOGIN audit");

  await assert.rejects(setManagedUserActive(db, adminIdentity, admin.id, false, new Date(now.getTime() + 9 * 60000)), { status: 409 });
  const users = await listManagedUsers(db, adminIdentity, new Date(now.getTime() + 9 * 60000));
  assert.equal(users.users.find(row => row.id === admin.id).canDeactivate, false);
  assert.equal(users.users.find(row => row.id === admin.id).canChangePassword, false);

  const lifecycleLogs = await db.activityLog.findMany({ where: { action: { startsWith: "ADMIN_" }, userEmail: admin.email } });
  const serialized = JSON.stringify(lifecycleLogs);
  for (const secret of [adminPassword, oldWorkerPassword, newWorkerPassword, pin, adminHash, workerHash, adminSecurityRow.settingsPinHash]) {
    assert.equal(serialized.includes(secret), false);
  }
  for (const action of ["ADMIN_USER_CREATED", "ADMIN_USER_PASSWORD_CHANGED", "ADMIN_USER_DEACTIVATED", "ADMIN_USER_REACTIVATED", "ADMIN_SETTINGS_UNLOCKED", "ADMIN_SETTINGS_UNLOCK_FAILED"]) {
    assert.ok(lifecycleLogs.some(log => log.action === action), `${action} audit exists`);
  }
  console.log("PASS: ADMIN gate setup/unlock/lockout/expiry, managed creation, in-place reset, session revocation, deactivation/reactivation, last-admin protection, safe audit metadata and complete linked-history preservation.");
} finally {
  await db.$disconnect();
}
