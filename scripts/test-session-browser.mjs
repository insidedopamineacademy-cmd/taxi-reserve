// Optional browser integration suite. Requires an already running LOCAL app
// configured with the same disposable test DB and auth secret supplied here.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";
import bcrypt from "bcryptjs";
const databaseUrl = process.env.SESSION_TEST_DATABASE_URL;
const base = process.env.SESSION_TEST_BASE_URL;
const secret = process.env.SESSION_TEST_AUTH_SECRET;
if (!databaseUrl || !base || !secret || !process.env.PLAYWRIGHT_MODULE) throw new Error("Set SESSION_TEST_DATABASE_URL, SESSION_TEST_BASE_URL, SESSION_TEST_AUTH_SECRET and PLAYWRIGHT_MODULE (absolute Playwright entry path).");
const dbUrl = new URL(databaseUrl);
const appUrl = new URL(base);
if (!["localhost", "127.0.0.1"].includes(dbUrl.hostname) || !dbUrl.pathname.toLowerCase().includes("test") || !["localhost", "127.0.0.1"].includes(appUrl.hostname)) throw new Error("Refusing non-local app or non-local/non-test database.");
const { chromium, webkit, devices } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const db = new PrismaClient({ datasourceUrl: databaseUrl });
const out = fs.mkdtempSync(path.join(os.tmpdir(), "taxi-session-browser-"));
console.log("QA artifacts:", out);
const adminEmail = 'admin@security.qa.example.test';
const userEmail = 'operator@security.qa.example.test';
const password = 'TaxiSessionQA2026!';
const headers = { origin: base };
const locationHeaders = { ...headers, 'x-taxi-location-request': 'location-v1' };
const geo = { latitude: 41.3879, longitude: 2.1699, accuracy: 34 };
const widths = [360, 390, 430, 1280];
const contexts = [];
const pageErrors = [];
async function checkOverflow(page) { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'horizontal overflow'); }
async function screenshot(page, name, width) { await page.setViewportSize({ width, height: 900 }); await checkOverflow(page); await page.screenshot({ path: `${out}/${name}-${width}.png`, fullPage: !name.includes('confirmation') }); }
async function apiLogin(context, email = adminEmail) {
 const csrf = await (await context.request.get(base + '/api/auth/csrf')).json();
 const result = await context.request.post(base + '/api/auth/callback/credentials', { form: { csrfToken: csrf.csrfToken, email, password, json: 'true', callbackUrl: base + '/location' } });
 assert.equal(result.status(), 200);
 const session = await (await context.request.get(base + '/api/auth/session')).json();
 assert.ok(session.id, 'login registered a session');
 const loginEvents = await db.activityLog.findMany({ where: { entityId: session.id, action: { in: ['user_login', 'admin_login'] } } });
 assert.equal(loginEvents.length, 1, 'fresh authentication must create exactly one login event');
 assert.equal(loginEvents[0].action, 'user_login');
 assert.equal(loginEvents[0].userEmail, email);
 assert.equal(loginEvents[0].metadata.sessionId, session.id);
 assert.equal(loginEvents[0].metadata.eventType, 'LOGIN');
 assert.equal(JSON.stringify(loginEvents[0]).includes(password), false, 'password must never enter ActivityLog');
 return session;
}
async function assertOneLogin(sessionId) {
 const events = await db.activityLog.findMany({ where: { entityId: sessionId, action: { in: ['user_login', 'admin_login'] } } });
 assert.equal(events.length, 1, 'refresh/resume/location/logout must not duplicate or delete LOGIN');
 return events[0];
}
async function location(context, extra = {}) { return context.request.post(base + '/api/security/location', { headers: locationHeaders, data: { ...geo, capturedAt: new Date().toISOString(), ...extra } }); }
async function context(browser, options = {}) { const c = await browser.newContext(options); c.setDefaultTimeout(15000); c.setDefaultNavigationTimeout(20000); contexts.push(c); return c; }
async function page(c) { const p = await c.newPage(); p.on('pageerror', e => pageErrors.push(e.message)); return p; }
function installGeoMock({ permission = 'prompt', mode = 'success', permissionsUnsupported = false, permissionsAbsent = false, insecure = false, standalone = false } = {}) {
 const state = { permission, mode, calls: 0, fallbackExpected: false };
 const status = { get state() { return state.permission; }, onchange: null };
 window.__geo = state;
 state.setPermission = value => { state.permission = value; status.onchange?.(); };
 state.setMode = value => { state.mode = value; };
 Object.defineProperty(navigator, 'standalone', { configurable: true, value: standalone });
 const originalMatchMedia = window.matchMedia.bind(window);
 window.matchMedia = query => query === '(display-mode: standalone)' ? { matches: standalone, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } } : originalMatchMedia(query);
 Object.defineProperty(navigator, 'permissions', { configurable: true, value: permissionsAbsent ? undefined : { query: async () => { if (permissionsUnsupported) throw new TypeError('Unsupported query'); return status; } } });
 Object.defineProperty(navigator, 'geolocation', { configurable: true, value: mode === 'unsupported' ? undefined : {
  getCurrentPosition(success, failure, options) {
   state.calls++;
   if (options.maximumAge !== 0 || options.timeout !== 18000) throw new Error('Unexpected geolocation options');
   if (options.enableHighAccuracy) state.fallbackExpected = true;
   else {
    if (!state.fallbackExpected) throw new Error('Normal accuracy requires a preceding high-accuracy attempt');
    state.fallbackExpected = false;
   }
   setTimeout(() => {
    if (state.mode === 'denied') return failure({ code: 1, message: 'Permission denied by test browser' });
    if (state.mode === 'unavailable') return failure({ code: 2, message: 'Position unavailable in test browser' });
    if (state.mode === 'timeout') return failure({ code: 3, message: 'Position request timed out in test browser' });
    state.permission = 'granted';
    success({ coords: { latitude: 41.3879123, longitude: 2.1699123, accuracy: 34 }, timestamp: Date.now() });
   }, 10);
  }
 } });
 if (insecure) Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
}
(async () => {
 const hash = await bcrypt.hash(password, 12);
 for (const [id, email, name, role] of [['qa-session-admin', adminEmail, 'Security Admin', 'ADMIN'], ['qa-session-user', userEmail, 'Security Operator', 'USER'], ['qa-session-long', 'long.account.name.for.responsive.review@security.qa.example.test', 'María del Mar Extraordinarily Long Account Name For Responsive Review', 'USER']]) {
  const existing = await db.user.findUnique({ where: { id } });
  if (existing && existing.email !== email) throw new Error('QA user ID conflicts with an existing account.');
  await db.user.upsert({ where: { id }, create: { id, email, name, role, password: hash }, update: { name, role, password: hash } });
 }
 const browser = await chromium.launch({ ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}), headless: true });
 let wk;
 try {
  const anon = await context(browser);
  assert.equal((await anon.request.post(base + '/api/security/location', { headers: locationHeaders, data: { ...geo, capturedAt: new Date().toISOString() } })).status(), 401);
  assert.equal((await anon.request.get(base + '/api/admin/sessions')).status(), 401);
  const loginPage = await page(anon);
  await loginPage.goto(base + '/login');
  for (const width of widths) await screenshot(loginPage, 'login', width);
  const loginCountBeforeFailure = await db.activityLog.count({ where: { userEmail: adminEmail, action: { in: ['user_login', 'admin_login'] } } });
  await loginPage.getByLabel('Email', { exact: true }).fill(adminEmail);
  await loginPage.getByLabel('Password', { exact: true }).fill('incorrect-password');
  await loginPage.getByRole('button', { name: 'Sign in', exact: true }).click();
  await loginPage.getByText('Invalid email or password').waitFor();
  assert.equal(await db.activityLog.count({ where: { userEmail: adminEmail, action: { in: ['user_login', 'admin_login'] } } }), loginCountBeforeFailure, 'failed credentials must not be mixed into successful LOGIN history');
  console.log('PASS: login layouts, invalid credentials and unauthenticated API denial.');

  const a = await context(browser, { permissions: ['geolocation'], geolocation: geo });
  await apiLogin(a);
  const aPage = await page(a);
  await aPage.goto(base + '/admin/sessions');
  await aPage.getByRole('heading', { name: 'Devices & sessions' }).waitFor();
  await aPage.getByLabel('Find a user by name or email').fill('security.qa.example.test');
  await aPage.getByText('THIS DEVICE', { exact: true }).waitFor();
  const aSession = await (await a.request.get(base + '/api/security/session')).json();
  const aLogin = await assertOneLogin(aSession.id);
  await aPage.reload();
  await aPage.getByRole('heading', { name: 'Devices & sessions' }).waitFor();
  assert.deepEqual(await assertOneLogin(aSession.id), aLogin, 'page refresh must leave LOGIN immutable');
  await aPage.getByLabel('Find a user by name or email').fill('security.qa.example.test');
  await aPage.getByText('THIS DEVICE', { exact: true }).waitFor();

  const b = await context(browser, { ...devices['iPhone 13'], defaultBrowserType: undefined, permissions: ['geolocation'], geolocation: geo });
  const bSession = await apiLogin(b);
  assert.notEqual(aSession.id, bSession.id);
  for (const path of ['/api/admin/sessions', '/api/drivers', '/api/reservations']) assert.equal((await b.request.get(base + path)).status(), 428, path);
  assert.equal((await b.request.post(base + '/api/assistant/chat', { headers, data: { message: 'List reservations' } })).status(), 428);
  const direct = await b.request.get(base + '/drivers', { maxRedirects: 0 });
  assert.equal(direct.status(), 307);
  assert.match(direct.headers().location, /\/location\?next=/);
  assert.equal((await location(b, { sessionId: aSession.id })).status(), 400);
  assert.equal((await location(b, { latitude: 91 })).status(), 400);
  assert.equal((await location(b, { accuracy: 100001 })).status(), 400);
  assert.equal((await b.request.post(base + '/api/security/location', { headers, data: { ...geo, capturedAt: new Date().toISOString() } })).status(), 403, 'same-origin request without the location marker');
  assert.equal((await b.request.post(base + '/api/security/location', { headers: { origin: 'https://foreign.example', 'x-taxi-location-request': 'location-v1' }, data: { ...geo, capturedAt: new Date().toISOString() } })).status(), 403);
  assert.equal((await b.request.post(base + '/api/security/location', { headers: { 'x-taxi-location-request': 'location-v1' }, data: { ...geo, capturedAt: new Date().toISOString() } })).status(), 200, 'iOS-compatible request without Origin');
  assert.equal((await b.request.delete(base + '/api/security/location', { headers: { 'x-taxi-location-request': 'location-v1' } })).status(), 200);
  assert.equal((await location(b)).status(), 200);
  assert.equal((await b.request.get(base + '/api/admin/sessions')).status(), 200);
  const bPage = await page(b);
  await bPage.goto(base + '/reservations');
  await bPage.getByRole('heading', { name: 'Reservations', exact: true }).waitFor();
  console.log('PASS: independent same-account sessions, direct-route/API location enforcement, validation and CSRF checks including omitted Origin.');

  const u = await context(browser, { permissions: ['geolocation'], geolocation: geo });
  const uSession = await apiLogin(u, userEmail);
  assert.equal((await location(u)).status(), 200);
  assert.equal((await u.request.get(base + '/api/admin/sessions')).status(), 403);
  assert.equal((await u.request.post(base + `/api/admin/sessions/${aSession.id}/revoke`, { headers })).status(), 403);
  assert.equal((await u.request.get(base + '/api/security/session')).status(), 200);
  assert.equal((await a.request.post(base + `/api/admin/sessions/${aSession.id}/revoke`, { headers })).status(), 409);
  console.log('PASS: normal user cannot enumerate/revoke sessions; current admin device is protected.');

  await db.deviceSession.update({ where: { id: bSession.id }, data: { ipAddress: '198.51.100.42', networkCity: 'Barcelona', networkRegion: 'Catalonia', networkCountry: 'ES' } });
  await aPage.getByRole('button', { name: 'Refresh devices' }).click();
  const bCard = aPage.locator(`[data-session-id="${bSession.id}"]`);
  await bCard.getByRole('button', { name: 'Log out device', exact: true }).waitFor();
  await bCard.getByText('Barcelona, Catalonia, ES', { exact: true }).waitFor();
  await bCard.locator('summary').click();
  for (const width of widths) { await screenshot(aPage, 'admin-sessions', width); await bCard.screenshot({ path: `${out}/session-detail-${width}.png` }); }
  await bCard.getByRole('button', { name: 'Log out device', exact: true }).click();
  await aPage.getByRole('dialog').waitFor();
  assert.equal(await aPage.evaluate(() => document.activeElement.textContent.trim()), 'Cancel');
  for (const width of widths) await screenshot(aPage, 'revoke-confirmation', width);
  await aPage.keyboard.press('Escape');
  assert.equal(await db.deviceSession.findUnique({ where: { id: bSession.id } }).then(x => x.revokedAt), null);
  await bCard.getByRole('button', { name: 'Log out device', exact: true }).click();
  await aPage.getByRole('dialog').getByRole('button', { name: 'Log out device', exact: true }).click();
  await aPage.getByText('1 device logged out.', { exact: true }).waitFor();
  assert.equal((await b.request.get(base + '/api/reservations')).status(), 401);
  await bPage.evaluate(() => fetch('/api/reservations').then(r => r.status)).catch(() => {});
  await bPage.waitForURL('**/login?reason=session-ended');
  assert.equal((await a.request.get(base + '/api/admin/sessions')).status(), 200);
  const revoked = await db.deviceSession.findUniqueOrThrow({ where: { id: bSession.id } });
  assert.ok(revoked.revokedAt);
  assert.equal(revoked.latitude, null);
  assert.equal(revoked.ipAddress, null);
  assert.equal((await a.request.post(base + `/api/admin/sessions/${bSession.id}/revoke`, { headers })).status(), 200);
  assert.equal(await db.activityLog.count({ where: { entityId: bSession.id, action: 'device_session_revoked' } }), 1);
  const auditPage = await page(a);
  await auditPage.goto(base + `/activity-log?q=${encodeURIComponent(bSession.id)}`);
  await auditPage.getByText('LOGIN', { exact: true }).waitFor();
  await auditPage.getByText('iPhone · Safari · iOS', { exact: true }).waitFor();
  await auditPage.getByText(bSession.id, { exact: true }).waitFor();
  for (const width of widths) await screenshot(auditPage, 'revoked-login-activity', width);
  await assertOneLogin(bSession.id);
  await auditPage.close();
  console.log('PASS: keyboard confirmation/cancel, individual revoke, old-cookie rejection, immediate client login redirect and privacy scrubbing.');

  const rootCause = await context(browser);
  const rootCauseSession = await apiLogin(rootCause);
  await rootCause.addInitScript(installGeoMock, { permission: 'granted' });
  const rootCausePage = await page(rootCause);
  await rootCausePage.route('**/api/security/location', route => {
   if (route.request().method() !== 'DELETE') return route.continue();
   const requestHeaders = { ...route.request().headers() };
   delete requestHeaders['x-taxi-location-request'];
   return route.continue({ headers: requestHeaders });
  });
  const rejectedPreparation = rootCausePage.waitForResponse(r => r.url().endsWith('/api/security/location') && r.request().method() === 'DELETE');
  await rootCausePage.goto(base + '/drivers');
  assert.equal((await rejectedPreparation).status(), 403);
  await rootCausePage.getByRole('heading', { name: 'Location security check failed', exact: true }).waitFor();
  assert.equal(await rootCausePage.evaluate(() => window.__geo.calls), 0, 'the rejected preparation request prevents geolocation');
  assert.match(await rootCausePage.locator('details').textContent(), /INVALID_LOCATION_REQUEST/);
  await assertOneLogin(rootCauseSession.id);
  await rootCause.close();
  console.log('PASS: the production failure path reproduces as a 403 preparation rejection before geolocation.');

  for (const [label, config, heading, needsClick] of [
   ['prompt', { permission: 'prompt' }, 'Location access required', false],
   ['denied', { permission: 'prompt', mode: 'denied' }, 'Location access is required', true],
   ['blocked', { permission: 'denied' }, 'Location is blocked', false],
   ['timeout', { permission: 'granted', mode: 'timeout' }, 'Location verification took too long', false],
   ['unavailable', { permission: 'granted', mode: 'unavailable' }, 'Location is temporarily unavailable', false],
   ['unsupported', { mode: 'unsupported' }, 'Location verification is unavailable', false],
   ['insecure', { insecure: true }, 'Location verification is unavailable', false],
   ['permissions-throws', { permissionsUnsupported: true }, 'Location access required', false],
   ['permissions-absent', { permissionsAbsent: true }, 'Location access required', false],
  ]) {
   const c = await context(browser);
   const testedSession = await apiLogin(c);
   const originalLogin = await assertOneLogin(testedSession.id);
   await c.addInitScript(installGeoMock, config);
   const p = await page(c);
   await p.goto(base + '/drivers');
   if (needsClick) await p.getByRole('button', { name: 'Allow location' }).click();
   await p.getByRole('heading', { name: heading, exact: true }).waitFor();
   assert.equal(await p.locator('nav').count(), 0, 'normal navigation must not be behind the gate');
   assert.equal((await c.request.get(base + '/api/drivers')).status(), 428);
   for (const width of widths) await screenshot(p, 'location-' + label, width);
   assert.deepEqual(await assertOneLogin(testedSession.id), originalLogin, 'a location failure must not create another LOGIN');
   if (label === 'blocked') {
    assert.equal(await p.evaluate(() => window.__geo.calls), 0);
    await p.getByRole('button', { name: 'Try again' }).click();
    await p.getByRole('heading', { name: 'Drivers', exact: true }).waitFor();
    await p.waitForURL('**/drivers');
    assert.equal(await p.evaluate(() => window.__geo.calls), 1, 'a retry reaches geolocation even when PermissionStatus was denied');
   }
   if (label === 'prompt' || label.startsWith('permissions-')) {
    assert.equal(await p.evaluate(() => window.__geo.calls), 0, 'prompt waits for user gesture');
    await p.getByRole('button', { name: 'Allow location' }).click();
    await p.getByRole('heading', { name: 'Drivers', exact: true }).waitFor();
    await p.waitForURL('**/drivers');
    assert.equal((await c.request.get(base + '/api/admin/sessions')).status(), 200);
   }
   if (label === 'denied' || label === 'timeout' || label === 'unavailable') {
    const expectedCode = label === 'denied' ? 'PERMISSION_DENIED' : label === 'timeout' ? 'TIMEOUT' : 'POSITION_UNAVAILABLE';
    assert.match(await p.locator('details').textContent(), new RegExp(expectedCode));
    let failedCalls = await p.evaluate(() => window.__geo.calls);
    assert.equal(failedCalls, label === 'denied' ? 1 : 2, 'timeout/unavailable use one controlled fallback');
    if (label === 'denied') {
     await p.getByRole('button', { name: 'Try again' }).click();
     await p.getByRole('heading', { name: heading, exact: true }).waitFor();
     const repeatedFailureCalls = await p.evaluate(() => window.__geo.calls);
     assert.equal(repeatedFailureCalls, failedCalls + 1, 'a failed retry must still make a fresh geolocation call');
     assert.deepEqual(await assertOneLogin(testedSession.id), originalLogin, 'a failed retry must not create another LOGIN');
     failedCalls = repeatedFailureCalls;
    }
    await p.evaluate(() => window.__geo.setMode('success'));
    await p.getByRole('button', { name: 'Try again' }).click();
    await p.getByRole('heading', { name: 'Drivers', exact: true }).waitFor();
    await p.waitForURL('**/drivers');
    assert.equal(await p.evaluate(callsBefore => window.__geo.calls > callsBefore, failedCalls), true, 'retry creates a fresh geolocation call');
    assert.equal((await c.request.get(base + '/api/admin/sessions')).status(), 200, 'successful retry clears the gate');
   }
   if (label === 'prompt') {
    const own = await (await c.request.get(base + '/api/security/session')).json();
    const withdrawn = p.waitForResponse(r => r.url().endsWith('/api/security/location') && r.request().method() === 'DELETE');
    await p.evaluate(() => window.__geo.setPermission('denied'));
    await p.getByRole('heading', { name: 'Location is blocked', exact: true }).waitFor();
    await withdrawn;
    assert.equal((await c.request.get(base + '/api/admin/sessions')).status(), 428);
    await p.evaluate(() => window.__geo.setPermission('granted'));
    await p.getByRole('heading', { name: 'Drivers', exact: true }).waitFor();
    await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const freshOnResume = p.waitForResponse(r => r.url().endsWith('/api/security/location') && r.request().method() === 'POST');
    await p.evaluate(() => {
     let visibility = 'hidden';
     Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
     document.dispatchEvent(new Event('visibilitychange'));
     const original = Date.now;
     Date.now = () => original() + 301000;
     visibility = 'visible';
     document.dispatchEvent(new Event('visibilitychange'));
     Date.now = original;
    });
    assert.equal((await freshOnResume).status(), 200);
    await p.getByRole('heading', { name: 'Drivers', exact: true }).waitFor();
    await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await p.waitForTimeout(250);
    const freshOnRestore = p.waitForResponse(r => r.url().endsWith('/api/security/location') && r.request().method() === 'POST');
    await p.evaluate(() => { window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
    assert.equal((await freshOnRestore).status(), 200);
    await p.getByRole('heading', { name: 'Drivers', exact: true }).waitFor();
    await db.deviceSession.update({ where: { id: own.id }, data: { locationVerifiedAt: new Date(Date.now() - 31 * 60000) } });
    assert.equal((await c.request.get(base + '/api/admin/sessions')).status(), 428);
    const staleRecovery = p.waitForResponse(r => r.url().endsWith('/api/security/location') && r.request().method() === 'POST');
    await p.evaluate(() => fetch('/api/admin/sessions'));
    assert.equal((await staleRecovery).status(), 200);
    await p.locator('nav').waitFor();
    assert.equal((await c.request.get(base + '/api/admin/sessions')).status(), 200, 'stale-location recovery clears the gate');
    await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await p.waitForTimeout(250);
    let race = true;
    await p.route('**/api/security/location', async route => {
     if (route.request().method() === 'POST' && race) {
      race = false;
      const response = await route.fetch();
      await p.evaluate(() => window.__geo.setPermission('denied'));
      await route.fulfill({ response });
     } else await route.continue();
    });
    await p.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await p.getByRole('heading', { name: 'Location is blocked', exact: true }).waitFor();
    await p.waitForFunction(() => window.__geo.permission === 'denied');
    assert.equal((await c.request.get(base + '/api/admin/sessions')).status(), 428);
    assert.equal(await p.locator('nav').count(), 0);
    assert.deepEqual(await assertOneLogin(own.id), originalLogin, 'location refresh and simulated app resumes leave LOGIN immutable');
    await p.getByRole('button', { name: 'Sign out', exact: true }).click();
    await p.waitForURL('**/login');
    assert.ok((await db.deviceSession.findUniqueOrThrow({ where: { id: own.id } })).revokedAt);
    assert.equal((await c.request.get(base + '/api/security/session')).status(), 401);
    assert.deepEqual(await assertOneLogin(own.id), originalLogin, 'logout retains original LOGIN history');
    const relogin = await apiLogin(c);
    assert.notEqual(relogin.id, own.id, 'a genuine login after logout creates an independent session');
    await assertOneLogin(relogin.id);
    assert.deepEqual(await assertOneLogin(own.id), originalLogin, 'relogin retains the previous session login event');
    console.log('PASS: permission withdrawal/recovery, five-minute resume, cached-page restore, stale-location rejection/recovery, permission/save race, sign-out and genuine relogin.');
   }
   assert.deepEqual(await assertOneLogin(testedSession.id), originalLogin, 'retry must leave LOGIN immutable');
   await c.close();
   console.log('PASS: location ' + label + ', all four widths.');
  }

  const saveFailure = await context(browser);
  const saveFailureSession = await apiLogin(saveFailure);
  await saveFailure.addInitScript(installGeoMock, { permission: 'granted' });
  const saveFailurePage = await page(saveFailure);
  await saveFailurePage.route('**/api/security/location', async route => {
   if (route.request().method() === 'POST') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'SECURITY_UNAVAILABLE' }) });
   return route.continue();
  });
  await saveFailurePage.goto(base + '/drivers');
  await saveFailurePage.getByRole('heading', { name: 'Location could not be saved', exact: true }).waitFor();
  assert.equal((await saveFailure.request.get(base + '/api/drivers')).status(), 428);
  assert.match(await saveFailurePage.locator('details').textContent(), /SECURITY_UNAVAILABLE/);
  await assertOneLogin(saveFailureSession.id);
  await saveFailure.close();
  console.log('PASS: browser success and server persistence failure remain distinct.');

  for (const [label, userAgent, standalone, expectedPlatform] of [
   ['ios-safari-tab', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1', false, 'iOS Safari'],
   ['ios-chrome-tab', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 CriOS/138.0.0.0 Mobile/15E148 Safari/604.1', false, 'iOS Chrome'],
   ['ios-home-screen', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1', true, 'iOS Safari'],
  ]) {
   const c = await context(browser, { userAgent });
   const testedSession = await apiLogin(c);
   const login = await assertOneLogin(testedSession.id);
   await c.addInitScript(installGeoMock, { permission: 'prompt', standalone });
   const p = await page(c);
   await p.goto(base + '/drivers');
   await p.getByRole('heading', { name: 'Location access required', exact: true }).waitFor();
   assert.equal((await c.request.get(base + '/api/drivers')).status(), 428, 'standalone detection must never bypass the location gate');
   const diagnostic = await p.locator('details').textContent();
   assert.match(diagnostic, new RegExp(expectedPlatform));
   assert.match(diagnostic, new RegExp(`"navigatorStandalone": ${standalone}`));
   await p.getByRole('button', { name: 'Allow location' }).click();
   await p.getByRole('heading', { name: 'Drivers', exact: true }).waitFor();
   await p.waitForURL('**/drivers');
   assert.equal((await c.request.get(base + '/api/admin/sessions')).status(), 200);
   assert.deepEqual(await assertOneLogin(testedSession.id), login);
   await c.close();
   console.log('PASS: ' + label + ' compatibility path, required location and one LOGIN.');
  }

  const d = await context(browser); const dSession = await apiLogin(d);
  const e = await context(browser); const eSession = await apiLogin(e);
  await aPage.getByRole('button', { name: 'Refresh devices' }).click();
  await aPage.locator(`[data-session-id="${eSession.id}"]`).waitFor();
  const list = await (await a.request.get(base + '/api/admin/sessions?userId=qa-session-admin')).json();
  const otherIds = list.sessions.filter(s => !s.revokedAt && s.expiresAt > list.now && s.id !== aSession.id).map(s => s.id);
  await aPage.getByRole('button', { name: 'Log out all other devices', exact: true }).click();
  await aPage.getByRole('heading', { name: `Log out ${otherIds.length} devices?`, exact: true }).waitFor();
  for (const width of widths) await screenshot(aPage, 'revoke-others-confirmation', width);
  await aPage.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal((await a.request.post(base + '/api/admin/sessions/revoke-others', { headers, data: { userId: 'qa-session-admin', expectedIds: [dSession.id] } })).status(), 409);
  await aPage.getByRole('button', { name: 'Log out all other devices', exact: true }).click();
  await aPage.getByRole('dialog').getByRole('button', { name: 'Log out devices', exact: true }).click();
  await aPage.getByText(`${otherIds.length} devices logged out.`, { exact: true }).waitFor();
  assert.equal((await a.request.get(base + '/api/admin/sessions')).status(), 200);
  assert.equal((await d.request.get(base + '/api/security/session')).status(), 401);
  assert.equal((await e.request.get(base + '/api/security/session')).status(), 401);
  assert.equal((await u.request.get(base + '/api/security/session')).status(), 200);
  console.log('PASS: counted all-other-devices confirmation, stale-count rejection and current/unrelated session preservation.');

  const expired = await context(browser); const expiredSession = await apiLogin(expired);
  await db.deviceSession.update({ where: { id: expiredSession.id }, data: { createdAt: new Date(Date.now() - 86400000), expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await expired.request.get(base + '/api/security/session')).status(), 401);
  for (const [label, value] of [['malformed', 'not.a.valid.jwt'], ['legacy', await encode({ secret, token: { sub: 'qa-session-admin', email: adminEmail, role: 'ADMIN' } })]]) {
   const c = await context(browser);
   await c.addCookies([{ name: 'next-auth.session-token', value, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
   assert.equal((await c.request.get(base + '/api/reservations')).status(), 401, label);
  }
  await db.user.update({ where: { id: 'qa-session-admin' }, data: { role: 'USER' } });
  assert.equal((await a.request.get(base + '/api/admin/sessions')).status(), 403);
  await db.user.update({ where: { id: 'qa-session-admin' }, data: { role: 'ADMIN' } });
  assert.equal((await a.request.get(base + '/api/admin/sessions')).status(), 200);
  console.log('PASS: expired/malformed/legacy cookies fail, and database role changes apply immediately.');

  if (process.env.SESSION_TEST_WEBKIT === '1') {
  wk = await webkit.launch({ headless: true, timeout: 15000 });
  const iphone = await context(wk, { ...devices['iPhone 13'], permissions: ['geolocation'], geolocation: geo });
  await apiLogin(iphone, userEmail);
  const iphonePage = await page(iphone);
  await iphonePage.goto(base + '/reservations');
  const allow = iphonePage.getByRole('button', { name: 'Allow location' });
  await Promise.race([iphonePage.getByRole('heading', { name: 'Reservations', exact: true }).waitFor(), allow.waitFor()]);
  if (await allow.isVisible()) await allow.click();
  await iphonePage.getByRole('heading', { name: 'Reservations', exact: true }).waitFor();
  await screenshot(iphonePage, 'webkit-iphone-granted', 390);
  await iphonePage.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  if (await allow.isVisible()) await allow.click();
  await iphonePage.getByRole('heading', { name: 'Reservations', exact: true }).waitFor();
  console.log('PASS: WebKit iPhone emulation, permission access and pageshow resume.');
  } else console.log('SKIP: WebKit (set SESSION_TEST_WEBKIT=1 with a working installed runtime).');

  const android = await context(browser, { ...devices['Pixel 7'], permissions: ['geolocation'], geolocation: geo });
  await apiLogin(android, userEmail);
  const androidPage = await page(android);
  await androidPage.goto(base + '/reservations');
  await androidPage.getByRole('heading', { name: 'Reservations', exact: true }).waitFor();
  await screenshot(androidPage, 'chrome-android-granted', 390);
  console.log('PASS: Chrome Android emulation and granted location.');

  fs.writeFileSync(out + '/browser-summary.json', JSON.stringify({ currentSessionId: aSession.id, operatorSessionId: uSession.id, pageErrors }, null, 2));
  assert.deepEqual(pageErrors, []);
  console.log('PASS: browser QA complete without uncaught page errors.');
 } catch (e) { console.error(e.stack); throw e; }
 finally { await browser.close(); if (wk) await wk.close(); await db.$disconnect(); }
})();
