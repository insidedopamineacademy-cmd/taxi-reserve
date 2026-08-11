"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isAssistantNearBottom } from "./assistantMobile";

export function useAssistantScroll(changeKey: unknown) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  const frameRef = useRef<number | null>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);

  const measure = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const nearBottom = isAssistantNearBottom(
      element.scrollHeight,
      element.scrollTop,
      element.clientHeight
    );
    pinnedRef.current = nearBottom;
    setIsNearBottom(nearBottom);
  }, []);

  const scrollToLatest = useCallback((behavior: ScrollBehavior = "smooth") => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior });
    pinnedRef.current = true;
    setIsNearBottom(true);
  }, []);

  const schedulePinnedScroll = useCallback(() => {
    if (!pinnedRef.current) return;
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      scrollToLatest("auto");
    });
  }, [scrollToLatest]);

  useEffect(() => {
    schedulePinnedScroll();
  }, [changeKey, schedulePinnedScroll]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) schedulePinnedScroll();
      else measure();
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [measure, schedulePinnedScroll]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    },
    []
  );

  return { scrollRef, contentRef, isNearBottom, measure, scrollToLatest };
}
