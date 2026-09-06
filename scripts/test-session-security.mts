import assert from "node:assert/strict";
import test from "node:test";
import { parseDeviceMetadata, trustedNetworkMetadata } from "../src/lib/security/deviceMetadata.ts";
import { hasFreshLocation, LOCATION_MAX_AGE_MS, parseLocationInput, safeReturnPath } from "../src/lib/security/policy.ts";
import { getOnePosition, locationErrorState, queryLocationPermission } from "../src/lib/security/geolocationClient.ts";
import { loginActivityDetails } from "../src/lib/security/loginActivity.ts";

test("login presentation uses an explicit safe projection and distinguishes historical admin duplicates", () => {
  const details = loginActivityDetails({ action: "user_login", entityId: "safe-session-id", metadata: {
    sessionId: "safe-session-id", device: "iPhone", browser: "Safari", os: "iOS",
    networkCity: "Barcelona", networkCountry: "ES", ipAddress: "198.51.100.42",
    token: "must-not-appear", password: "must-not-appear", latitude: 41,
  } }, "safe-session-id");
  assert.equal(details?.label, "LOGIN");
  assert.equal(details?.device, "iPhone · Safari · iOS");
  assert.equal(details?.network, "Barcelona, Spain");
  assert.equal(details?.isCurrentSession, true);
  assert.equal(JSON.stringify(details).includes("must-not-appear"), false);
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

test("IP metadata is trusted only on Vercel and a forwarded list is never guessed", () => {
  const headers = new Headers({ "x-forwarded-for": "198.51.100.9", "x-vercel-forwarded-for": "2001:db8::1", "x-vercel-ip-city": "Sant%20Adri%C3%A0", "x-vercel-ip-country": "ES" });
  assert.equal(trustedNetworkMetadata(headers, false).ipAddress, null);
  assert.equal(trustedNetworkMetadata(headers, true).ipAddress, "2001:db8::1");
  assert.equal(trustedNetworkMetadata(headers, true).networkCity, "Sant Adrià");
  headers.set("x-vercel-forwarded-for", "198.51.100.1, 198.51.100.2");
  assert.equal(trustedNetworkMetadata(headers, true).ipAddress, null);
  headers.delete("x-vercel-forwarded-for");
  assert.equal(trustedNetworkMetadata(headers, true).ipAddress, null, "no generic x-forwarded-for fallback");
});

test("location accepts fresh finite coordinates and rejects spoofed identity, stale time and impossible accuracy", () => {
  const now = new Date("2026-09-06T09:00:00Z");
  const input = { latitude: 41.38791234, longitude: 2.16991234, accuracy: 34.5, capturedAt: now.toISOString() };
  const parsed = parseLocationInput(input, now);
  assert.equal(parsed.latitude, 41.3879);
  assert.equal(parsed.accuracy, 34.5);
  assert.deepEqual(parsed.locationVerifiedAt, now);
  for (const value of [null, [], { ...input, sessionId: "another-session" }, { ...input, latitude: 91 }, { ...input, longitude: -181 }, { ...input, latitude: "41" }, { ...input, latitude: NaN }, { ...input, accuracy: Infinity }, { ...input, accuracy: -1 }, { ...input, accuracy: 100001 }, { ...input, capturedAt: "2026-09-05T09:00:00Z" }, { ...input, capturedAt: "2026-09-07T09:00:00Z" }]) {
    assert.throws(() => parseLocationInput(value, now));
  }
});

test("freshness has an exact 30-minute limit and return paths stay on the app", () => {
  const now = new Date("2026-09-06T09:00:00Z");
  assert.equal(hasFreshLocation(new Date(now.getTime() - LOCATION_MAX_AGE_MS + 1), now), true);
  assert.equal(hasFreshLocation(new Date(now.getTime() - LOCATION_MAX_AGE_MS), now), false);
  assert.equal(hasFreshLocation(null, now), false);
  assert.equal(hasFreshLocation(new Date(now.getTime() + 1), now), false);
  for (const path of ["https://example.com", "//example.com", "/\\example.com", "/location", "/api/admin", null]) assert.equal(safeReturnPath(path), "/reservations");
  assert.equal(safeReturnPath("/drivers?query=Ali"), "/drivers?query=Ali");
});

test("Safari permission-query fallbacks and geolocation error states stay distinct", async () => {
  assert.equal(await queryLocationPermission(undefined), null);
  assert.equal(await queryLocationPermission({ query: async () => { throw new Error("Unsupported"); } } as unknown as Permissions), null);
  const permission = { state: "denied" };
  assert.equal(await queryLocationPermission({ query: async () => permission } as unknown as Permissions), permission);
  assert.equal(locationErrorState({ code: 1 }, "denied"), "blocked");
  assert.equal(locationErrorState({ code: 1 }, undefined), "denied");
  assert.equal(locationErrorState({ code: 2 }, "granted"), "unavailable");
  assert.equal(locationErrorState({ code: 3 }, "granted"), "timeout");
});

test("one-shot location uses fresh cached age, a bounded timeout and no continuous tracking", async () => {
  let calls = 0;
  const geo = { getCurrentPosition(success: PositionCallback, _failure: PositionErrorCallback, options: PositionOptions) {
    calls++;
    assert.deepEqual(options, { enableHighAccuracy: false, maximumAge: 0, timeout: 12000 });
    success({ coords: { latitude: 41, longitude: 2, accuracy: 45 }, timestamp: Date.now() } as GeolocationPosition);
  } } as Geolocation;
  assert.equal((await getOnePosition(geo)).coords.accuracy, 45);
  assert.equal(calls, 1);
});
