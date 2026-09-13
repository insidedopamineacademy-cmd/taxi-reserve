import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  evaluateSecurityRequest,
  isTrustedSecurityRequest,
  SECURITY_REQUEST_MARKER,
} from "../src/lib/security/securityRequestGuard.ts";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

const expectedOrigin = "https://taxi-reserve.example";
const trust = (overrides: Partial<Parameters<typeof isTrustedSecurityRequest>[0]> = {}) =>
  isTrustedSecurityRequest({
    expectedOrigin,
    origin: expectedOrigin,
    referer: `${expectedOrigin}/settings`,
    secFetchSite: "same-origin",
    marker: null,
    ...overrides,
  });

test("security mutation guard accepts desktop, Safari, and iOS standalone requests without trusting forwarded hosts", () => {
  assert.equal(trust(), true, "normal desktop request");
  assert.equal(trust({ referer: null }), true, "Safari request with Origin");
  assert.equal(trust({ origin: null, marker: SECURITY_REQUEST_MARKER }), true, "standalone WebKit request without Origin");
  assert.equal(trust({ origin: null, referer: `${expectedOrigin}/settings`, secFetchSite: null, marker: SECURITY_REQUEST_MARKER }), true, "standalone WebKit request with canonical Referer");
  assert.equal(trust({ origin: null, referer: null, secFetchSite: null, marker: SECURITY_REQUEST_MARKER }), true, "older WebKit request with only the non-safelisted marker");

  const http = read("src/lib/security/http.ts");
  assert.match(http, /requestTargetOrigin\(request\)/);
  assert.match(http, /request\.headers\.get\("host"\)/);
  assert.doesNotMatch(http, /new URL\(process\.env\.NEXTAUTH_URL/);
  assert.doesNotMatch(http, /x-forwarded-host|x-forwarded-proto/);
});

test("security mutation guard reports the exact rejecting branch without request secrets", () => {
  assert.equal(evaluateSecurityRequest({
    expectedOrigin,
    origin: "https://old-alias.example",
    referer: null,
    secFetchSite: "same-origin",
    marker: SECURITY_REQUEST_MARKER,
  }).branch, "origin-mismatch");
  assert.equal(evaluateSecurityRequest({
    expectedOrigin,
    origin: null,
    referer: null,
    secFetchSite: null,
    marker: SECURITY_REQUEST_MARKER,
  }).branch, "marker-fallback");

  const http = read("src/lib/security/http.ts");
  for (const safeField of ["originPresent", "refererPresent", "refererOrigin", "secFetchSite", "markerPresent", "contentType", "deploymentHost", "branch"]) {
    assert.match(http, new RegExp(safeField));
  }
  const diagnosticProjection = http.match(/const metadata = \{[\s\S]*?\n    \};/)?.[0] ?? "";
  assert.ok(diagnosticProjection);
  assert.doesNotMatch(diagnosticProjection, /request\.body|headers\.get\(["']cookie|headers\.get\(["']authorization|currentPassword|pinHash|settingsPinHash/i);
});

test("security mutation guard rejects missing proof, hostile provenance, and inconsistent browser headers", () => {
  assert.equal(trust({ origin: null, marker: null }), false, "missing Origin alone is insufficient without app proof");
  assert.equal(trust({ origin: "https://attacker.example", referer: null, marker: SECURITY_REQUEST_MARKER }), false);
  assert.equal(trust({ origin: null, referer: "https://attacker.example/phish", marker: SECURITY_REQUEST_MARKER }), false);
  assert.equal(trust({ origin: null, referer: null, secFetchSite: "cross-site", marker: SECURITY_REQUEST_MARKER }), false);
  assert.equal(trust({ origin: expectedOrigin, referer: null, secFetchSite: "same-site", marker: SECURITY_REQUEST_MARKER }), false);
  assert.equal(trust({ origin: "not a URL", referer: null }), false);
});

test("public registration is removed and Login is the only public account entry", () => {
  assert.equal(fs.existsSync(path.join(root, "src/app/(auth)/register/page.tsx")), false);
  assert.equal(fs.existsSync(path.join(root, "src/app/api/register/route.ts")), false);
  const navbar = read("src/components/NavbarClient.tsx");
  const middleware = read("src/middleware.ts");
  assert.doesNotMatch(navbar, /\/register|Register|Sign up|Create account/);
  assert.doesNotMatch(middleware, /"\/register"|"\/api\/register"/);
});

test("User lifecycle schema is additive and preserves relationship-bearing rows", () => {
  const schema = read("prisma/schema.prisma");
  const migration = read("prisma/migrations/20260913120000_add_admin_user_lifecycle/migration.sql");
  assert.match(schema, /enum UserStatus[\s\S]*ACTIVE[\s\S]*INACTIVE/);
  assert.match(schema, /status\s+UserStatus\s+@default\(ACTIVE\)/);
  assert.match(schema, /settingsPinHash\s+String\?/);
  assert.match(schema, /settingsUnlockedUntil\s+DateTime\?/);
  assert.match(migration, /ADD COLUMN "status"/);
  assert.doesNotMatch(migration, /\b(?:DROP|DELETE|TRUNCATE)\b/i);
  assert.doesNotMatch(read("src/lib/security/adminUsers.ts"), /\.user\.(?:delete|deleteMany)\s*\(/);
});

test("role, active status, device session and Settings unlock are separate server checks", () => {
  const auth = read("src/lib/auth.ts");
  const sessions = read("src/lib/security/sessionCore.ts");
  const middleware = read("src/middleware.ts");
  const http = read("src/lib/security/http.ts");
  assert.match(auth, /user\.status !== "ACTIVE"/);
  assert.match(sessions, /record\.user\.status !== "ACTIVE"/);
  assert.match(middleware, /token\.role !== "ADMIN"/);
  assert.match(middleware, /SETTINGS_LOCKED/);
  assert.match(http, /settingsUnlocked/);
  assert.doesNotMatch(`${auth}\n${sessions}\n${middleware}\n${http}`, /arslan/i);
});

test("PIN handling uses bcrypt, persistent lockout and per-session expiry without exposing secrets", () => {
  const gate = read("src/lib/security/adminSecurity.ts");
  const policy = read("src/lib/security/policy.ts");
  const settings = read("src/app/settings/page.tsx");
  const route = read("src/app/api/admin/security-gate/route.ts");
  assert.match(gate, /bcrypt\.hash\(pin, 12\)/);
  assert.match(gate, /bcrypt\.compare\(pin, user\.settingsPinHash\)/);
  assert.match(gate, /ADMIN_SETTINGS_UNLOCK_FAILED/);
  assert.match(policy, /SETTINGS_UNLOCK_WINDOW_MS = 10 \* 60 \* 1000/);
  assert.match(policy, /SETTINGS_PIN_MAX_FAILURES = 5/);
  assert.match(policy, /SETTINGS_PIN_LOCKOUT_MS = 5 \* 60 \* 1000/);
  assert.match(settings, /securityRequestHeaders\(\)/);
  assert.match(route, /requireTrustedSecurityRequest\(request(?:,\s*"admin-security-gate")?\)/);
  assert.doesNotMatch(gate, /metadata:\s*\{[^}]*\b(?:pin|pinHash|settingsPinHash)\s*:/i);
});

test("admin user APIs require the secondary gate and expose no role editor or delete path", () => {
  for (const file of [
    "src/app/api/admin/users/route.ts",
    "src/app/api/admin/users/[id]/password/route.ts",
    "src/app/api/admin/users/[id]/status/route.ts",
    "src/app/api/admin/sessions/route.ts",
    "src/app/api/admin/sessions/[id]/revoke/route.ts",
    "src/app/api/admin/sessions/revoke-others/route.ts",
  ]) assert.match(read(file), /admin: true, settingsUnlocked: true/);
  const users = read("src/lib/security/adminUsers.ts");
  assert.match(users, /role: "USER", status: "ACTIVE"/);
  assert.match(users, /CURRENT_ADMIN_PROTECTED/);
  assert.match(users, /LAST_ADMIN_PROTECTED/);
  assert.doesNotMatch(users, /role\s*:\s*input/);
});

test("mobile user management exposes the requested lifecycle and session actions", () => {
  const manager = read("src/components/security/UserManager.tsx");
  const settings = read("src/app/settings/page.tsx");
  for (const phrase of ["Create user", "Change password", "View sessions", "Deactivate", "Reactivate", "Historical reservations, activity and finance references will be preserved."]) {
    assert.match(manager, new RegExp(phrase));
  }
  assert.match(settings, /Protected Settings/);
  assert.match(settings, /inputMode="numeric"/);
  assert.match(settings, /Lock Settings/);
  assert.doesNotMatch(`${manager}\n${settings}`, /overflow-x-auto|<table/);
});
