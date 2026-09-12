"use client";

import { useEffect, useRef, useState } from "react";
import { formatMadridDateDisplay, formatMadridTime } from "@/lib/time/madrid";

type Account = { id: string; email: string; name: string | null; status: "ACTIVE" | "INACTIVE"; activeCount: number };
type Device = {
  id: string; userId: string; device: string; browser: string; os: string;
  createdAt: string; lastSeenAt: string; expiresAt: string; revokedAt: string | null;
  ipAddress: string | null; networkCity: string | null; networkRegion: string | null; networkCountry: string | null;
  revokedBy: { email: string } | null; revokeReason: string | null;
};
type SessionData = { users: Account[]; user: { id: string; email: string; name: string | null } | null; sessions: Device[]; currentSessionId: string; now: string };
type Confirmation = { kind: "one"; device: Device; email: string } | { kind: "others"; ids: string[]; userId: string; email: string };

function instant(value: string) {
  const date = new Date(value);
  return `${formatMadridDateDisplay(date)} · ${formatMadridTime(date)}`;
}

function activeLabel(value: string, now: string) {
  const minutes = Math.max(0, Math.floor((new Date(now).getTime() - new Date(value).getTime()) / 60000));
  return minutes < 5 ? "Active now" : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.floor(minutes / 60)} hours ago` : instant(value);
}

function RevokeConfirmation({ confirmation, busy, error, cancel, confirm }: { confirmation: Confirmation; busy: boolean; error: string | null; cancel: () => void; confirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    return () => { element?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={dialog} aria-labelledby="revoke-title" aria-describedby="revoke-description" onCancel={event => { event.preventDefault(); if (!busy) cancel(); }} className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-app-border bg-surface p-6 text-white shadow-xl backdrop:bg-black/70">
    <h2 id="revoke-title" className="text-xl font-semibold">{confirmation.kind === "one" ? "Log out this device?" : `Log out ${confirmation.ids.length} ${confirmation.ids.length === 1 ? "device" : "devices"}?`}</h2>
    <p className="mt-3 break-words text-sm text-white">{confirmation.email}</p>
    {confirmation.kind === "one" && <p className="mt-2 text-sm text-muted">{confirmation.device.device} · {confirmation.device.browser} · {confirmation.device.os}<br />IP: {confirmation.device.ipAddress || "Unavailable"}<br />Last active {instant(confirmation.device.lastSeenAt)}</p>}
    <p id="revoke-description" className="mt-3 text-sm leading-6 text-muted">{confirmation.kind === "one" ? "This device will" : "These devices will"} need to sign in again. Your current device will stay signed in.</p>
    {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    <div className="mt-6 flex flex-wrap justify-end gap-3">
      <button autoFocus type="button" disabled={busy} onClick={cancel} className="min-h-11 rounded-lg border border-app-border px-4 text-sm hover:bg-surface-2 disabled:opacity-60">Cancel</button>
      <button type="button" disabled={busy} onClick={confirm} className="min-h-11 rounded-lg bg-danger px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60">{busy ? "Logging out…" : confirmation.kind === "one" ? "Log out device" : "Log out devices"}</button>
    </div>
  </dialog>;
}

export default function SessionManager({ initialUserId = "" }: { initialUserId?: string }) {
  const [query, setQuery] = useState("");
  const [userId, setUserId] = useState(initialUserId);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const abort = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/admin/sessions?${new URLSearchParams({ query, userId })}`, { cache: "no-store", signal: abort.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not load devices.");
        if (!abort.signal.aborted) setData(result);
      } catch (caught) {
        if (!abort.signal.aborted) setError(caught instanceof Error ? caught.message : "Could not load devices.");
      } finally { if (!abort.signal.aborted) setLoading(false); }
    }, query ? 300 : 0);
    return () => { window.clearTimeout(timer); abort.abort(); };
  }, [query, userId, revision]);

  async function revoke() {
    if (!confirmation || busy) return;
    setBusy(true);
    setConfirmationError(null);
    try {
      const response = await fetch(confirmation.kind === "one" ? `/api/admin/sessions/${confirmation.device.id}/revoke` : "/api/admin/sessions/revoke-others", {
        method: "POST", headers: { "Content-Type": "application/json" },
        ...(confirmation.kind === "others" ? { body: JSON.stringify({ userId: confirmation.userId, expectedIds: confirmation.ids }) } : {}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not log out the device.");
      setConfirmation(null);
      setMessage(result.changed ? `${result.changed} ${result.changed === 1 ? "device logged" : "devices logged"} out.` : "These devices are already signed out.");
      setRevision(value => value + 1);
    } catch (caught) { setConfirmationError(caught instanceof Error ? caught.message : "Could not log out the device."); }
    finally { setBusy(false); }
  }

  const active = data?.sessions.filter(device => !device.revokedAt && device.expiresAt > data.now) ?? [];
  const otherIds = active.filter(device => device.id !== data?.currentSessionId).map(device => device.id);
  const openConfirmation = (value: Confirmation) => { setConfirmationError(null); setConfirmation(value); setMessage(null); };

  return <>
    <div className="mt-6 flex flex-wrap items-end gap-3">
      <label className="min-w-0 flex-1 basis-64"><span className="mb-1.5 block text-sm text-muted">Find a user by name or email</span><input value={query} onChange={event => { setQuery(event.target.value); setUserId(""); }} type="search" maxLength={100} placeholder="Name or email" className="h-11 w-full rounded-lg border border-app-border bg-surface-2 px-3 text-base text-white" /></label>
      <button type="button" disabled={loading} onClick={() => setRevision(value => value + 1)} className="min-h-11 rounded-lg border border-app-border bg-surface px-4 text-sm text-white hover:bg-surface-2 disabled:opacity-60">Refresh devices</button>
    </div>
    {message && <p role="status" className="mt-4 text-sm text-success">{message}</p>}
    {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
    {loading && <p role="status" className="mt-4 text-sm text-muted">Loading devices…</p>}
    <div className="mt-5 grid items-start gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
      <section aria-label="Accounts" className="min-w-0 rounded-xl border border-app-border bg-surface p-3">
        <h2 className="px-2 py-2 text-sm font-semibold text-white">Accounts</h2>
        <ul className="space-y-1">
          {data?.users.map(user => <li key={user.id}><button type="button" onClick={() => setUserId(user.id)} aria-pressed={data.user?.id === user.id} className={`min-h-11 w-full rounded-lg p-3 text-left hover:bg-surface-2 ${data.user?.id === user.id ? "bg-brand/10 ring-1 ring-brand/25" : ""}`}>
            <span className="block break-words text-sm font-medium text-white">{user.name || user.email}</span>
            {user.name && <span className="mt-1 block break-all text-xs text-muted">{user.email}</span>}
            <span className="mt-1 block text-xs text-muted">{user.activeCount} active {user.activeCount === 1 ? "device" : "devices"}</span>
            <span className="mt-1 block text-xs text-subtle">{user.status === "ACTIVE" ? "Active account" : "Inactive account"}</span>
          </button></li>)}
        </ul>
        {!loading && !data?.users.length && <p className="p-2 text-sm text-muted">No matching accounts.</p>}
        {data?.users.length === 50 && <p className="p-2 text-xs text-muted">Showing 50 accounts. Refine the search to find another user.</p>}
      </section>
      <section aria-label="User devices" className="min-w-0">
        {data?.user && <>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0"><h2 className="break-words text-lg font-semibold text-white">{data.user.name || data.user.email}</h2>{data.user.name && <p className="mt-1 break-all text-sm text-muted">{data.user.email}</p>}<p className="mt-1 text-sm font-medium text-white">{active.length} active {active.length === 1 ? "device" : "devices"}</p><p className="mt-1 text-xs text-muted">Device labels are browser estimates.</p></div>
            <button type="button" disabled={otherIds.length === 0 || loading} onClick={() => openConfirmation({ kind: "others", ids: otherIds, userId: data.user!.id, email: data.user!.email })} className="min-h-11 rounded-lg border border-danger/30 px-3 text-sm font-medium text-danger hover:bg-danger/10 disabled:opacity-50">{active.some(device => device.id === data.currentSessionId) ? "Log out all other devices" : "Log out all devices"}</button>
          </div>
          <div className="space-y-3">
            {data.sessions.map(device => {
              const current = device.id === data.currentSessionId;
              const state = device.revokedAt ? "Revoked" : device.expiresAt <= data.now ? "Expired" : "Active";
              const network = [device.networkCity, device.networkRegion, device.networkCountry].filter(Boolean).join(", ");
              return <article key={device.id} data-session-id={device.id} className="rounded-xl border border-app-border bg-surface p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><h3 className="font-semibold text-white">{device.device}</h3><p className="mt-1 text-sm text-muted">{device.browser} · {device.os}</p></div>
                  <div className="flex flex-wrap gap-2 text-xs font-medium">{current && <span className="rounded-full bg-brand/10 px-2.5 py-1 text-brand">THIS DEVICE</span>}<span className={`rounded-full px-2.5 py-1 ${state === "Active" ? "bg-success/10 text-success" : "bg-white/5 text-muted"}`}>{state === "Active" ? activeLabel(device.lastSeenAt, data.now) : state}</span></div>
                </div>
                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                  <div><dt className="text-xs text-subtle">IP address</dt><dd className="mt-1 break-all text-white">{device.ipAddress || "Unavailable"}</dd></div>
                  <div><dt className="text-xs text-subtle">Network estimate</dt><dd className="mt-1 break-words text-white">{network || "Unavailable"}</dd>{network && <dd className="mt-1 text-xs text-muted">Approximate Vercel network metadata</dd>}</div>
                </dl>
                <details className="mt-3 border-t border-app-border pt-2">
                  <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium text-brand">Session details</summary>
                  <dl className="grid gap-3 pb-3 text-sm sm:grid-cols-2">
                    <div><dt className="text-xs text-subtle">Signed in · Madrid</dt><dd className="mt-1 text-white">{instant(device.createdAt)}</dd></div>
                    <div><dt className="text-xs text-subtle">Last active · Madrid</dt><dd className="mt-1 text-white">{instant(device.lastSeenAt)}</dd></div>
                    <div><dt className="text-xs text-subtle">Expires · Madrid</dt><dd className="mt-1 text-white">{instant(device.expiresAt)}</dd></div>
                    {device.revokedAt && <div className="sm:col-span-2"><dt className="text-xs text-subtle">Logged out</dt><dd className="mt-1 break-words text-white">{instant(device.revokedAt)}{device.revokedBy ? ` · ${device.revokedBy.email}` : ""}</dd></div>}
                  </dl>
                </details>
                {state === "Active" && (current ? <p className="mt-2 text-xs text-muted">Use Sign out in your account menu to log out this device.</p> : <button type="button" disabled={loading} onClick={() => openConfirmation({ kind: "one", device, email: data.user!.email })} className="mt-2 min-h-11 rounded-lg border border-danger/30 px-4 text-sm font-medium text-danger hover:bg-danger/10 disabled:opacity-50">Log out device</button>)}
              </article>;
            })}
          </div>
          {data.sessions.length === 0 && <p className="rounded-xl border border-app-border bg-surface p-6 text-sm text-muted">No active or recent sessions for this account.</p>}
          <p className="mt-4 text-xs leading-5 text-subtle">All active sessions and up to 50 recent ended sessions from the last 30 days. IP and network details are removed when a session ends. Activity times are approximate; timestamps use Madrid time.</p>
        </>}
      </section>
    </div>
    {confirmation && <RevokeConfirmation confirmation={confirmation} busy={busy} error={confirmationError} cancel={() => { if (!busy) setConfirmation(null); }} confirm={() => void revoke()} />}
  </>;
}
