"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { LOCATION_RESUME_AFTER_MS, SESSION_POLL_INTERVAL_MS, safeReturnPath } from "@/lib/security/policy";
import { getOnePosition, locationErrorState, queryLocationPermission, type LocationGateState } from "@/lib/security/geolocationClient";

const messages: Record<Exclude<LocationGateState, "ready">, { title: string; detail: string }> = {
  checking: { title: "Checking location access", detail: "Please wait while Taxi Reserve checks this device." },
  prompt: { title: "Location access required", detail: "Allow location access to enter Taxi Reserve. Your last reported location is used for account security and administrator device visibility." },
  locating: { title: "Finding your location", detail: "This may take a few seconds. Confirm the browser's location request if it appears." },
  denied: { title: "Location access is required", detail: "You must allow location access to enter Taxi Reserve. Try again, or enable this site's location permission in your browser settings." },
  blocked: { title: "Location is blocked", detail: "Taxi Reserve cannot request your location because access is blocked for this site. Enable Location for Taxi Reserve in browser/device settings, then return and try again." },
  timeout: { title: "Location request timed out", detail: "We couldn't determine your location. Check Location Services and your connection, then try again." },
  unavailable: { title: "Location is unavailable", detail: "We couldn't determine your location. Check Location Services and your connection, then try again." },
  unsupported: { title: "Location is not supported", detail: "This browser does not provide location access. Open Taxi Reserve in a browser that supports geolocation." },
  insecure: { title: "A secure connection is required", detail: "Open Taxi Reserve using its HTTPS address to enable location access." },
  "server-error": { title: "Location could not be verified", detail: "The security check could not be completed. Check your connection and try again." },
};

export default function LocationBoundary({ sessionId, children }: { sessionId: string; children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<LocationGateState>("checking");
  const [detail, setDetail] = useState<string | null>(null);
  const [guidance, setGuidance] = useState("");
  const retry = useRef<(userInitiated: boolean) => void>(() => {});
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let busy = false;
    let hiddenAt: number | null = null;
    let permission: PermissionStatus | null = null;
    let pollBusy = false;
    let currentState: LocationGateState = "checking";
    const originalFetch = window.fetch;
    const show = (value: LocationGateState) => { currentState = value; if (!disposed) setState(value); };
    const login = () => { show("checking"); window.location.replace("/login?reason=session-ended"); };

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
      const response = await window.fetch("/api/security/location", { method: "DELETE" });
      if (!response.ok) throw new Error("Location access could not be checked. Try again.");
    }

    function permissionChanged() {
      if (permission?.state !== "granted") {
        show(permission?.state === "denied" ? "blocked" : "prompt");
        void invalidate().catch(() => show("server-error"));
      } else if (!busy) void begin(false);
    }

    async function begin(userInitiated: boolean) {
      if (busy || disposed) return;
      busy = true;
      show("checking");
      setDetail(null);
      try {
        await invalidate();
        if (disposed) return;
        if (!window.isSecureContext) { show("insecure"); return; }
        if (!navigator.geolocation) { show("unsupported"); return; }
        if (permission) permission.onchange = null;
        permission = await queryLocationPermission(navigator.permissions);
        if (permission) permission.onchange = permissionChanged;
        if (permission?.state === "denied") { show("blocked"); return; }
        if (permission?.state !== "granted" && !userInitiated) { show("prompt"); return; }
        show("locating");
        let position: GeolocationPosition;
        try { position = await getOnePosition(navigator.geolocation); }
        catch (error) {
          const latest = await queryLocationPermission(navigator.permissions);
          show(locationErrorState(error as GeolocationPositionError, latest?.state));
          return;
        }
        if (disposed) return;
        const latestPermission = await queryLocationPermission(navigator.permissions);
        if (disposed) return;
        if (latestPermission?.state === "denied") { show("blocked"); return; }
        const response = await window.fetch("/api/security/location", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, capturedAt: new Date(position.timestamp).toISOString() }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || "The location check could not be saved.");
        }
        if (disposed) return;
        // Permission can be withdrawn while the server is saving the position.
        // Clear that racing write before allowing the app to mount.
        const savedPermission = await queryLocationPermission(navigator.permissions);
        if (disposed) return;
        if (savedPermission && savedPermission.state !== "granted") {
          await invalidate();
          show(savedPermission.state === "denied" ? "blocked" : "prompt");
          return;
        }
        show("ready");
        if (["/location", "/login", "/register"].includes(window.location.pathname)) router.replace(safeReturnPath(new URLSearchParams(window.location.search).get("next")));
        router.refresh();
      } catch (error) {
        if (!disposed) { setDetail(error instanceof Error ? error.message : null); show("server-error"); }
      } finally { busy = false; }
    }

    async function poll() {
      if (disposed || busy || pollBusy || document.visibilityState === "hidden") return;
      pollBusy = true;
      try {
        const response = await window.fetch("/api/security/session", { cache: "no-store" });
        if (!response.ok) { if (response.status !== 401) show("server-error"); return; }
        const result = await response.json();
        if (result.id !== sessionId) { window.location.reload(); return; }
        if (result.locationRequired && currentState === "ready") void begin(false);
      } catch { show("server-error"); }
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
    const ua = navigator.userAgent;
    setGuidance(/iPhone|iPad|iPod/.test(ua)
      ? "On iPhone or iPad, check Location Services in Settings → Privacy & Security, and the location permission for this website or home-screen app."
      : /Chrome|Chromium|Android/.test(ua) ? "In Chrome, open this site's settings and set Location to Allow. Also check the device's Location Services."
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
          <p className="mt-3 text-sm leading-6 text-muted">{detail ?? message.detail}</p>
          {(state === "blocked" || state === "denied") && <p className="mt-3 text-sm leading-6 text-muted">{guidance}</p>}
        </div>
        <p className="mt-4 text-xs leading-5 text-subtle">Only the latest location is kept for this sign-in. Taxi Reserve does not record a route or continuously track GPS.</p>
        <button type="button" disabled={pending} onClick={() => retry.current(true)} className="mt-6 min-h-11 w-full rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-fg hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand disabled:opacity-60">
          {pending ? "Please wait…" : state === "prompt" ? "Allow location" : "Try again"}
        </button>
        <button type="button" onClick={() => void signOut({ callbackUrl: "/login" })} className="mt-2 min-h-11 w-full rounded-lg px-4 text-sm text-muted hover:text-white focus-visible:outline-2 focus-visible:outline-brand">Sign out</button>
      </section>
    </main>
  );
}
