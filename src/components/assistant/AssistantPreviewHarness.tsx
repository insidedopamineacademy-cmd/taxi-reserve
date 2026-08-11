"use client";

import { AssistantLauncher } from "./AssistantLauncher";

export function AssistantPreviewHarness() {
  return (
    <div className="mx-auto min-h-[calc(100vh-3rem)] max-w-6xl px-4 py-10">
      <div className="rounded-2xl border border-amber-300/20 bg-[#0e1426] p-6 shadow-xl">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">Development only</p>
          <h1 className="mt-2 text-2xl font-semibold text-white">Assistant fixture preview</h1>
        </div>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
          This isolated route exercises the Phase 1B shell without authentication, API calls, database access, or live Taxi Reserve data. Use the portrait launcher at the lower right.
        </p>
      </div>
      <AssistantLauncher variant="mobile" />
      <AssistantLauncher variant="desktop" />
    </div>
  );
}
