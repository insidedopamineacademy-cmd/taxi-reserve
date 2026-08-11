import type { AssistantRequestState } from "./types";

export const ASSISTANT_NEAR_BOTTOM_PX = 80;
export const ASSISTANT_TEXTAREA_MAX_PX = 160;
export const ASSISTANT_TEXTAREA_MIN_PX = 44;

export function isAssistantBusy(state: AssistantRequestState) {
  return state === "submitting" || state === "generating";
}

export function canSubmitAssistantDraft(
  draft: string,
  state: AssistantRequestState,
  transportEnabled: boolean
) {
  return transportEnabled && draft.trim().length > 0 && !isAssistantBusy(state);
}

type SubmissionGuardInput = {
  draft: string;
  state: AssistantRequestState;
  transportEnabled: boolean;
  submissionLocked: boolean;
  lastAcceptedDraft: string | null;
};

export function canAcceptAssistantSubmission({
  draft,
  state,
  transportEnabled,
  submissionLocked,
  lastAcceptedDraft,
}: SubmissionGuardInput) {
  const normalizedDraft = draft.trim();
  return (
    canSubmitAssistantDraft(normalizedDraft, state, transportEnabled) &&
    !submissionLocked &&
    normalizedDraft !== lastAcceptedDraft
  );
}

type ComposerKeyInput = {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  keyCode: number;
  coarsePointer: boolean;
};

export function shouldSubmitAssistantKey({
  key,
  shiftKey,
  isComposing,
  keyCode,
  coarsePointer,
}: ComposerKeyInput) {
  return (
    key === "Enter" &&
    !shiftKey &&
    !isComposing &&
    keyCode !== 229 &&
    !coarsePointer
  );
}

export function getAssistantTextareaSizing(scrollHeight: number, viewportHeight: number) {
  const safeViewportHeight = Number.isFinite(viewportHeight) && viewportHeight > 0
    ? viewportHeight
    : 720;
  const maxHeight = Math.max(
    ASSISTANT_TEXTAREA_MIN_PX,
    Math.min(ASSISTANT_TEXTAREA_MAX_PX, safeViewportHeight * 0.3)
  );
  const safeScrollHeight = Number.isFinite(scrollHeight) && scrollHeight > 0
    ? scrollHeight
    : ASSISTANT_TEXTAREA_MIN_PX;
  const height = Math.min(Math.max(ASSISTANT_TEXTAREA_MIN_PX, safeScrollHeight), maxHeight);

  return {
    height,
    maxHeight,
    shouldScroll: safeScrollHeight > maxHeight,
  };
}

export function isAssistantNearBottom(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  threshold = ASSISTANT_NEAR_BOTTOM_PX
) {
  return scrollHeight - scrollTop - clientHeight <= threshold;
}

export type AssistantViewportSample = {
  fallbackHeight: number;
  fallbackWidth: number;
  visualHeight?: number;
  visualWidth?: number;
  visualOffsetTop?: number;
  visualOffsetLeft?: number;
  activeTextInput: boolean;
};

function positiveOrFallback(value: number | undefined, fallback: number) {
  return Number.isFinite(value) && (value ?? 0) > 0 ? (value as number) : fallback;
}

function nonNegativeOrZero(value: number | undefined) {
  return Number.isFinite(value) && (value ?? 0) >= 0 ? (value as number) : 0;
}

export function getAssistantViewportMetrics(sample: AssistantViewportSample) {
  const fallbackHeight = positiveOrFallback(sample.fallbackHeight, 1);
  const fallbackWidth = positiveOrFallback(sample.fallbackWidth, 1);
  const visualHeight = positiveOrFallback(sample.visualHeight, fallbackHeight);
  const visualWidth = positiveOrFallback(sample.visualWidth, fallbackWidth);
  const offsetTop = nonNegativeOrZero(sample.visualOffsetTop);
  const offsetLeft = nonNegativeOrZero(sample.visualOffsetLeft);
  const hasUsableVisualViewport =
    Number.isFinite(sample.visualHeight) &&
    (sample.visualHeight ?? 0) > 0 &&
    Number.isFinite(sample.visualWidth) &&
    (sample.visualWidth ?? 0) > 0;
  const bottomOcclusion = Math.max(0, fallbackHeight - (visualHeight + offsetTop));

  return {
    height: visualHeight,
    width: visualWidth,
    offsetTop,
    offsetLeft,
    keyboardVisible:
      hasUsableVisualViewport && sample.activeTextInput && bottomOcclusion > 1,
    source: hasUsableVisualViewport ? ("visual" as const) : ("fallback" as const),
  };
}
