"use client";

import { useEffect, type RefObject } from "react";
import { getAssistantViewportMetrics } from "./assistantMobile";

const viewportProperties = [
  "--assistant-viewport-height",
  "--assistant-viewport-width",
  "--assistant-viewport-offset-top",
  "--assistant-viewport-offset-left",
] as const;

function isTextEntryElement(element: Element | null) {
  return (
    element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLInputElement &&
      !["button", "checkbox", "radio", "submit"].includes(element.type)) ||
    (element instanceof HTMLElement && element.isContentEditable)
  );
}

function resetViewportEnhancement(dialog: HTMLDialogElement) {
  for (const property of viewportProperties) dialog.style.removeProperty(property);
  dialog.dataset.keyboardVisible = "false";
}

function roundViewportValue(value: number) {
  return Math.round(value * 100) / 100;
}

export function useAssistantViewport(dialogRef: RefObject<HTMLDialogElement | null>) {
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const visualViewport = window.visualViewport;
    let frame = 0;

    const measure = () => {
      frame = 0;
      if (!visualViewport) {
        resetViewportEnhancement(dialog);
        return;
      }

      const activeElement = document.activeElement;
      const metrics = getAssistantViewportMetrics({
        fallbackHeight: window.innerHeight || document.documentElement.clientHeight,
        fallbackWidth: window.innerWidth || document.documentElement.clientWidth,
        visualHeight: visualViewport.height,
        visualWidth: visualViewport.width,
        visualOffsetTop: visualViewport.offsetTop,
        visualOffsetLeft: visualViewport.offsetLeft,
        activeTextInput: dialog.contains(activeElement) && isTextEntryElement(activeElement),
      });

      if (metrics.source === "fallback") {
        resetViewportEnhancement(dialog);
        return;
      }

      dialog.style.setProperty(
        "--assistant-viewport-height",
        `${roundViewportValue(metrics.height)}px`
      );
      dialog.style.setProperty(
        "--assistant-viewport-width",
        `${roundViewportValue(metrics.width)}px`
      );
      dialog.style.setProperty(
        "--assistant-viewport-offset-top",
        `${roundViewportValue(metrics.offsetTop)}px`
      );
      dialog.style.setProperty(
        "--assistant-viewport-offset-left",
        `${roundViewportValue(metrics.offsetLeft)}px`
      );
      dialog.dataset.keyboardVisible = String(metrics.keyboardVisible);
    };

    const scheduleMeasure = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(measure);
    };

    const handleOrientationChange = () => {
      resetViewportEnhancement(dialog);
      scheduleMeasure();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") scheduleMeasure();
    };

    scheduleMeasure();
    visualViewport?.addEventListener("resize", scheduleMeasure);
    visualViewport?.addEventListener("scroll", scheduleMeasure);
    window.addEventListener("resize", scheduleMeasure);
    window.addEventListener("orientationchange", handleOrientationChange);
    window.addEventListener("pageshow", scheduleMeasure);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("focusin", scheduleMeasure);
    document.addEventListener("focusout", scheduleMeasure);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      visualViewport?.removeEventListener("resize", scheduleMeasure);
      visualViewport?.removeEventListener("scroll", scheduleMeasure);
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("orientationchange", handleOrientationChange);
      window.removeEventListener("pageshow", scheduleMeasure);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      document.removeEventListener("focusin", scheduleMeasure);
      document.removeEventListener("focusout", scheduleMeasure);
      resetViewportEnhancement(dialog);
    };
  }, [dialogRef]);
}
