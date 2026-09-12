import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  changePasswordAndRevokeOthers,
  cleanupDeviceSessions,
  createDeviceSession,
  logoutDeviceSession,
  revokeDeviceSession,
  revokeOtherSessions,
  validateDeviceSession,
} from "../src/lib/security/sessionCore.ts";
import { LAST_SEEN_INTERVAL_MS } from "../src/lib/security/policy.ts";

const databaseUrl = process.env.SESSION_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("Set SESSION_TEST_DATABASE_URL to a disposable local PostgreSQL database.");
const url = new URL(databaseUrl);
if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.toLowerCase().includes("test")) throw new Error("Refusing non-local or non-test database.");

const db = new PrismaClient({ datasourceUrl: databaseUrl });
const run = randomUUID();
const now = new Date("2026-09-12T18:15:00Z");
const originalHash = "verified-test-hash";
const newHash = "new-test-hash";
const secretMarker = "never-log-this-plaintext-token";
const headers = new Headers({
  "user-agent": `Mozilla/5.0 (iPhone; CPU iPhone OS 18 like Mac OS X) Version/18 Mobile Safari/604.1 ${secretMarker}`,
  "cookie": `next-auth.session-token=${secretMarker}`,
  "authorization": `Bearer ${secretMarker}`,
  "x-forwarded-for": "203.0.113.66",
  "x-vercel-forwarded-for": "198.51.100.42",
  "x-vercel-ip-city": "Barcelona",
  "x-vercel-ip-country": "ES",
});

const identity = row => ({ sid: row.id, sub: row.userId });
const get = id => db.deviceSession.findUniqueOrThrow({ where: { id } });
const loginEvents = id => db.activityLog.findMany({ where: { entityId: id, action: { in: ["user_login", "admin_login"] } } });
const makeSession = async (user, hash = originalHash) => (await createDeviceSession(db, user.id, hash, headers, now)).session;
async function makeTrustedSession(user, hash = originalHash) {
  const previous = process.env.VERCEL;
  try { process.env.VERCEL = "1"; return await makeSession(user, hash); }
  finally { if (previous === undefined) delete process.env.VERCEL; else process.env.VERCEL = previous; }
}

try {
  const admin = await db.user.create({ data: { email: `security-admin-${run}@example.test`, role: "ADMIN", password: originalHash } });
  const user = await db.user.create({ data: { email: `security-user-${run}@example.test`, role: "USER", password: originalHash } });
  const a = await makeTrustedSession(admin);
  const b = await makeTrustedSession(admin);
  const c = await makeTrustedSession(user);

  assert.notEqual(a.id, b.id, "every fresh login creates a new session, even with the same metadata");
  assert.equal(a.ipAddress, b.ipAddress, "the same IP is allowed");
  assert.equal(a.userAgent, b.userAgent, "the same user agent is allowed");
  const storedA = await get(a.id);
  assert.deepEqual(
    [storedA.latitude, storedA.longitude, storedA.accuracy, storedA.locationCapturedAt, storedA.locationVerifiedAt],
    [null, null, null, null, null],
    "new sessions do not require or populate legacy GPS columns",
  );
  assert.equal(a.expiresAt.getTime() - a.createdAt.getTime(), 30 * 86400000);
  assert.equal((await validateDeviceSession(db, identity(a), now)).user.email, admin.email);
  assert.equal(await validateDeviceSession(db, { sid: a.id, sub: user.id }, now), null);
  assert.equal(await validateDeviceSession(db, { sub: admin.id }, now), null, "legacy tokens without sid fail closed");
  assert.equal(await validateDeviceSession(db, { sid: "invalid", sub: admin.id }, now), null);
  assert.equal(await validateDeviceSession(db, identity(a), a.expiresAt), null);

  const [loginA] = await loginEvents(a.id);
  assert.equal((await loginEvents(a.id)).length, 1);
  assert.equal((await loginEvents(b.id)).length, 1);
  assert.equal((await loginEvents(c.id)).length, 1);
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
  assert.equal(JSON.stringify(loginA).includes(originalHash), false);

  await validateDeviceSession(db, identity(a), new Date(now.getTime() + LAST_SEEN_INTERVAL_MS - 1));
  assert.deepEqual((await get(a.id)).lastSeenAt, now);
  const later = new Date(now.getTime() + LAST_SEEN_INTERVAL_MS);
  await Promise.all(Array.from({ length: 5 }, () => validateDeviceSession(db, identity(a), later)));
  assert.deepEqual((await get(a.id)).lastSeenAt, later);
  await validateDeviceSession(db, identity(a), new Date(later.getTime() + 1));
  assert.deepEqual((await get(a.id)).lastSeenAt, later);
  assert.deepEqual(await loginEvents(a.id), [loginA], "requests and lastSeen updates never duplicate LOGIN");
  console.log("PASS: fresh logins, exact LOGIN audit, safe metadata, token binding, expiry and throttled lastSeen.");

  await assert.rejects(revokeDeviceSession(db, identity(c), a.id, now), { status: 403 });
  await assert.rejects(revokeDeviceSession(db, identity(a), a.id, now), { status: 409 });
  await assert.rejects(revokeDeviceSession(db, {}, b.id, now), { status: 401 });
  assert.equal((await revokeDeviceSession(db, identity(a), b.id, now)).changed, 1);
  assert.equal(await validateDeviceSession(db, identity(b), now), null);
  assert.ok(await validateDeviceSession(db, identity(a), now));
  assert.equal((await get(b.id)).revokedByUserId, admin.id);
  assert.equal((await get(b.id)).ipAddress, null);
  assert.equal((await revokeDeviceSession(db, identity(a), b.id, now)).changed, 0);
  assert.equal(await db.activityLog.count({ where: { entityId: b.id, action: "device_session_revoked" } }), 1);
  assert.equal((await loginEvents(b.id)).length, 1, "revoked session history remains visible in ActivityLog");

  const relogin = await makeTrustedSession(admin);
  assert.notEqual(relogin.id, b.id, "a revoked session is never resurrected");
  assert.equal(relogin.ipAddress, a.ipAddress, "revocation does not blacklist the IP");
  assert.equal(relogin.userAgent, a.userAgent, "revocation does not blacklist the device or browser metadata");
  assert.ok(await validateDeviceSession(db, identity(relogin), now));
  assert.equal((await loginEvents(relogin.id)).length, 1);
  console.log("PASS: individual revoke, current-device protection, authorization, retained history and login after revocation without blacklisting.");

  const d = await makeSession(admin);
  const e = await makeSession(admin);
  const expected = [relogin.id, d.id, e.id].sort();
  await assert.rejects(revokeOtherSessions(db, identity(a), admin.id, [d.id], now), { status: 409 });
  const bulk = await Promise.all([1, 2].map(() => revokeOtherSessions(db, identity(a), admin.id, expected, now)));
  assert.equal(bulk.reduce((sum, result) => sum + result.changed, 0), expected.length);
  assert.ok(await validateDeviceSession(db, identity(a), now), "bulk revoke preserves the actor's current session");
  assert.ok(await validateDeviceSession(db, identity(c), now), "bulk revoke does not affect another account");
  assert.equal(await db.activityLog.count({ where: { entityId: admin.id, action: "other_device_sessions_revoked" } }), 1);

  const f = await makeSession(admin);
  const sessionsBeforeFailure = await db.deviceSession.count({ where: { userId: admin.id } });
  const loginsBeforeFailure = await db.activityLog.count({ where: { userEmail: admin.email, action: "user_login" } });
  await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION session_test_login_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'user_login' THEN RAISE EXCEPTION 'test login audit failure'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER session_test_login_failure BEFORE INSERT ON "ActivityLog" FOR EACH ROW EXECUTE FUNCTION session_test_login_failure()');
  try {
    await assert.rejects(makeSession(admin));
    assert.equal(await db.deviceSession.count({ where: { userId: admin.id } }), sessionsBeforeFailure, "a session cannot commit without its LOGIN audit");
    assert.equal(await db.activityLog.count({ where: { userEmail: admin.email, action: "user_login" } }), loginsBeforeFailure);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER session_test_login_failure ON "ActivityLog"');
    await db.$executeRawUnsafe('DROP FUNCTION session_test_login_failure()');
  }

  await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION session_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'device_session_revoked' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER session_test_audit_failure BEFORE INSERT ON "ActivityLog" FOR EACH ROW EXECUTE FUNCTION session_test_audit_failure()');
  try {
    await assert.rejects(revokeDeviceSession(db, identity(a), f.id, now));
    assert.equal((await get(f.id)).revokedAt, null, "audit failure rolls back revocation");
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER session_test_audit_failure ON "ActivityLog"');
    await db.$executeRawUnsafe('DROP FUNCTION session_test_audit_failure()');
  }

  await changePasswordAndRevokeOthers(db, identity(a), originalHash, newHash, now);
  assert.equal(await validateDeviceSession(db, identity(f), now), null);
  assert.ok(await validateDeviceSession(db, identity(a), now), "password change preserves the current session");
  await assert.rejects(createDeviceSession(db, admin.id, originalHash, headers, now), { status: 401 });
  const afterPassword = await makeTrustedSession(admin, newHash);
  assert.ok(await validateDeviceSession(db, identity(afterPassword), now));

  await logoutDeviceSession(db, identity(a), now);
  assert.equal(await validateDeviceSession(db, identity(a), now), null);
  await logoutDeviceSession(db, identity(a), now);
  assert.equal(await db.activityLog.count({ where: { entityId: a.id, action: "user_logout" } }), 1);
  assert.deepEqual(await loginEvents(a.id), [loginA], "logout never deletes or changes the original LOGIN");
  console.log("PASS: bulk revoke, transactional audits, password-change revocation, normal sign-out and retained LOGIN history.");

  await db.deviceSession.update({ where: { id: c.id }, data: {
    expiresAt: new Date(now.getTime() + 1000), ipAddress: "198.51.100.1",
    latitude: 41.3879, longitude: 2.1699, accuracy: 34,
    locationCapturedAt: now, locationVerifiedAt: now,
  } });
  await cleanupDeviceSessions(db, new Date(now.getTime() + 2000));
  const scrubbed = await get(c.id);
  assert.equal(scrubbed.ipAddress, null);
  assert.deepEqual(
    [scrubbed.latitude, scrubbed.longitude, scrubbed.accuracy, scrubbed.locationCapturedAt, scrubbed.locationVerifiedAt],
    [null, null, null, null, null],
    "cleanup retires legacy GPS values without requiring a destructive migration",
  );
  await db.deviceSession.update({ where: { id: c.id }, data: { userAgent: null, networkCity: "Synthetic city" } });
  await cleanupDeviceSessions(db, new Date(now.getTime() + 3000));
  assert.equal((await get(c.id)).networkCity, null);
  await cleanupDeviceSessions(db, new Date(now.getTime() + 31 * 86400000));
  assert.equal(await db.deviceSession.findUnique({ where: { id: c.id } }), null);
  assert.ok(await db.activityLog.count({ where: { entityId: a.id } }), "audit history survives session-row cleanup");
  console.log("PASS: ended-session metadata scrubbing, bounded retention and durable audit history.");
} finally {
  await db.$disconnect();
}
