"use client";

import { assistantPreviewScenarioOptions } from "./fixtures";
import type { AssistantPreviewScenario } from "./types";

type Props = {
  value: AssistantPreviewScenario;
  onChange: (scenario: AssistantPreviewScenario) => void;
};

export function AssistantFixtureControls({ value, onChange }: Props) {
  return (
    <div className="assistant-fixture-controls flex shrink-0 items-center gap-2 border-b border-amber-300/15 bg-amber-300/[0.06] px-3 py-2">
      <label htmlFor="assistant-preview-scenario" className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-amber-200">
        No live data
      </label>
      <select
        id="assistant-preview-scenario"
        value={value}
        onChange={(event) => onChange(event.target.value as AssistantPreviewScenario)}
        className="min-h-9 min-w-0 flex-1 rounded-lg border border-white/10 bg-[#111827] px-2 text-xs text-white outline-none focus:border-amber-300"
      >
        {assistantPreviewScenarioOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
