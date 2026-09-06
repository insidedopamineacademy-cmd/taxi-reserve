import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createDeviceSession, validateDeviceSession, recordSessionLocation, clearSessionLocation, revokeDeviceSession, revokeOtherSessions, logoutDeviceSession, cleanupDeviceSessions, changePasswordAndRevokeOthers } from "../src/lib/security/sessionCore.ts";
import { hasFreshLocation, LAST_SEEN_INTERVAL_MS } from "../src/lib/security/policy.ts";

const databaseUrl = process.env.SESSION_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("Set SESSION_TEST_DATABASE_URL to a disposable local PostgreSQL database.");
const url = new URL(databaseUrl);
if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.toLowerCase().includes("test")) throw new Error("Refusing non-local or non-test database.");
const db = new PrismaClient({ datasourceUrl: databaseUrl });
const run = randomUUID();
const now = new Date("2026-09-06T09:00:00Z");
const secretMarker = "never-log-this-plaintext-token";
const headers = new Headers({
  "user-agent": `Mozilla/5.0 (iPhone; CPU iPhone OS 18 like Mac OS X) Safari/604.1 ${secretMarker}`,
  "cookie": `next-auth.session-token=${secretMarker}`, "authorization": `Bearer ${secretMarker}`,
  "x-forwarded-for": "203.0.113.66", "x-vercel-forwarded-for": "198.51.100.42",
  "x-vercel-ip-city": "Barcelona", "x-vercel-ip-country": "ES",
});
const payload = { latitude: 41.3879123, longitude: 2.1699123, accuracy: 34, capturedAt: now.toISOString() };
const identity = row => ({ sid: row.id, sub: row.userId });
const makeSession = async user => (await createDeviceSession(db, user.id, "verified-test-hash", headers, now)).session;
const get = id => db.deviceSession.findUniqueOrThrow({ where: { id } });
const loginEvents = id => db.activityLog.findMany({ where: { entityId: id, action: { in: ["user_login", "admin_login"] } } });

try {
  const admin = await db.user.create({ data: { email: `security-admin-${run}@example.test`, role: "ADMIN", password: "verified-test-hash" } });
  const user = await db.user.create({ data: { email: `security-user-${run}@example.test`, role: "USER", password: "verified-test-hash" } });
  const previousVercel = process.env.VERCEL;
  let a;
  try { process.env.VERCEL = "1"; a = await makeSession(admin); }
  finally { if (previousVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = previousVercel; }
  const b = await makeSession(admin);
  const c = await makeSession(user);
  assert.notEqual(a.id, b.id);
  assert.equal(a.latitude, null);
  assert.equal(a.expiresAt.getTime() - a.createdAt.getTime(), 30 * 86400000);
  assert.equal((await validateDeviceSession(db, identity(a), now)).user.email, admin.email);
  assert.equal(await validateDeviceSession(db, { sid: a.id, sub: user.id }, now), null);
  assert.equal(await validateDeviceSession(db, { sub: admin.id }, now), null);
  assert.equal(await validateDeviceSession(db, { sid: "invalid", sub: admin.id }, now), null);
  assert.equal(await validateDeviceSession(db, identity(a), a.expiresAt), null);
  const [loginA] = await loginEvents(a.id);
  assert.equal((await loginEvents(a.id)).length, 1, "ADMIN login is one event, not user_login plus admin_login");
  assert.equal((await loginEvents(b.id)).length, 1, "second genuine device login gets its own event");
  assert.equal((await loginEvents(c.id)).length, 1, "normal USER gets exactly one event");
  assert.equal(loginA.userEmail, admin.email);
  assert.equal(loginA.entityType, "device_session");
  assert.equal(loginA.entityId, a.id);
  assert.deepEqual(loginA.createdAt, a.createdAt);
  assert.deepEqual(loginA.metadata, {
    eventType: "LOGIN", userId: admin.id, sessionId: a.id, role: "ADMIN", isCurrentSessionAtLogin: true,
    device: "iPhone", browser: "Safari", os: "iOS", ipAddress: "198.51.100.42",
    networkCity: "Barcelona", networkRegion: null, networkCountry: "ES",
  });
  assert.equal(JSON.stringify(loginA).includes(secretMarker), false);
  assert.equal(JSON.stringify(loginA).includes("verified-test-hash"), false);
  assert.equal(a.locationVerifiedAt, null, "login is recorded before GPS permission");
  await validateDeviceSession(db, identity(a), new Date(now.getTime() + LAST_SEEN_INTERVAL_MS - 1));
  assert.deepEqual((await get(a.id)).lastSeenAt, now);
  const later = new Date(now.getTime() + LAST_SEEN_INTERVAL_MS);
  await Promise.all(Array.from({ length: 5 }, () => validateDeviceSession(db, identity(a), later)));
  assert.deepEqual((await get(a.id)).lastSeenAt, later);
  assert.deepEqual(await loginEvents(a.id), [loginA], "normal requests / lastSeen do not rewrite or duplicate LOGIN");
  await validateDeviceSession(db, identity(a), new Date(later.getTime() + 1));
  assert.deepEqual((await get(a.id)).lastSeenAt, later);
  console.log("PASS: exactly one immutable LOGIN per fresh session, safe device/IP metadata, independent devices, expiry/ownership/legacy rejection, and no duplicate on lastSeen.");

  await assert.rejects(recordSessionLocation(db, {}, payload, now), { status: 401 });
  await assert.rejects(recordSessionLocation(db, identity(a), { ...payload, sessionId: b.id }, now), { status: 400 });
  await recordSessionLocation(db, identity(a), payload, now);
  const located = await get(a.id);
  assert.equal(located.latitude, 41.3879);
  assert.equal(located.accuracy, 34);
  assert.equal(hasFreshLocation(located.locationVerifiedAt, now), true);
  assert.equal((await get(b.id)).locationVerifiedAt, null);
  await recordSessionLocation(db, identity(a), { ...payload, longitude: 2.2 }, now);
  assert.equal(await db.activityLog.count({ where: { entityId: a.id, action: "session_location_verified" } }), 1);
  assert.deepEqual(await loginEvents(a.id), [loginA], "GPS updates neither replace nor repeat the login snapshot");
  await clearSessionLocation(db, identity(a), now);
  assert.equal((await get(a.id)).locationVerifiedAt, null);
  await assert.rejects(revokeDeviceSession(db, identity(a), b.id, now), { status: 428 });
  await recordSessionLocation(db, identity(a), payload, now);
  await recordSessionLocation(db, identity(c), payload, now);
  await assert.rejects(revokeDeviceSession(db, identity(c), a.id, now), { status: 403 });
  await assert.rejects(revokeDeviceSession(db, identity(a), a.id, now), { status: 409 });
  await assert.rejects(revokeDeviceSession(db, {}, a.id, now), { status: 401 });
  await recordSessionLocation(db, identity(b), payload, now);
  const result = await revokeDeviceSession(db, identity(a), b.id, now);
  assert.equal(result.changed, 1);
  assert.equal(await validateDeviceSession(db, identity(b), now), null);
  assert.ok(await validateDeviceSession(db, identity(a), now));
  assert.equal((await get(b.id)).latitude, null);
  assert.equal((await get(b.id)).userAgent, null);
  assert.equal((await get(b.id)).revokedByUserId, admin.id);
  assert.equal((await revokeDeviceSession(db, identity(a), b.id, now)).changed, 0);
  assert.equal(await db.activityLog.count({ where: { entityId: b.id, action: "device_session_revoked" } }), 1);
  assert.equal((await loginEvents(b.id)).length, 1, "revoked session's login history remains");
  console.log("PASS: location refresh does not duplicate LOGIN; strict binding, freshness, admin checks, current-device protection, retained revoked history and idempotent audit.");

  const d = await makeSession(admin);
  const e = await makeSession(admin);
  await assert.rejects(revokeOtherSessions(db, identity(a), admin.id, [d.id], now), { status: 409 });
  const all = await Promise.all([1, 2].map(() => revokeOtherSessions(db, identity(a), admin.id, [d.id, e.id], now)));
  assert.equal(all.reduce((sum, result) => sum + result.changed, 0), 2);
  assert.ok(await validateDeviceSession(db, identity(a), now));
  assert.ok(await validateDeviceSession(db, identity(c), now));
  assert.equal(await db.activityLog.count({ where: { entityId: admin.id, action: "other_device_sessions_revoked" } }), 1);

  const f = await makeSession(admin);
  const sessionsBeforeFailure = await db.deviceSession.count({ where: { userId: admin.id } });
  const loginsBeforeFailure = await db.activityLog.count({ where: { userEmail: admin.email, action: "user_login" } });
  await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION session_test_login_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'user_login' THEN RAISE EXCEPTION 'test login audit failure'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER session_test_login_failure BEFORE INSERT ON "ActivityLog" FOR EACH ROW EXECUTE FUNCTION session_test_login_failure()');
  try {
    await assert.rejects(makeSession(admin));
    assert.equal(await db.deviceSession.count({ where: { userId: admin.id } }), sessionsBeforeFailure, "a session cannot succeed without its LOGIN audit");
    assert.equal(await db.activityLog.count({ where: { userEmail: admin.email, action: "user_login" } }), loginsBeforeFailure);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER session_test_login_failure ON "ActivityLog"');
    await db.$executeRawUnsafe('DROP FUNCTION session_test_login_failure()');
  }
  await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION session_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'device_session_revoked' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER session_test_audit_failure BEFORE INSERT ON "ActivityLog" FOR EACH ROW EXECUTE FUNCTION session_test_audit_failure()');
  try {
    await assert.rejects(revokeDeviceSession(db, identity(a), f.id, now));
    assert.equal((await get(f.id)).revokedAt, null, "audit failure must roll back revocation");
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER session_test_audit_failure ON "ActivityLog"');
    await db.$executeRawUnsafe('DROP FUNCTION session_test_audit_failure()');
  }
  await changePasswordAndRevokeOthers(db, identity(a), "verified-test-hash", "new-test-hash", now);
  assert.equal(await validateDeviceSession(db, identity(f), now), null);
  assert.ok(await validateDeviceSession(db, identity(a), now));
  await assert.rejects(createDeviceSession(db, admin.id, "verified-test-hash", headers, now), { status: 401 });
  await logoutDeviceSession(db, identity(a), now);
  assert.equal(await validateDeviceSession(db, identity(a), now), null);
  assert.equal((await get(a.id)).latitude, null);
  await logoutDeviceSession(db, identity(a), now);
  assert.equal(await db.activityLog.count({ where: { entityId: a.id, action: "user_logout" } }), 1);
  assert.deepEqual(await loginEvents(a.id), [loginA], "logout never deletes or changes the original login");
  console.log("PASS: concurrent revoke-all, exact confirmation counts, current-session preservation, transactional rollback, password invalidation, logout and retained LOGIN.");

  await db.deviceSession.update({ where: { id: c.id }, data: { expiresAt: new Date(now.getTime() + 1000), ipAddress: "198.51.100.1" } });
  await cleanupDeviceSessions(db, new Date(now.getTime() + 2000));
  assert.equal((await get(c.id)).latitude, null);
  assert.equal((await get(c.id)).ipAddress, null);
  await db.deviceSession.update({ where: { id: c.id }, data: { userAgent: null, networkCity: "Synthetic city" } });
  await cleanupDeviceSessions(db, new Date(now.getTime() + 3000));
  assert.equal((await get(c.id)).networkCity, null, "network-only expired metadata must also be scrubbed");
  await cleanupDeviceSessions(db, new Date(now.getTime() + 31 * 86400000));
  assert.equal(await db.deviceSession.count({ where: { userId: { in: [admin.id, user.id] } } }), 0);
  assert.ok(await db.activityLog.count({ where: { entityId: a.id } }), "minimal security audit survives session-row cleanup");
  assert.deepEqual(await loginEvents(a.id), [loginA], "login history survives deletion of the ended session row");
  console.log("PASS: expired privacy scrubbing, 30-day ended-session deletion and retained minimal audit.");
} finally { await db.$disconnect(); }
