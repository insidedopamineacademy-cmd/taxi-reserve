"use client";

import { useEffect } from "react";
import { SESSION_POLL_INTERVAL_MS } from "@/lib/security/policy";

export default function SessionBoundary({ sessionId, children }: { sessionId: string; children: React.ReactNode }) {
  useEffect(() => {
    let disposed = false;
    let pollBusy = false;
    const originalFetch = window.fetch;
    const endSession = () => window.location.replace("/login?reason=session-ended");

    const guardedFetch: typeof window.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.href);
      if (url.origin === window.location.origin && url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/auth/") && response.status === 401) {
        endSession();
      }
      return response;
    };
    window.fetch = guardedFetch;

    async function poll() {
      if (disposed || pollBusy || document.visibilityState === "hidden") return;
      pollBusy = true;
      try {
        const response = await originalFetch("/api/security/session", { cache: "no-store" });
        if (response.status === 401) { endSession(); return; }
        if (!response.ok) return;
        const result = await response.json() as { id?: unknown };
        if (result.id !== sessionId) window.location.reload();
      } catch {
        // A temporary network failure does not invalidate an otherwise valid session.
      } finally {
        pollBusy = false;
      }
    }

    const visibility = () => { if (document.visibilityState === "visible") void poll(); };
    const pageShow = (event: PageTransitionEvent) => { if (event.persisted) void poll(); };
    const interval = window.setInterval(() => void poll(), SESSION_POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pageshow", pageShow);
    void poll();

    return () => {
      disposed = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pageshow", pageShow);
      if (window.fetch === guardedFetch) window.fetch = originalFetch;
    };
  }, [sessionId]);

  return children;
}
