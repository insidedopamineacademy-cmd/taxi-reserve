import assert from "node:assert/strict";
import test from "node:test";
import {
  canAcceptAssistantSubmission,
  canSubmitAssistantDraft,
  getAssistantTextareaSizing,
  getAssistantViewportMetrics,
  isAssistantNearBottom,
  shouldSubmitAssistantKey,
} from "../src/components/assistant/assistantMobile.ts";

test("viewport metrics use visual viewport dimensions and offsets when valid", () => {
  assert.deepEqual(
    getAssistantViewportMetrics({
      fallbackHeight: 844,
      fallbackWidth: 390,
      visualHeight: 508,
      visualWidth: 390,
      visualOffsetTop: 12,
      visualOffsetLeft: 0,
      activeTextInput: true,
    }),
    {
      height: 508,
      width: 390,
      offsetTop: 12,
      offsetLeft: 0,
      keyboardVisible: true,
      source: "visual",
    }
  );
});

test("viewport metrics safely fall back when visual viewport values are stale", () => {
  assert.deepEqual(
    getAssistantViewportMetrics({
      fallbackHeight: 667,
      fallbackWidth: 375,
      visualHeight: 0,
      visualWidth: Number.NaN,
      visualOffsetTop: -10,
      activeTextInput: true,
    }),
    {
      height: 667,
      width: 375,
      offsetTop: 0,
      offsetLeft: 0,
      keyboardVisible: false,
      source: "fallback",
    }
  );
});

test("a reduced viewport is not treated as a keyboard without active text input", () => {
  const metrics = getAssistantViewportMetrics({
    fallbackHeight: 844,
    fallbackWidth: 390,
    visualHeight: 700,
    visualWidth: 390,
    activeTextInput: false,
  });
  assert.equal(metrics.keyboardVisible, false);
});

test("textarea sizing is compact, capped, and scrollable after the cap", () => {
  assert.deepEqual(getAssistantTextareaSizing(24, 844), {
    height: 44,
    maxHeight: 160,
    shouldScroll: false,
  });
  assert.deepEqual(getAssistantTextareaSizing(900, 360), {
    height: 108,
    maxHeight: 108,
    shouldScroll: true,
  });
});

test("near-bottom detection honors the 80px follow threshold", () => {
  assert.equal(isAssistantNearBottom(1000, 520, 400), true);
  assert.equal(isAssistantNearBottom(1000, 519, 400), false);
});

test("blank, busy, locked, and already accepted drafts cannot submit", () => {
  assert.equal(canSubmitAssistantDraft("   ", "idle", true), false);
  assert.equal(canSubmitAssistantDraft("hello", "generating", true), false);
  assert.equal(
    canAcceptAssistantSubmission({
      draft: "hello",
      state: "idle",
      transportEnabled: true,
      submissionLocked: true,
      lastAcceptedDraft: null,
    }),
    false
  );
  assert.equal(
    canAcceptAssistantSubmission({
      draft: " hello ",
      state: "idle",
      transportEnabled: true,
      submissionLocked: false,
      lastAcceptedDraft: "hello",
    }),
    false
  );
});

test("Enter submits only for non-composing fine-pointer input", () => {
  const base = {
    key: "Enter",
    shiftKey: false,
    isComposing: false,
    keyCode: 13,
    coarsePointer: false,
  };
  assert.equal(shouldSubmitAssistantKey(base), true);
  assert.equal(shouldSubmitAssistantKey({ ...base, shiftKey: true }), false);
  assert.equal(shouldSubmitAssistantKey({ ...base, isComposing: true }), false);
  assert.equal(shouldSubmitAssistantKey({ ...base, keyCode: 229 }), false);
  assert.equal(shouldSubmitAssistantKey({ ...base, coarsePointer: true }), false);
});
