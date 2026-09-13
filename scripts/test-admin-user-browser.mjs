import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.ADMIN_USER_UI_TEST_DATABASE_URL;
const base = process.env.ADMIN_USER_UI_TEST_BASE_URL;
const playwrightModule = process.env.PLAYWRIGHT_MODULE;
if (!databaseUrl || !base || !playwrightModule) throw new Error("Set ADMIN_USER_UI_TEST_DATABASE_URL, ADMIN_USER_UI_TEST_BASE_URL and PLAYWRIGHT_MODULE.");
const dbUrl = new URL(databaseUrl);
const appUrl = new URL(base);
if (!["localhost", "127.0.0.1"].includes(dbUrl.hostname) || !dbUrl.pathname.toLowerCase().includes("test") || !["localhost", "127.0.0.1"].includes(appUrl.hostname)) throw new Error("Refusing non-local app or non-local/non-test database.");

const playwright = await import(pathToFileURL(playwrightModule).href);
const { chromium } = playwright.default ?? playwright;
const db = new PrismaClient({ datasourceUrl: databaseUrl });
const output = fs.mkdtempSync(path.join(os.tmpdir(), "taxi-admin-user-browser-"));
const run = randomUUID().slice(0, 8);
const adminPassword = "BrowserAdmin2026!";
const workerOldPassword = "BrowserWorkerOld2026!";
const workerNewPassword = "BrowserWorkerNew2026!";
const pin = "642917";
const adminEmail = `owner-${run}@qa.example.test`;
const workerEmail = `junaid-${run}@qa.example.test`;
const normalEmail = `normal-${run}@qa.example.test`;
const widths = [360, 390, 430, 1280];
const contexts = [];
const pageErrors = [];

async function login(context, email, password, expectedStatus = 200) {
  const csrf = await (await context.request.get(`${base}/api/auth/csrf`)).json();
  const response = await context.request.post(`${base}/api/auth/callback/credentials`, {
    form: { csrfToken: csrf.csrfToken, email, password, json: "true", callbackUrl: `${base}/reservations` },
  });
  assert.equal(response.status(), expectedStatus);
  const body = await response.json().catch(() => ({}));
  return { ...body, status: response.status() };
}

async function pageFor(context) {
  const page = await context.newPage();
  page.on("pageerror", error => pageErrors.push(error.message));
  return page;
}

async function capture(page, name, width) {
  await page.setViewportSize({ width, height: width < 600 ? 760 : 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `${name} overflows at ${width}px`);
  await page.screenshot({ path: path.join(output, `${name}-${width}.png`), fullPage: true });
}

async function captureAll(page, name) {
  for (const width of widths) await capture(page, name, width);
}

console.log("QA artifacts:", output);
const [adminHash, workerHash, normalHash] = await Promise.all([
  bcrypt.hash(adminPassword, 12), bcrypt.hash(workerOldPassword, 12), bcrypt.hash("NormalWorker2026!", 12),
]);
const admin = await db.user.create({ data: { name: "Arslan", email: adminEmail, password: adminHash, role: "ADMIN" } });
const worker = await db.user.create({ data: { name: "Junaid", email: workerEmail, password: workerHash, role: "USER" } });
await db.user.create({ data: { name: "Normal Worker", email: normalEmail, password: normalHash, role: "USER" } });

const browser = await chromium.launch({ ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}), headless: true });
try {
  const workerDeviceContext = await browser.newContext();
  contexts.push(workerDeviceContext);
  await login(workerDeviceContext, workerEmail, workerOldPassword);
  const workerSession = await db.deviceSession.findFirstOrThrow({ where: { userId: worker.id, revokedAt: null }, orderBy: { createdAt: "desc" } });

  const adminContext = await browser.newContext();
  contexts.push(adminContext);
  await login(adminContext, adminEmail, adminPassword);
  const adminSession = await db.deviceSession.findFirstOrThrow({ where: { userId: admin.id, revokedAt: null }, orderBy: { createdAt: "desc" } });
  const page = await pageFor(adminContext);
  let standaloneSetupSeen = false;
  await page.route("**/api/admin/security-gate", async route => {
    const request = route.request();
    if (!standaloneSetupSeen && request.method() === "POST") {
      const headers = { ...request.headers() };
      assert.equal(headers["x-taxi-security-request"], "security-v1");
      delete headers.origin;
      delete headers.referer;
      delete headers["sec-fetch-site"];
      standaloneSetupSeen = true;
      await route.continue({ headers });
      return;
    }
    await route.continue();
  });

  await page.goto(`${base}/admin`);
  await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/settings");
  await page.getByRole("heading", { name: "Set Settings PIN", exact: true }).waitFor();
  assert.equal(await page.getByRole("link", { name: "Open Admin", exact: true }).count(), 0);
  await captureAll(page, "settings-pin-gate");
  const pinInput = page.locator('input[aria-label="Security PIN"]');
  await page.getByLabel("Current account password", { exact: true }).fill(adminPassword);
  await pinInput.fill(pin);
  await page.getByLabel("Confirm security PIN", { exact: true }).fill(pin);
  await page.getByRole("button", { name: "Set PIN and unlock", exact: true }).click();
  await page.getByRole("heading", { name: "Administration", exact: true }).waitFor();
  assert.equal(standaloneSetupSeen, true);
  const configuredAdmin = await db.user.findUniqueOrThrow({ where: { id: admin.id } });
  assert.notEqual(configuredAdmin.settingsPinHash, pin);
  assert.equal(await bcrypt.compare(pin, configuredAdmin.settingsPinHash), true);

  await page.goto(`${base}/settings`);
  await page.getByRole("button", { name: "Lock Settings", exact: true }).click();
  await page.getByRole("heading", { name: "Enter security PIN", exact: true }).waitFor();
  await pinInput.fill("111111");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await page.getByRole("alert").getByText("Incorrect security PIN.", { exact: true }).waitFor();
  await pinInput.fill(pin);
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await page.getByRole("link", { name: "Open Admin", exact: true }).click();
  await page.getByRole("heading", { name: "Administration", exact: true }).waitFor();
  await captureAll(page, "admin-hub");

  const securityBody = { action: "unlock", pin };
  const securityHeaders = { "Content-Type": "application/json", "X-Taxi-Security-Request": "security-v1" };
  assert.equal((await adminContext.request.post(`${base}/api/admin/security-gate`, {
    headers: { ...securityHeaders, Origin: "https://attacker.example" }, data: securityBody,
  })).status(), 403);
  assert.equal((await adminContext.request.post(`${base}/api/admin/security-gate`, {
    headers: { ...securityHeaders, Referer: "https://attacker.example/phish" }, data: securityBody,
  })).status(), 403);
  assert.equal((await adminContext.request.post(`${base}/api/admin/security-gate`, {
    headers: { ...securityHeaders, Referer: `${base}/settings` }, data: { action: "unlock", pin: "123" },
  })).status(), 400);
  assert.equal((await adminContext.request.post(`${base}/api/admin/security-gate`, {
    headers: { ...securityHeaders, "Sec-Fetch-Site": "cross-site" }, data: securityBody,
  })).status(), 403);
  assert.equal((await adminContext.request.post(`${base}/api/admin/security-gate`, {
    headers: { "Content-Type": "application/json" }, data: securityBody,
  })).status(), 403);
  assert.equal((await adminContext.request.post(`${base}/api/admin/security-gate`, {
    headers: { ...securityHeaders, Origin: "https://attacker.example", "X-Forwarded-Host": appUrl.host }, data: securityBody,
  })).status(), 403);
  assert.equal((await adminContext.request.post(`${base}/api/admin/security-gate`, {
    headers: { ...securityHeaders, Origin: base }, data: { action: "unlock", pin: "123" },
  })).status(), 400);

  await page.getByRole("link", { name: /Users/ }).click();
  await page.getByRole("heading", { name: "Users", exact: true }).waitFor();
  await page.getByText(workerEmail, { exact: true }).waitFor();
  await captureAll(page, "users-list");

  await page.getByRole("button", { name: "Create user", exact: true }).click();
  await page.getByRole("heading", { name: "Create user", exact: true }).waitFor();
  await captureAll(page, "create-user-dialog");
  const createForm = page.locator("[data-managed-user-form]");
  await createForm.locator('input[name="name"]').fill("Royal Transfer");
  await createForm.locator('input[name="email"]').fill(`royal-${run}@qa.example.test`);
  await createForm.locator('input[name="password"]').fill("RoyalWorker2026!");
  await createForm.locator('input[name="confirmPassword"]').fill("RoyalWorker2026!");
  await createForm.getByRole("button", { name: "Create user", exact: true }).click();
  await page.getByText("Worker account created.", { exact: true }).waitFor();
  const royal = await db.user.findUniqueOrThrow({ where: { email: `royal-${run}@qa.example.test` } });
  assert.equal(royal.role, "USER");
  assert.equal(royal.status, "ACTIVE");

  const workerCard = page.locator("li", { hasText: workerEmail });
  await workerCard.getByRole("button", { name: "Change password", exact: true }).click();
  await page.getByRole("heading", { name: "Change password", exact: true }).waitFor();
  await captureAll(page, "change-password-dialog");
  const passwordForm = page.locator("[data-managed-user-form]");
  await passwordForm.locator('input[name="password"]').fill(workerNewPassword);
  await passwordForm.locator('input[name="confirmPassword"]').fill(workerNewPassword);
  await passwordForm.getByRole("button", { name: "Change password", exact: true }).click();
  await page.getByText("Password changed and active devices logged out.", { exact: true }).waitFor();
  const workerAfterReset = await db.user.findUniqueOrThrow({ where: { id: worker.id } });
  assert.equal(workerAfterReset.id, worker.id);
  assert.equal(await bcrypt.compare(workerOldPassword, workerAfterReset.password), false);
  assert.equal(await bcrypt.compare(workerNewPassword, workerAfterReset.password), true);
  assert.ok((await db.deviceSession.findUniqueOrThrow({ where: { id: workerSession.id } })).revokedAt);

  const refreshedWorkerCard = page.locator("li", { hasText: workerEmail });
  await refreshedWorkerCard.getByRole("button", { name: "Deactivate", exact: true }).click();
  await page.getByRole("heading", { name: "Deactivate Junaid?", exact: true }).waitFor();
  await captureAll(page, "deactivate-user-dialog");
  await page.locator("[data-managed-user-form]").getByRole("button", { name: "Deactivate", exact: true }).click();
  await page.getByText("User deactivated. Historical records were preserved.", { exact: true }).waitFor();
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: worker.id } })).status, "INACTIVE");
  const blockedContext = await browser.newContext();
  contexts.push(blockedContext);
  const blockedLogin = await login(blockedContext, workerEmail, workerNewPassword, 401);
  assert.equal(blockedLogin.status, 401);

  const inactiveCard = page.locator("li", { hasText: workerEmail });
  await inactiveCard.getByText("USER · INACTIVE", { exact: true }).waitFor();
  await inactiveCard.getByRole("button", { name: "Reactivate", exact: true }).click();
  await page.getByText("User reactivated. They can sign in with their current password.", { exact: true }).waitFor();
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: worker.id } })).status, "ACTIVE");
  const reloginContext = await browser.newContext();
  contexts.push(reloginContext);
  const relogin = await login(reloginContext, workerEmail, workerNewPassword);
  assert.doesNotMatch(relogin.url ?? "", /error=CredentialsSignin/);

  const activeCard = page.locator("li", { hasText: workerEmail });
  await activeCard.getByRole("link", { name: "View sessions", exact: true }).click();
  await page.getByRole("heading", { name: "Devices & sessions", exact: true }).waitFor();
  await page.getByRole("heading", { name: "Junaid", exact: true }).waitFor();
  await captureAll(page, "filtered-sessions");

  const adminRow = await db.user.findUniqueOrThrow({ where: { id: admin.id } });
  assert.equal(adminRow.status, "ACTIVE");
  const normalContext = await browser.newContext();
  contexts.push(normalContext);
  await login(normalContext, normalEmail, "NormalWorker2026!");
  const normalPage = await pageFor(normalContext);
  await normalPage.goto(`${base}/settings`);
  await normalPage.getByRole("heading", { name: "Settings", exact: true }).waitFor();
  assert.equal(await normalPage.getByText("Protected Settings", { exact: true }).count(), 0);
  assert.equal(await normalPage.getByRole("link", { name: "Open Admin", exact: true }).count(), 0);
  const denied = await normalPage.goto(`${base}/admin`);
  assert.equal(new URL(denied.url()).pathname, "/reservations");
  assert.equal((await normalContext.request.get(`${base}/api/admin/users`)).status(), 403);
  assert.equal((await normalContext.request.post(`${base}/api/admin/security-gate`, { headers: { ...securityHeaders, Origin: base }, data: { action: "unlock", pin } })).status(), 403);
  await capture(normalPage, "normal-user-settings", 390);

  const anonymous = await browser.newContext();
  contexts.push(anonymous);
  assert.equal((await anonymous.request.post(`${base}/api/admin/security-gate`, {
    headers: securityHeaders, data: securityBody,
  })).status(), 401);
  await db.deviceSession.update({ where: { id: adminSession.id }, data: { revokedAt: new Date(), revokeReason: "TEST_REVOKED" } });
  assert.equal((await adminContext.request.post(`${base}/api/admin/security-gate`, {
    headers: { ...securityHeaders, Origin: base }, data: securityBody,
  })).status(), 401);
  assert.equal((await anonymous.request.post(`${base}/api/admin/users`, { headers: { Origin: base, "Content-Type": "application/json" }, data: { name: "No", email: "no@example.test", password: "NoPassword2026!", confirmPassword: "NoPassword2026!" } })).status(), 401);
  const register = await anonymous.request.get(`${base}/register`, { maxRedirects: 0 });
  assert.equal(register.status(), 307);
  assert.match(register.headers().location ?? "", /\/login/);

  assert.deepEqual(pageErrors, []);
  console.log("PASS: responsive PIN gate, direct-route protection, user creation/reset/deactivate/reactivate, filtered sessions, USER/anonymous denial and login-only public authentication.");
} finally {
  await Promise.allSettled(contexts.map(context => context.close()));
  await browser.close();
  await db.$disconnect();
}
