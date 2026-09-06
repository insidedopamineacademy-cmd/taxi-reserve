import assert from "node:assert/strict";
import test from "node:test";
import { parseDeviceMetadata, trustedNetworkMetadata } from "../src/lib/security/deviceMetadata.ts";
import { hasFreshLocation, LOCATION_MAX_AGE_MS, parseLocationInput, safeReturnPath } from "../src/lib/security/policy.ts";
import { getFreshPosition, inspectLocationPermission, locationErrorState, queryLocationPermission } from "../src/lib/security/geolocationClient.ts";
import { classifyLocationPlatform, collectLocationRuntimeDiagnostic, isStandaloneWebApp, safeGeolocationError } from "../src/lib/security/locationDiagnostics.ts";
import { isTrustedLocationRequest, LOCATION_REQUEST_MARKER } from "../src/lib/security/locationRequestGuard.ts";
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
  const thrown = await inspectLocationPermission({ query: async () => { throw new TypeError("Unsupported"); } } as unknown as Permissions);
  assert.deepEqual(thrown, { status: null, outcome: "error", errorName: "TypeError" });
  assert.deepEqual(await inspectLocationPermission(undefined), { status: null, outcome: "unsupported" });
  const permission = { state: "denied" };
  assert.equal(await queryLocationPermission({ query: async () => permission } as unknown as Permissions), permission);
  assert.deepEqual(await inspectLocationPermission({ query: async () => ({ state: "mystery" }) } as unknown as Permissions), { status: null, outcome: "unexpected" });
  assert.equal(locationErrorState({ code: 1 }, "denied"), "blocked");
  assert.equal(locationErrorState({ code: 1 }, undefined), "denied");
  assert.equal(locationErrorState({ code: 2 }, "granted"), "unavailable");
  assert.equal(locationErrorState({ code: 3 }, "granted"), "timeout");
});

test("one-shot location is fresh, starts with high accuracy and uses a bounded normal-accuracy fallback", async () => {
  const options: PositionOptions[] = [];
  const errors: string[] = [];
  const geo = { getCurrentPosition(success: PositionCallback, failure: PositionErrorCallback, value: PositionOptions) {
    options.push(value);
    if (options.length === 1) failure({ code: 3, message: "timed out" } as GeolocationPositionError);
    else success({ coords: { latitude: 41, longitude: 2, accuracy: 45 }, timestamp: Date.now() } as GeolocationPosition);
  } } as Geolocation;
  assert.equal((await getFreshPosition(geo, (error, accuracy) => errors.push(`${accuracy}:${error.code}`))).coords.accuracy, 45);
  assert.deepEqual(options, [
    { enableHighAccuracy: true, maximumAge: 0, timeout: 18000 },
    { enableHighAccuracy: false, maximumAge: 0, timeout: 18000 },
  ]);
  assert.deepEqual(errors, ["high:3"]);
});

test("permission denial does not trigger an accuracy fallback and each retry creates a fresh request", async () => {
  let calls = 0;
  let mode: "denied" | "success" = "denied";
  const geo = { getCurrentPosition(success: PositionCallback, failure: PositionErrorCallback, options: PositionOptions) {
    calls++;
    assert.deepEqual(options, { enableHighAccuracy: true, maximumAge: 0, timeout: 18000 });
    if (mode === "denied") return failure({ code: 1, message: "denied" } as GeolocationPositionError);
    success({ coords: { latitude: 41, longitude: 2, accuracy: 45 }, timestamp: Date.now() } as GeolocationPosition);
  } } as Geolocation;
  await assert.rejects(getFreshPosition(geo));
  mode = "success";
  assert.equal((await getFreshPosition(geo)).coords.accuracy, 45);
  assert.equal(calls, 2, "retry must invoke getCurrentPosition again");
});

test("Permissions API absence or failure never prevents a direct geolocation attempt", async () => {
  for (const permissions of [
    undefined,
    { query: async () => { throw new Error("not implemented"); } } as unknown as Permissions,
  ]) {
    assert.equal((await inspectLocationPermission(permissions)).status, null);
    let calls = 0;
    const geo = { getCurrentPosition(success: PositionCallback) {
      calls++;
      success({ coords: { latitude: 41, longitude: 2, accuracy: 50 }, timestamp: Date.now() } as GeolocationPosition);
    } } as Geolocation;
    await getFreshPosition(geo);
    assert.equal(calls, 1);
  }
});

test("standalone diagnostics are coarse and never satisfy the location request guard", () => {
  assert.equal(isStandaloneWebApp({ standalone: true }, () => ({ matches: false })), true);
  assert.equal(isStandaloneWebApp({}, () => ({ matches: true })), true);
  assert.equal(classifyLocationPlatform("Mozilla/5.0 (iPhone) CriOS/130 Mobile Safari/604.1"), "iOS Chrome");
  assert.equal(classifyLocationPlatform("Mozilla/5.0 (iPhone) Version/18.5 Mobile Safari/604.1"), "iOS Safari");
  assert.deepEqual(collectLocationRuntimeDiagnostic(
    { isSecureContext: true, location: { protocol: "https:" }, matchMedia: () => ({ matches: true }) },
    { geolocation: {}, standalone: true, userAgent: "Mozilla/5.0 (iPhone) Version/18.5 Mobile Safari/604.1" },
    { visibilityState: "visible" },
  ), {
    geolocationAvailable: true,
    secureContext: true,
    visibility: "visible",
    navigatorStandalone: true,
    displayModeStandalone: true,
    protocol: "https:",
    platform: "iOS Safari",
  });
  assert.equal(isTrustedLocationRequest({ expectedOrigin: "https://taxi.example", origin: null, secFetchSite: null, marker: null }), false);
});

test("the location CSRF marker safely supports an omitted Origin without accepting foreign requests", () => {
  const expectedOrigin = "https://taxi.example";
  assert.equal(isTrustedLocationRequest({ expectedOrigin, origin: null, secFetchSite: null, marker: LOCATION_REQUEST_MARKER }), true);
  assert.equal(isTrustedLocationRequest({ expectedOrigin, origin: expectedOrigin, secFetchSite: "same-origin", marker: LOCATION_REQUEST_MARKER }), true);
  assert.equal(isTrustedLocationRequest({ expectedOrigin, origin: "https://foreign.example", secFetchSite: "cross-site", marker: LOCATION_REQUEST_MARKER }), false);
  assert.equal(isTrustedLocationRequest({ expectedOrigin, origin: null, secFetchSite: "cross-site", marker: LOCATION_REQUEST_MARKER }), false);
  assert.equal(isTrustedLocationRequest({ expectedOrigin, origin: expectedOrigin, secFetchSite: "same-origin", marker: "wrong" }), false);
});

test("development geolocation diagnostics map exact codes and sanitize messages", () => {
  assert.deepEqual(safeGeolocationError({ code: 1, message: "Permission\nDenied" }), { code: 1, name: "PERMISSION_DENIED", message: "Permission Denied" });
  assert.equal(safeGeolocationError({ code: 2, message: "Unavailable" }).name, "POSITION_UNAVAILABLE");
  assert.equal(safeGeolocationError({ code: 3, message: "Timeout" }).name, "TIMEOUT");
  assert.equal(safeGeolocationError({ code: 99, message: "x".repeat(300) }).message.length, 160);
});
