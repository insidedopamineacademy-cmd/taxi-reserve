import assert from "node:assert/strict";
import test from "node:test";
import { parseDeviceMetadata, trustedNetworkMetadata } from "../src/lib/security/deviceMetadata.ts";
import { loginActivityDetails } from "../src/lib/security/loginActivity.ts";

test("login presentation uses an explicit safe projection", () => {
  const details = loginActivityDetails({ action: "user_login", entityId: "safe-session-id", metadata: {
    sessionId: "safe-session-id", device: "iPhone", browser: "Safari", os: "iOS",
    networkCity: "Barcelona", networkCountry: "ES", ipAddress: "198.51.100.42",
    token: "must-not-appear", password: "must-not-appear", latitude: 41,
  } }, "safe-session-id");
  assert.equal(details?.label, "LOGIN");
  assert.equal(details?.device, "iPhone · Safari · iOS");
  assert.equal(details?.network, "Barcelona, Spain");
  assert.equal(details?.ipAddress, "198.51.100.42");
  assert.equal(details?.isCurrentSession, true);
  assert.equal(JSON.stringify(details).includes("must-not-appear"), false);
  assert.equal(JSON.stringify(details).includes("latitude"), false);
  assert.equal(loginActivityDetails({ action: "user_login", entityId: "old-session", metadata: null })?.device, "Device details unavailable");
  assert.equal(loginActivityDetails({ action: "admin_login", entityId: null, metadata: [] })?.label, "ADMIN LOGIN (LEGACY)");
  assert.equal(loginActivityDetails({ action: "user_logout", entityId: "safe-session-id", metadata: {} }), null);
});

test("device labels use ordinary UA metadata without inventing hardware models", () => {
  const iphone = parseDeviceMetadata("Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) Version/18.5 Mobile/15E148 Safari/604.1");
  assert.deepEqual([iphone.device, iphone.browser, iphone.os], ["iPhone", "Safari", "iOS"]);
  assert.equal(parseDeviceMetadata("Mozilla/5.0 Android Pixel Chrome/130 Safari/537").device, "Android");
  assert.equal(parseDeviceMetadata("Macintosh Intel Mac OS X Chrome/130 Safari/537").browser, "Chrome");
  assert.equal(parseDeviceMetadata("Windows NT 10.0 Chrome/130 Safari/537 Edg/130").browser, "Edge");
  assert.equal(parseDeviceMetadata("iPhone FxiOS/100 Safari/600").browser, "Firefox");
  assert.equal(parseDeviceMetadata(null).device, "Unknown device");
  assert.equal(parseDeviceMetadata("x".repeat(600)).userAgent?.length, 512);
});

test("IP metadata trusts only Vercel-controlled headers", () => {
  const headers = new Headers({
    "x-forwarded-for": "198.51.100.9",
    "x-vercel-forwarded-for": "2001:db8::1",
    "x-vercel-ip-city": "Sant%20Adri%C3%A0",
    "x-vercel-ip-country": "ES",
  });
  assert.equal(trustedNetworkMetadata(headers, false).ipAddress, null);
  assert.equal(trustedNetworkMetadata(headers, true).ipAddress, "2001:db8::1");
  assert.equal(trustedNetworkMetadata(headers, true).networkCity, "Sant Adrià");
  headers.set("x-vercel-forwarded-for", "198.51.100.1, 198.51.100.2");
  assert.equal(trustedNetworkMetadata(headers, true).ipAddress, null);
  headers.delete("x-vercel-forwarded-for");
  assert.equal(trustedNetworkMetadata(headers, true).ipAddress, null, "generic forwarding headers are never trusted");
});
