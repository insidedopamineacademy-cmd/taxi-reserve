import assert from "node:assert/strict";
import test from "node:test";
import { formatCalendarDateDisplay, parseCalendarDateInput } from "../src/lib/dateDisplay.ts";

test("formats canonical calendar dates with fixed English month abbreviations", () => {
  assert.equal(formatCalendarDateDisplay("2026-01-05"), "05 Jan 2026");
  assert.equal(formatCalendarDateDisplay("2026-08-18"), "18 Aug 2026");
  assert.equal(formatCalendarDateDisplay("2026-12-31"), "31 Dec 2026");
});

test("validates leap days and month boundaries without parsing an instant", () => {
  assert.equal(formatCalendarDateDisplay("2024-02-29"), "29 Feb 2024");
  assert.equal(formatCalendarDateDisplay("2026-04-30"), "30 Apr 2026");
  assert.equal(formatCalendarDateDisplay("2026-05-01"), "01 May 2026");
  assert.throws(() => formatCalendarDateDisplay("2026-02-29"), RangeError);
  assert.throws(() => formatCalendarDateDisplay("2026-04-31"), RangeError);
});

test("rejects malformed calendar strings instead of reinterpreting them", () => {
  for (const value of [
    "",
    "2026-8-18",
    "18/08/2026",
    "2026-00-10",
    "2026-13-01",
    "2026-08-00",
    "2026-08-18T00:00:00Z",
  ]) {
    assert.throws(() => formatCalendarDateDisplay(value), RangeError);
  }
});

test("calendar-date output does not change with the runtime timezone", () => {
  const originalTimeZone = process.env.TZ;
  try {
    const outputs = ["UTC", "Europe/Madrid", "America/Los_Angeles", "Pacific/Kiritimati"]
      .map((timeZone) => {
        process.env.TZ = timeZone;
        return formatCalendarDateDisplay("2026-08-19");
      });
    assert.deepEqual(outputs, Array(4).fill("19 Aug 2026"));
  } finally {
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
  }
});

test("parseCalendarDateInput normalizes the human DD MMM YYYY standard to canonical YYYY-MM-DD", () => {
  assert.equal(parseCalendarDateInput("05 Jan 2026"), "2026-01-05");
  assert.equal(parseCalendarDateInput("18 Aug 2026"), "2026-08-18");
  assert.equal(parseCalendarDateInput("31 Dec 2026"), "2026-12-31");
  assert.equal(parseCalendarDateInput("29 Feb 2024"), "2024-02-29"); // valid leap day
});

test("parseCalendarDateInput accepts named months case-insensitively", () => {
  assert.equal(parseCalendarDateInput("18 Aug 2026"), "2026-08-18");
  assert.equal(parseCalendarDateInput("18 AUG 2026"), "2026-08-18");
  assert.equal(parseCalendarDateInput("18 aug 2026"), "2026-08-18");
});

test("parseCalendarDateInput preserves canonical ISO input unchanged", () => {
  assert.equal(parseCalendarDateInput("2026-08-18"), "2026-08-18");
  assert.equal(parseCalendarDateInput("2024-02-29"), "2024-02-29");
});

test("parseCalendarDateInput rejects impossible or unrecognized dates without reinterpreting them", () => {
  for (const value of [
    "31 Feb 2026",
    "29 Feb 2025", // 2025 is not a leap year
    "31 Apr 2026",
    "00 Aug 2026",
    "32 Aug 2026",
    "18 Foo 2026",
    "2026-02-29",
    "2026-13-01",
    "18/08/2026",
    "18 August 2026", // full month name is not the fixed abbreviation
    "",
    "tomorrow",
  ]) {
    assert.equal(parseCalendarDateInput(value), null, `${value} must not parse`);
  }
});

test("parseCalendarDateInput is timezone-independent (18 Aug 2026 never drifts a day)", () => {
  const originalTimeZone = process.env.TZ;
  try {
    const outputs = ["UTC", "Europe/Madrid", "America/Los_Angeles", "Pacific/Kiritimati"]
      .map((timeZone) => {
        process.env.TZ = timeZone;
        return parseCalendarDateInput("18 Aug 2026");
      });
    assert.deepEqual(outputs, Array(4).fill("2026-08-18"));
  } finally {
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
  }
});
