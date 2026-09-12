// Optional responsive browser suite. Requires a local app using the same
// disposable PostgreSQL database and the Playwright module path supplied here.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.PAYMENT_UI_TEST_DATABASE_URL;
const base = process.env.PAYMENT_UI_TEST_BASE_URL;
const playwrightModule = process.env.PLAYWRIGHT_MODULE;
if (!databaseUrl || !base || !playwrightModule) {
  throw new Error("Set PAYMENT_UI_TEST_DATABASE_URL, PAYMENT_UI_TEST_BASE_URL and PLAYWRIGHT_MODULE.");
}
const dbUrl = new URL(databaseUrl);
const appUrl = new URL(base);
if (!["localhost", "127.0.0.1"].includes(dbUrl.hostname) || !dbUrl.pathname.toLowerCase().includes("test") || !["localhost", "127.0.0.1"].includes(appUrl.hostname)) {
  throw new Error("Refusing non-local app or non-local/non-test database.");
}

const playwright = await import(pathToFileURL(playwrightModule).href);
const { chromium } = playwright.default ?? playwright;
const db = new PrismaClient({ datasourceUrl: databaseUrl });
const output = fs.mkdtempSync(path.join(os.tmpdir(), "taxi-admin-payment-browser-"));
const run = randomUUID().slice(0, 8);
const password = "TaxiAllocationQA2026!";
const adminEmail = `allocation-admin-${run}@qa.example.test`;
const userEmail = `allocation-user-${run}@qa.example.test`;
const widths = [360, 390, 430, 1280];
const contexts = [];
const pageErrors = [];

async function login(context, email) {
  const csrf = await (await context.request.get(`${base}/api/auth/csrf`)).json();
  const response = await context.request.post(`${base}/api/auth/callback/credentials`, {
    form: { csrfToken: csrf.csrfToken, email, password, json: "true", callbackUrl: `${base}/reservations` },
  });
  assert.equal(response.status(), 200);
}

async function pageFor(context) {
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  return page;
}

async function capture(page, name, width) {
  await page.setViewportSize({ width, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `${name} overflows at ${width}px`);
  await page.screenshot({ path: path.join(output, `${name}-${width}.png`), fullPage: true });
}

console.log("QA artifacts:", output);
const hash = await bcrypt.hash(password, 12);
const [admin, user] = await Promise.all([
  db.user.create({ data: { email: adminEmail, name: "Allocation Admin", role: "ADMIN", password: hash } }),
  db.user.create({ data: { email: userEmail, name: "Allocation User", role: "USER", password: hash } }),
]);
const driver = await db.driver.create({ data: {
  name: `Allocation Driver ${run}`,
  licenseNumber: `ALLOC-${run}`,
  vehicleType: "VAN",
} });
await db.commissionEntry.create({ data: {
  driverId: driver.id,
  commissionAmount: "244.00",
  entryDate: new Date("2026-09-08T00:00:00.000Z"),
} });
await db.driverSubscriptionCharge.create({ data: {
  driverId: driver.id,
  chargeMonth: new Date("2026-09-01T00:00:00.000Z"),
  amount: "20.00",
} });

const browser = await chromium.launch({
  ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}),
  headless: true,
});

try {
  const adminContext = await browser.newContext();
  contexts.push(adminContext);
  await login(adminContext, adminEmail);
  const page = await pageFor(adminContext);

  await page.goto(`${base}/settings`);
  await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
  await page.getByRole("link", { name: "Open Admin", exact: true }).waitFor();
  for (const width of widths) await capture(page, "settings-admin", width);
  await page.getByRole("link", { name: "Open Admin", exact: true }).click();
  await page.getByRole("heading", { name: "Administration", exact: true }).waitFor();
  await page.getByRole("link", { name: /Devices & Sessions/ }).waitFor();
  await page.getByRole("link", { name: /^Users/ }).waitFor();
  for (const width of widths) await capture(page, "admin-actions", width);
  await page.getByRole("link", { name: /Devices & Sessions/ }).click();
  await page.getByRole("heading", { name: "Devices & sessions", exact: true }).waitFor();
  for (const width of widths) await capture(page, "admin-sessions", width);

  await page.goto(`${base}/drivers/${driver.id}`);
  await page.getByRole("link", { name: "Record payment", exact: true }).waitFor();
  await page.getByRole("link", { name: "Add commission", exact: true }).waitFor();
  for (const width of widths) await capture(page, "driver-ledger-unpaid", width);
  await page.getByRole("link", { name: "Record payment", exact: true }).click();
  await page.getByRole("heading", { name: "Record payment", exact: true }).waitFor();
  await page.getByLabel("Payment amount (€)").fill("10.00");
  const firstPreview = await page.getByLabel("Payment allocation preview").textContent();
  assert.match(firstPreview ?? "", /September 2026 subscription/);
  assert.match(firstPreview ?? "", /Remaining subscription €10\.00/);
  assert.match(firstPreview ?? "", /Commission balance€0\.00/);
  for (const width of widths) await capture(page, "payment-preview-partial", width);
  await page.getByRole("button", { name: "Record payment", exact: true }).click();
  await page.getByRole("heading", { name: driver.name, exact: true }).waitFor();
  const subscription = page.locator("#monthly-subscription");
  await subscription.getByText("Partially paid", { exact: true }).first().waitFor();
  assert.match(await subscription.textContent() ?? "", /Paid€10\.00/);
  assert.match(await subscription.textContent() ?? "", /Remaining€10\.00/);

  await page.getByRole("link", { name: "Record payment", exact: true }).click();
  await page.getByLabel("Payment amount (€)").fill("50.00");
  const secondPreview = await page.getByLabel("Payment allocation preview").textContent();
  assert.match(secondPreview ?? "", /September 2026 subscription€10\.00/);
  assert.match(secondPreview ?? "", /Commission balance€40\.00/);
  for (const width of widths) await capture(page, "payment-preview-final", width);
  await page.getByRole("button", { name: "Record payment", exact: true }).click();
  await page.getByRole("heading", { name: driver.name, exact: true }).waitFor();
  await subscription.getByText("Paid", { exact: true }).first().waitFor();
  assert.match(await subscription.textContent() ?? "", /Paid€20\.00/);
  assert.match(await subscription.textContent() ?? "", /Remaining€0\.00/);
  for (const width of widths) await capture(page, "driver-ledger-paid", width);

  const summary = await Promise.all([
    db.driverPayment.aggregate({ where: { driverId: driver.id }, _sum: { amount: true } }),
    db.driverSubscriptionPaymentAllocation.aggregate({ where: { subscriptionCharge: { driverId: driver.id } }, _sum: { amount: true } }),
  ]);
  assert.equal(summary[0]._sum.amount?.toFixed(2), "60.00");
  assert.equal(summary[1]._sum.amount?.toFixed(2), "20.00");
  const pdfStatuses = await Promise.all([
    adminContext.request.get(`${base}/api/drivers/due-pdf`),
    adminContext.request.get(`${base}/api/drivers/${driver.id}/ledger-pdf`),
    adminContext.request.get(`${base}/api/drivers/full-ledger-pdf`),
  ]);
  assert.deepEqual(pdfStatuses.map((response) => response.status()), [200, 200, 200]);

  const userContext = await browser.newContext();
  contexts.push(userContext);
  await login(userContext, userEmail);
  const userPage = await pageFor(userContext);
  await userPage.goto(`${base}/settings`);
  await userPage.getByRole("heading", { name: "Settings", exact: true }).waitFor();
  assert.equal(await userPage.getByRole("link", { name: "Open Admin", exact: true }).count(), 0);
  const denied = await userPage.goto(`${base}/admin`);
  assert.equal(denied?.url(), `${base}/reservations`);
  assert.equal((await userContext.request.get(`${base}/api/admin`)).status(), 403);
  await capture(userPage, "settings-user", 390);

  assert.deepEqual(pageErrors, []);
  console.log("PASS: responsive Settings/Admin/Sessions navigation and payment allocation previews, partial/paid ledger states, all finance PDF routes, and USER denial.");
  void admin;
  void user;
} finally {
  await Promise.allSettled(contexts.map((context) => context.close()));
  await browser.close();
  await db.$disconnect();
}
