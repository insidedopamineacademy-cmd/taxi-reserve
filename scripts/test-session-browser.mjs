// Optional browser integration suite. Requires an already running LOCAL app
// configured with the same disposable test DB and auth secret supplied here.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";
import bcrypt from "bcryptjs";

const databaseUrl = process.env.SESSION_TEST_DATABASE_URL;
const base = process.env.SESSION_TEST_BASE_URL;
const secret = process.env.SESSION_TEST_AUTH_SECRET;
if (!databaseUrl || !base || !secret || !process.env.PLAYWRIGHT_MODULE) {
  throw new Error("Set SESSION_TEST_DATABASE_URL, SESSION_TEST_BASE_URL, SESSION_TEST_AUTH_SECRET and PLAYWRIGHT_MODULE (absolute Playwright entry path).");
}
const dbUrl = new URL(databaseUrl);
const appUrl = new URL(base);
if (!["localhost", "127.0.0.1"].includes(dbUrl.hostname) || !dbUrl.pathname.toLowerCase().includes("test") || !["localhost", "127.0.0.1"].includes(appUrl.hostname)) {
  throw new Error("Refusing non-local app or non-local/non-test database.");
}

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const db = new PrismaClient({ datasourceUrl: databaseUrl });
const out = fs.mkdtempSync(path.join(os.tmpdir(), "taxi-session-browser-"));
const run = randomUUID().slice(0, 8);
const adminId = `qa-session-admin-${run}`;
const userId = `qa-session-user-${run}`;
const adminEmail = `admin-${run}@security.qa.example.test`;
const userEmail = `operator-${run}@security.qa.example.test`;
const password = "TaxiSessionQA2026!";
const changedPassword = "TaxiSessionChanged2026!";
const mutationHeaders = { origin: base };
const trustedHeaders = {
  "x-vercel-forwarded-for": "198.51.100.42",
  "x-vercel-ip-city": "Barcelona",
  "x-vercel-ip-country": "ES",
};
const widths = [360, 390, 430, 1280];
const pageErrors = [];
const contexts = [];
const iphoneUa = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1";
const macChromeUa = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36";

function installLocationTripwire({ standalone = false } = {}) {
  const probe = { geolocationReads: 0, geolocationCalls: 0, permissionQueries: 0 };
  window.__locationProbe = probe;
  Object.defineProperty(navigator, "standalone", { configurable: true, value: standalone });
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    get() {
      probe.geolocationReads++;
      return { getCurrentPosition() { probe.geolocationCalls++; throw new Error("Geolocation must not be called"); } };
    },
  });
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: { async query(descriptor) {
      if (descriptor?.name === "geolocation") probe.permissionQueries++;
      return { state: "denied", onchange: null };
    } },
  });
}

async function browserContext(browser, options = {}) {
  const { standalone = false, ...browserOptions } = options;
  const context = await browser.newContext({ extraHTTPHeaders: trustedHeaders, ...browserOptions });
  context.setDefaultTimeout(15000);
  context.setDefaultNavigationTimeout(25000);
  await context.addInitScript(installLocationTripwire, { standalone });
  contexts.push(context);
  return context;
}

async function openPage(context) {
  const page = await context.newPage();
  page.on("pageerror", error => pageErrors.push(error.message));
  return page;
}

async function checkOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, "page has horizontal overflow");
}

async function screenshot(page, name, width) {
  await page.setViewportSize({ width, height: 900 });
  await checkOverflow(page);
  await page.screenshot({ path: `${out}/${name}-${width}.png`, fullPage: true });
}

async function loginEvents(sessionId) {
  return db.activityLog.findMany({ where: { entityId: sessionId, action: { in: ["user_login", "admin_login"] } } });
}

async function assertOneLogin(sessionId) {
  const events = await loginEvents(sessionId);
  assert.equal(events.length, 1, "each session keeps exactly one LOGIN event");
  return events[0];
}

async function apiLogin(context, email = adminEmail, loginPassword = password) {
  const before = await db.deviceSession.count({ where: { user: { email } } });
  const csrf = await (await context.request.get(base + "/api/auth/csrf")).json();
  const result = await context.request.post(base + "/api/auth/callback/credentials", {
    form: { csrfToken: csrf.csrfToken, email, password: loginPassword, json: "true", callbackUrl: base + "/reservations" },
  });
  assert.equal(result.status(), 200);
  const session = await (await context.request.get(base + "/api/auth/session")).json();
  assert.ok(session.id, "successful authentication registered a session");
  assert.equal(await db.deviceSession.count({ where: { user: { email } } }), before + 1);
  const [event] = await loginEvents(session.id);
  assert.ok(event);
  assert.equal((await loginEvents(session.id)).length, 1);
  assert.equal(event.action, "user_login");
  assert.equal(event.userEmail, email);
  assert.equal(event.metadata.sessionId, session.id);
  assert.equal(event.metadata.eventType, "LOGIN");
  assert.equal(JSON.stringify(event).includes(loginPassword), false);
  assert.equal(JSON.stringify(event).includes("next-auth.session-token"), false);
  return session;
}

async function assertNoLocationUse(page) {
  const probe = await page.evaluate(() => window.__locationProbe);
  assert.deepEqual(probe, { geolocationReads: 0, geolocationCalls: 0, permissionQueries: 0 });
}

console.log("QA artifacts:", out);
const hash = await bcrypt.hash(password, 12);
await db.user.createMany({ data: [
  { id: adminId, email: adminEmail, name: "Security Admin", role: "ADMIN", password: hash },
  { id: userId, email: userEmail, name: "Security Operator", role: "USER", password: hash },
] });

const browser = await chromium.launch({
  ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}),
  headless: true,
});

try {
  const admin = await browserContext(browser, { userAgent: iphoneUa });
  const adminSession = await apiLogin(admin);
  const adminPage = await openPage(admin);
  const navigation = await adminPage.goto(base + "/drivers");
  assert.equal(navigation?.status(), 200);
  assert.match(navigation?.headers()["permissions-policy"] ?? "", /geolocation=\(\)/);
  await adminPage.getByRole("heading", { name: "Drivers", exact: true }).waitFor();
  assert.equal((await admin.request.get(base + "/api/admin/sessions")).status(), 200);
  const sessionResponse = await admin.request.get(base + "/api/security/session");
  assert.equal(sessionResponse.status(), 200);
  const sessionBody = await sessionResponse.json();
  assert.deepEqual(Object.keys(sessionBody).sort(), ["expiresAt", "id"]);
  assert.equal((await admin.request.get(base + "/location", { maxRedirects: 0 })).status(), 404);
  assert.equal((await admin.request.post(base + "/api/security/location", { data: {} })).status(), 404);
  await assertNoLocationUse(adminPage);

  const countAfterLogin = await db.deviceSession.count({ where: { userId: adminId } });
  const loginSnapshot = await assertOneLogin(adminSession.id);
  await adminPage.reload();
  await adminPage.getByRole("heading", { name: "Drivers", exact: true }).waitFor();
  await adminPage.close();
  const reopenedPage = await openPage(admin);
  await reopenedPage.goto(base + "/drivers");
  await reopenedPage.getByRole("heading", { name: "Drivers", exact: true }).waitFor();
  assert.equal(await db.deviceSession.count({ where: { userId: adminId } }), countAfterLogin);
  assert.deepEqual(await assertOneLogin(adminSession.id), loginSnapshot);
  await assertNoLocationUse(reopenedPage);
  console.log("PASS: login, refresh and reopen use one registered session and one LOGIN without any location access.");

  const second = await browserContext(browser, { userAgent: macChromeUa });
  const secondSession = await apiLogin(second);
  assert.notEqual(secondSession.id, adminSession.id);
  const secondRecord = await db.deviceSession.findUniqueOrThrow({ where: { id: secondSession.id } });
  assert.deepEqual([secondRecord.device, secondRecord.browser, secondRecord.os], ["Mac", "Chrome", "macOS"]);
  assert.equal(secondRecord.ipAddress, "198.51.100.42");
  assert.deepEqual(
    [secondRecord.latitude, secondRecord.longitude, secondRecord.accuracy, secondRecord.locationCapturedAt, secondRecord.locationVerifiedAt],
    [null, null, null, null, null],
  );
  const secondPage = await openPage(second);
  await secondPage.goto(base + "/reservations");
  await secondPage.getByRole("heading", { name: "Reservations", exact: true }).waitFor();
  await assertNoLocationUse(secondPage);

  const homeScreen = await browserContext(browser, { userAgent: iphoneUa, standalone: true });
  const homeSession = await apiLogin(homeScreen, userEmail);
  const homePage = await openPage(homeScreen);
  await homePage.goto(base + "/reservations");
  await homePage.getByRole("heading", { name: "Reservations", exact: true }).waitFor();
  await assertNoLocationUse(homePage);
  await homePage.reload();
  await assertNoLocationUse(homePage);
  await assertOneLogin(homeSession.id);
  console.log("PASS: permission denial and iPhone Home Screen mode are irrelevant to valid-session access.");

  assert.equal((await homeScreen.request.get(base + "/api/admin/sessions")).status(), 403);
  assert.equal((await homeScreen.request.get(base + "/api/drivers")).status(), 403);
  assert.equal((await homeScreen.request.get(base + "/api/security/session")).status(), 200);

  await reopenedPage.goto(base + `/admin/sessions?query=${encodeURIComponent(adminEmail)}`);
  await reopenedPage.getByRole("heading", { name: "Devices & sessions", exact: true }).waitFor();
  await reopenedPage.getByLabel("Find a user by name or email").fill(adminEmail);
  await reopenedPage.getByLabel("Accounts").getByText(adminEmail, { exact: true }).waitFor();
  await reopenedPage.getByText("2 active devices", { exact: true }).first().waitFor();
  await reopenedPage.locator(`[data-session-id="${adminSession.id}"]`).getByText("THIS DEVICE", { exact: true }).waitFor();
  const managerText = await reopenedPage.getByLabel("User devices").textContent();
  assert.doesNotMatch(managerText ?? "", /GPS|browser location|coordinates|accuracy|allow location|location required/i);
  for (const width of widths) await screenshot(reopenedPage, "admin-device-sessions", width);

  const secondCard = reopenedPage.locator(`[data-session-id="${secondSession.id}"]`);
  await secondCard.getByRole("button", { name: "Log out device", exact: true }).click();
  await reopenedPage.getByRole("heading", { name: "Log out this device?", exact: true }).waitFor();
  await screenshot(reopenedPage, "revoke-device-confirmation", 390);
  await reopenedPage.getByRole("dialog").getByRole("button", { name: "Log out device", exact: true }).click();
  await reopenedPage.getByText("1 device logged out.", { exact: true }).waitFor();
  assert.equal((await second.request.get(base + "/api/reservations")).status(), 401);
  await secondPage.evaluate(() => fetch("/api/reservations")).catch(() => {});
  await secondPage.waitForURL("**/login?reason=session-ended");
  const revoked = await db.deviceSession.findUniqueOrThrow({ where: { id: secondSession.id } });
  assert.ok(revoked.revokedAt);
  assert.equal(revoked.revokedByUserId, adminId);
  assert.equal(await db.activityLog.count({ where: { entityId: secondSession.id, action: "device_session_revoked" } }), 1);
  assert.equal((await loginEvents(secondSession.id)).length, 1);

  await reopenedPage.getByRole("button", { name: "Refresh devices" }).click();
  await reopenedPage.locator(`[data-session-id="${secondSession.id}"]`).getByText("Revoked", { exact: true }).waitFor();
  const auditPage = await openPage(admin);
  await auditPage.goto(base + `/activity-log?q=${encodeURIComponent(secondSession.id)}`);
  await auditPage.getByText("LOGIN", { exact: true }).waitFor();
  await auditPage.getByText("Mac · Chrome · macOS", { exact: true }).waitFor();
  await auditPage.close();

  const relogin = await apiLogin(second);
  assert.notEqual(relogin.id, secondSession.id);
  assert.equal((await second.request.get(base + "/api/admin/sessions")).status(), 200);
  assert.equal((await db.deviceSession.findUniqueOrThrow({ where: { id: relogin.id } })).ipAddress, "198.51.100.42");
  assert.equal((await loginEvents(relogin.id)).length, 1);
  console.log("PASS: individual revocation rejects the old cookie, retains history, and allows the same browser and IP to log in again.");

  const third = await browserContext(browser, { userAgent: macChromeUa });
  const fourth = await browserContext(browser, { userAgent: macChromeUa });
  const thirdSession = await apiLogin(third);
  const fourthSession = await apiLogin(fourth);
  await reopenedPage.getByRole("button", { name: "Refresh devices" }).click();
  await reopenedPage.locator(`[data-session-id="${fourthSession.id}"]`).waitFor();
  const list = await (await admin.request.get(base + `/api/admin/sessions?userId=${adminId}`)).json();
  const otherIds = list.sessions.filter(row => !row.revokedAt && row.expiresAt > list.now && row.id !== adminSession.id).map(row => row.id);
  assert.deepEqual(otherIds.sort(), [relogin.id, thirdSession.id, fourthSession.id].sort());
  await reopenedPage.getByRole("button", { name: "Log out all other devices", exact: true }).click();
  await reopenedPage.getByRole("heading", { name: `Log out ${otherIds.length} devices?`, exact: true }).waitFor();
  await reopenedPage.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal((await admin.request.post(base + "/api/admin/sessions/revoke-others", { headers: mutationHeaders, data: { userId: adminId, expectedIds: [thirdSession.id] } })).status(), 409);
  await reopenedPage.getByRole("button", { name: "Log out all other devices", exact: true }).click();
  await reopenedPage.getByRole("dialog").getByRole("button", { name: "Log out devices", exact: true }).click();
  await reopenedPage.getByText(`${otherIds.length} devices logged out.`, { exact: true }).waitFor();
  assert.equal((await admin.request.get(base + "/api/security/session")).status(), 200);
  assert.equal((await second.request.get(base + "/api/security/session")).status(), 401);
  assert.equal((await third.request.get(base + "/api/security/session")).status(), 401);
  assert.equal((await fourth.request.get(base + "/api/security/session")).status(), 401);
  assert.equal((await homeScreen.request.get(base + "/api/security/session")).status(), 200);
  console.log("PASS: confirmed bulk revoke protects the current session and unrelated accounts.");

  const expired = await browserContext(browser, { userAgent: macChromeUa });
  const expiredSession = await apiLogin(expired);
  await db.deviceSession.update({ where: { id: expiredSession.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await expired.request.get(base + "/api/reservations")).status(), 401);
  for (const [label, value] of [
    ["malformed", "not.a.valid.jwt"],
    ["legacy", await encode({ secret, token: { sub: adminId, email: adminEmail, role: "ADMIN" } })],
  ]) {
    const context = await browserContext(browser);
    await context.addCookies([{ name: "next-auth.session-token", value, domain: appUrl.hostname, path: "/", httpOnly: true, sameSite: "Lax" }]);
    assert.equal((await context.request.get(base + "/api/reservations")).status(), 401, label);
  }

  await db.user.update({ where: { id: adminId }, data: { role: "USER" } });
  assert.equal((await admin.request.get(base + "/api/admin/sessions")).status(), 403);
  await db.user.update({ where: { id: adminId }, data: { role: "ADMIN" } });
  assert.equal((await admin.request.get(base + "/api/admin/sessions")).status(), 200);

  const passwordPeer = await browserContext(browser, { userAgent: macChromeUa });
  const passwordPeerSession = await apiLogin(passwordPeer);
  const changed = await admin.request.post(base + "/api/user/change-password", {
    headers: mutationHeaders,
    data: { currentPassword: password, newPassword: changedPassword },
  });
  assert.equal(changed.status(), 200);
  assert.equal((await passwordPeer.request.get(base + "/api/security/session")).status(), 401);
  assert.equal((await admin.request.get(base + "/api/security/session")).status(), 200);
  assert.equal((await loginEvents(passwordPeerSession.id)).length, 1);
  console.log("PASS: expired/malformed/legacy cookies, live role checks and password-change revocation.");

  const originalAdminLogin = await assertOneLogin(adminSession.id);
  const signOutCsrf = await (await admin.request.get(base + "/api/auth/csrf")).json();
  const signOutResponse = await admin.request.post(base + "/api/auth/signout", {
    form: { csrfToken: signOutCsrf.csrfToken, callbackUrl: base + "/login", json: "true" },
  });
  assert.equal(signOutResponse.status(), 200);
  assert.ok((await db.deviceSession.findUniqueOrThrow({ where: { id: adminSession.id } })).revokedAt);
  assert.deepEqual(await assertOneLogin(adminSession.id), originalAdminLogin, "logout preserves the original LOGIN event");
  assert.deepEqual(pageErrors, []);
  fs.writeFileSync(path.join(out, "browser-summary.json"), JSON.stringify({ adminSessionId: adminSession.id, screenshots: widths, pageErrors }, null, 2));
  console.log("PASS: browser QA completed at 360, 390, 430 and 1280 pixels without uncaught page errors.");
} finally {
  await Promise.allSettled(contexts.map(context => context.close()));
  await browser.close();
  await db.$disconnect();
}
