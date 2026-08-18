import assert from "node:assert/strict";
import test from "node:test";
import {
  PDF_MIME,
  buildShareFilename,
  shareProtectedPdf,
  type SharePdfDeps,
} from "../src/lib/pdfShare.ts";

test("buildShareFilename produces filesystem-safe, human-dated names", () => {
  assert.equal(
    buildShareFilename("comisiones-pendientes", "18 Aug 2026"),
    "comisiones-pendientes-18-Aug-2026.pdf",
  );
  assert.equal(
    buildShareFilename("full-driver-ledger", "05 Jan 2026"),
    "full-driver-ledger-05-Jan-2026.pdf",
  );
  // Unsafe characters and repeated separators collapse away.
  assert.equal(
    buildShareFilename("ledger / João Pé", "31 Dec 2026"),
    "ledger-Joo-P-31-Dec-2026.pdf",
  );
  assert.match(buildShareFilename("x", "y"), /\.pdf$/);
});

type Recorder = {
  fetchCalls: Array<{ url: string; init?: RequestInit }>;
  shareCalls: Array<{ files?: unknown; title?: string }>;
  fileArgs: Array<{ name: string; type: string | undefined }>;
};

function makeDeps(options: {
  hasShare?: boolean;
  hasCanShare?: boolean;
  canShare?: boolean;
  ok?: boolean;
  fetchThrows?: boolean;
  shareRejectsWith?: { name: string } | null;
}): { deps: SharePdfDeps; rec: Recorder } {
  const rec: Recorder = { fetchCalls: [], shareCalls: [], fileArgs: [] };

  class FakeFile {
    name: string;
    type: string | undefined;
    constructor(_parts: unknown[], name: string, opts?: { type?: string }) {
      this.name = name;
      this.type = opts?.type;
      rec.fileArgs.push({ name, type: opts?.type });
    }
  }

  const nav: Record<string, unknown> = {};
  if (options.hasShare ?? true) {
    nav.share = async (data: { files?: unknown; title?: string }) => {
      rec.shareCalls.push({ files: data.files, title: data.title });
      if (options.shareRejectsWith) {
        const err = new Error("share");
        (err as { name: string }).name = options.shareRejectsWith.name;
        throw err;
      }
    };
  }
  if (options.hasCanShare ?? true) {
    nav.canShare = () => options.canShare ?? true;
  }

  const fetchFn = (async (url: string, init?: RequestInit) => {
    rec.fetchCalls.push({ url, init });
    if (options.fetchThrows) throw new Error("network");
    return {
      ok: options.ok ?? true,
      blob: async () => ({ size: 3 }),
    };
  }) as unknown as typeof fetch;

  const deps: SharePdfDeps = {
    navigator: nav as unknown as SharePdfDeps["navigator"],
    fetch: fetchFn,
    FileCtor: FakeFile as unknown as typeof File,
  };
  return { deps, rec };
}

const input = {
  url: "/api/drivers/due-pdf",
  filename: "comisiones-pendientes-18-Aug-2026.pdf",
  title: "Pending commissions",
};

test("shares the authenticated PDF with same-origin cookies, correct filename and MIME", async () => {
  const { deps, rec } = makeDeps({ canShare: true });
  const outcome = await shareProtectedPdf(input, deps);

  assert.equal(outcome, "shared");
  assert.equal(rec.fetchCalls[0].url, "/api/drivers/due-pdf");
  assert.equal(rec.fetchCalls[0].init?.credentials, "same-origin");
  assert.equal(rec.fileArgs[0].name, input.filename);
  assert.equal(rec.fileArgs[0].type, PDF_MIME);
  assert.equal(rec.shareCalls[0].title, "Pending commissions");
  assert.ok(Array.isArray(rec.shareCalls[0].files));
});

test("missing Web Share support reports unsupported (no fetch attempted)", async () => {
  for (const opts of [{ hasShare: false }, { hasCanShare: false }]) {
    const { deps, rec } = makeDeps(opts);
    const outcome = await shareProtectedPdf(input, deps);
    assert.equal(outcome, "unsupported");
    assert.equal(rec.fetchCalls.length, 0, "should not fetch when sharing is unsupported");
  }

  const undefinedNav = await shareProtectedPdf(input, {
    navigator: undefined,
    fetch: (async () => ({ ok: true })) as unknown as typeof fetch,
    FileCtor: File,
  });
  assert.equal(undefinedNav, "unsupported");
});

test("canShare rejecting the file falls back to unsupported", async () => {
  const { deps } = makeDeps({ canShare: false });
  assert.equal(await shareProtectedPdf(input, deps), "unsupported");
});

test("a cancelled share sheet is reported as cancelled, not an error", async () => {
  const { deps } = makeDeps({ shareRejectsWith: { name: "AbortError" } });
  assert.equal(await shareProtectedPdf(input, deps), "cancelled");
});

test("genuine retrieval/share failures are reported as failed", async () => {
  assert.equal(await shareProtectedPdf(input, makeDeps({ ok: false }).deps), "failed");
  assert.equal(await shareProtectedPdf(input, makeDeps({ fetchThrows: true }).deps), "failed");
  assert.equal(
    await shareProtectedPdf(input, makeDeps({ shareRejectsWith: { name: "NotAllowedError" } }).deps),
    "failed",
  );
});
