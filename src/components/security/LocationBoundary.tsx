"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { LOCATION_RESUME_AFTER_MS, SESSION_POLL_INTERVAL_MS, safeReturnPath } from "@/lib/security/policy";
import { getFreshPosition, inspectLocationPermission, locationErrorState, type LocationGateState } from "@/lib/security/geolocationClient";
import { collectLocationRuntimeDiagnostic, isStandaloneWebApp, safeGeolocationError } from "@/lib/security/locationDiagnostics";
import { locationRequestHeaders } from "@/lib/security/locationRequestGuard";

const messages: Record<Exclude<LocationGateState, "ready">, { title: string; detail: string }> = {
  checking: { title: "Checking location access", detail: "Please wait while Taxi Reserve checks this device." },
  prompt: { title: "Location access required", detail: "Allow location access to enter Taxi Reserve. Your latest reported location is used for account security and administrator device visibility." },
  locating: { title: "Finding your location", detail: "This can take several seconds. Confirm the browser's location request if it appears." },
  denied: { title: "Location access is required", detail: "Location access was denied. Allow location access for Taxi Reserve, then try again." },
  blocked: { title: "Location is blocked", detail: "Location access is blocked for Taxi Reserve. Allow it in your device settings, then try again." },
  timeout: { title: "Location verification took too long", detail: "Taxi Reserve could not get a current location in time. Check your connection and try again." },
  unavailable: { title: "Location is temporarily unavailable", detail: "Move to an area with better GPS or network reception, then try again." },
  unsupported: { title: "Location verification is unavailable", detail: "This browser context does not provide location access. Open Taxi Reserve in a browser that supports geolocation." },
  insecure: { title: "Location verification is unavailable", detail: "Open Taxi Reserve using its HTTPS address to enable location access." },
  "server-check-error": { title: "Location security check failed", detail: "Taxi Reserve could not prepare this session for location verification. Check your connection and try again." },
  "server-save-error": { title: "Location could not be saved", detail: "Your browser reported a location, but Taxi Reserve could not save it. Check your connection and try again." },
};

type DevelopmentDiagnostic = { stage: string; data: Record<string, unknown> };

async function safeServerErrorCode(response: Response) {
  const body = await response.clone().json().catch(() => null) as { code?: unknown } | null;
  return typeof body?.code === "string" && /^[A-Z0-9_]{1,64}$/.test(body.code) ? body.code : "UNKNOWN";
}

export default function LocationBoundary({ sessionId, children }: { sessionId: string; children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<LocationGateState>("checking");
  const [guidance, setGuidance] = useState("");
  const [diagnostics, setDiagnostics] = useState<DevelopmentDiagnostic[]>([]);
  const retry = useRef<(userInitiated: boolean) => void>(() => {});
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let busy = false;
    let hiddenAt: number | null = null;
    let permission: PermissionStatus | null = null;
    let permissionRevision = 0;
    let pollBusy = false;
    let currentState: LocationGateState = "checking";
    const originalFetch = window.fetch;
    const show = (value: LocationGateState) => { currentState = value; if (!disposed) setState(value); };
    const login = () => { show("checking"); window.location.replace("/login?reason=session-ended"); };
    const diagnose = (stage: string, data: Record<string, unknown>) => {
      if (process.env.NODE_ENV === "production" || disposed) return;
      const entry = { stage, data };
      console.info("[location-diagnostic]", entry);
      setDiagnostics(previous => [...previous.slice(-7), entry]);
    };

    // Existing feature fetches keep their own payload/error handling. This one
    // shell boundary handles authentication loss or a required location gate.
    const guardedFetch: typeof window.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.href);
      if (url.origin === window.location.origin && url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/auth/")) {
        if (response.status === 401) login();
        else if (response.status === 428) void begin(false);
      }
      return response;
    };
    window.fetch = guardedFetch;

    async function invalidate() {
      try {
        const response = await window.fetch("/api/security/location", {
          method: "DELETE",
          mode: "same-origin",
          credentials: "same-origin",
          cache: "no-store",
          headers: locationRequestHeaders(),
        });
        if (!response.ok) {
          diagnose("session-location-clear-failed", { status: response.status, code: await safeServerErrorCode(response) });
          show("server-check-error");
          return false;
        }
        return true;
      } catch (error) {
        diagnose("session-location-clear-failed", { status: "network-error", errorName: error instanceof Error ? error.name : "UnknownError" });
        show("server-check-error");
        return false;
      }
    }

    function permissionChanged() {
      permissionRevision++;
      diagnose("permission-change", { state: permission?.state ?? "unknown" });
      if (permission?.state === "granted") {
        if (!busy) void begin(false);
        return;
      }
      show(permission?.state === "denied" ? "blocked" : "prompt");
      void invalidate();
    }

    async function begin(userInitiated: boolean) {
      if (busy || disposed) return;
      busy = true;
      show("checking");
      if (userInitiated && process.env.NODE_ENV !== "production") setDiagnostics([]);
      try {
        if (!await invalidate() || disposed) return;
        if (!window.isSecureContext) { show("insecure"); return; }
        if (!navigator.geolocation) { show("unsupported"); return; }

        if (permission) permission.onchange = null;
        const permissionResult = await inspectLocationPermission(navigator.permissions);
        diagnose("permission-query", { outcome: permissionResult.outcome, ...(permissionResult.errorName ? { errorName: permissionResult.errorName } : {}) });
        permission = permissionResult.status;
        if (permission) permission.onchange = permissionChanged;

        // PermissionStatus is advisory on WebKit. A user gesture always reaches
        // getCurrentPosition, whose success/error callback is authoritative.
        if (!userInitiated && permissionResult.outcome !== "granted") {
          show(permissionResult.outcome === "denied" ? "blocked" : "prompt");
          return;
        }

        show("locating");
        let position: GeolocationPosition;
        try {
          position = await getFreshPosition(navigator.geolocation, (error, accuracy) => {
            diagnose("geolocation-error", { accuracy, ...safeGeolocationError(error) });
          });
        } catch (error) {
          const safeError = safeGeolocationError(error as { code?: unknown; message?: unknown });
          show(locationErrorState(safeError, permission?.state));
          return;
        }
        if (disposed) return;
        const permissionRevisionAtCapture = permissionRevision;

        let response: Response;
        try {
          response = await window.fetch("/api/security/location", {
            method: "POST",
            mode: "same-origin",
            credentials: "same-origin",
            cache: "no-store",
            headers: locationRequestHeaders(true),
            body: JSON.stringify({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, capturedAt: new Date(position.timestamp).toISOString() }),
          });
        } catch (error) {
          diagnose("session-location-save-failed", { status: "network-error", errorName: error instanceof Error ? error.name : "UnknownError" });
          show("server-save-error");
          return;
        }
        if (!response.ok) {
          diagnose("session-location-save-failed", { status: response.status, code: await safeServerErrorCode(response) });
          show("server-save-error");
          return;
        }
        if (disposed) return;

        // If the observed permission changed while the write was in flight,
        // conservatively clear the write. A stale Permissions API result never
        // blocks a later user-initiated geolocation attempt.
        if (permissionRevision !== permissionRevisionAtCapture && permission?.state !== "granted") {
          if (!await invalidate()) return;
          show(permission?.state === "denied" ? "blocked" : "prompt");
          return;
        }

        show("ready");
        if (["/location", "/login", "/register"].includes(window.location.pathname)) {
          router.replace(safeReturnPath(new URLSearchParams(window.location.search).get("next")));
        } else {
          router.refresh();
        }
      } finally {
        busy = false;
      }
    }

    async function poll() {
      if (disposed || busy || pollBusy || document.visibilityState === "hidden") return;
      pollBusy = true;
      try {
        const response = await window.fetch("/api/security/session", { cache: "no-store" });
        if (!response.ok) { if (response.status !== 401) show("server-check-error"); return; }
        const result = await response.json();
        if (result.id !== sessionId) { window.location.reload(); return; }
        if (result.locationRequired && currentState === "ready") void begin(false);
      } catch { show("server-check-error"); }
      finally { pollBusy = false; }
    }

    const visibility = () => {
      if (document.visibilityState === "hidden") hiddenAt = Date.now();
      else {
        if (hiddenAt !== null && Date.now() - hiddenAt >= LOCATION_RESUME_AFTER_MS) void begin(false);
        else void poll();
        hiddenAt = null;
      }
    };
    const pageHide = () => { if (content.current) content.current.hidden = true; };
    const pageShow = (event: PageTransitionEvent) => { if (event.persisted) { show("checking"); void begin(false); } };
    const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
    const standalone = isStandaloneWebApp(navigatorWithStandalone, query => window.matchMedia(query));
    const runtime = collectLocationRuntimeDiagnostic(window, navigatorWithStandalone, document);
    diagnose("runtime", runtime as unknown as Record<string, unknown>);
    setGuidance(runtime.platform.startsWith("iOS")
      ? `On iPhone or iPad, open Settings → Privacy & Security → Location Services, select the entry that requested location for Taxi Reserve, choose While Using the App, and keep Precise Location on.${standalone ? " Home Screen web apps can have a permission context separate from the Safari tab." : ""}`
      : runtime.platform.includes("Chrome") ? "In Chrome, open this site's settings and set Location to Allow. Also check the device's Location Services."
      : "Check this website's location permission and your device's Location Services.");
    retry.current = userInitiated => { void begin(userInitiated); };
    void begin(false);
    const timer = window.setInterval(() => void poll(), SESSION_POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pageshow", pageShow);
    window.addEventListener("pagehide", pageHide);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pageshow", pageShow);
      window.removeEventListener("pagehide", pageHide);
      if (permission) permission.onchange = null;
      if (window.fetch === guardedFetch) window.fetch = originalFetch;
    };
  }, [sessionId, router]);

  if (state === "ready") return <div ref={content}>{children}</div>;
  const message = messages[state];
  const pending = state === "checking" || state === "locating";
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10" aria-labelledby="location-heading">
      <section className="w-full max-w-md rounded-2xl border border-app-border bg-surface p-6 shadow-lg sm:p-8">
        <p className="text-sm font-semibold text-brand">Taxi Reserve</p>
        <div className="mt-6" role="status" aria-live="polite">
          <h1 id="location-heading" className="text-2xl font-semibold text-white">{message.title}</h1>
          <p className="mt-3 text-sm leading-6 text-muted">{message.detail}</p>
          {(state === "blocked" || state === "denied") && <p className="mt-3 text-sm leading-6 text-muted">{guidance}</p>}
        </div>
        <p className="mt-4 text-xs leading-5 text-subtle">Only the latest location is kept for this sign-in. Taxi Reserve does not record a route or continuously track GPS.</p>
        {process.env.NODE_ENV !== "production" && diagnostics.length > 0 && (
          <details className="mt-4 rounded-lg border border-app-border p-3 text-xs text-muted">
            <summary className="cursor-pointer font-semibold">Development diagnostics</summary>
            <pre className="mt-2 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify(diagnostics, null, 2)}</pre>
          </details>
        )}
        <button type="button" disabled={pending} onClick={() => retry.current(true)} className="mt-6 min-h-11 w-full rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-fg hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand disabled:opacity-60">
          {pending ? "Please wait…" : state === "prompt" ? "Allow location" : "Try again"}
        </button>
        <button type="button" onClick={() => void signOut({ callbackUrl: "/login" })} className="mt-2 min-h-11 w-full rounded-lg px-4 text-sm text-muted hover:text-white focus-visible:outline-2 focus-visible:outline-brand">Sign out</button>
      </section>
    </main>
  );
}
