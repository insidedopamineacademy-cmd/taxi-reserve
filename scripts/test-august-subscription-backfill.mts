import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseBackfillArguments } from "./backfill-driver-subscriptions-august-2026-core.mts";

test("August backfill defaults to preview with no approvals", () => {
  assert.deepEqual(parseBackfillArguments([]), {
    apply: false,
    actorEmail: null,
    executionId: null,
    approvals: [],
  });
});

test("apply requires an explicit reviewed driver list, admin identity, and execution ID", () => {
  assert.throws(() => parseBackfillArguments(["--apply"]), /at least one explicit/);
  assert.throws(() => parseBackfillArguments(["--apply-all"]), /intentionally unsupported/);
  assert.throws(
    () => parseBackfillArguments(["--approve=driver-1:VAN:20.00"]),
    /only together with --apply/,
  );
  assert.throws(
    () => parseBackfillArguments(["--apply", "--approve=driver-1:VAN:7.00"]),
    /must use 20.00/,
  );
  assert.throws(
    () =>
      parseBackfillArguments([
        "--apply",
        "--approve=driver-1:SEDAN:7.00",
        "--approve=driver-1:SEDAN:7.00",
      ]),
    /only once/,
  );
});

test("apply syntax pins each ID, reviewed vehicle type, and exact amount", () => {
  assert.deepEqual(
    parseBackfillArguments([
      "--apply",
      "--actor-email=ADMIN@EXAMPLE.COM",
      "--execution-id=august-review-2026-001",
      "--approve=driver-van:VAN:20.00",
      "--approve=driver-sedan:SEDAN:7.00",
    ]),
    {
      apply: true,
      actorEmail: "admin@example.com",
      executionId: "august-review-2026-001",
      approvals: [
        { driverId: "driver-van", vehicleType: "VAN", amount: "20.00" },
        { driverId: "driver-sedan", vehicleType: "SEDAN", amount: "7.00" },
      ],
    },
  );
});

test("preview is executed inside a database-enforced read-only transaction", () => {
  const source = readFileSync(
    new URL("./backfill-driver-subscriptions-august-2026.mts", import.meta.url),
    "utf8",
  );
  const previewBranch = source.slice(source.indexOf("if (!args.apply)"), source.indexOf("const result = await applyApproved"));
  assert.match(previewBranch, /SET TRANSACTION READ ONLY/);
  assert.match(previewBranch, /buildPreview\(transaction\)/);
  assert.doesNotMatch(previewBranch, /\.create\(|\.update\(|\.delete\(/);
});
