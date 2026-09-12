"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { securityRequestHeaders } from "@/lib/security/securityRequestGuard";

type GateStatus = {
  configured: boolean;
  unlocked: boolean;
  unlockedUntil: string | null;
  lockedUntil: string | null;
};

const inputClass = "h-11 w-full rounded-lg border border-app-border bg-surface-2 px-3 text-[16px] text-white outline-none placeholder:text-subtle focus:border-brand/50 focus:ring-2 focus:ring-brand/25";

function ProtectedSettingsGate({ status, reload }: { status: GateStatus; reload: () => void }) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const action = status.configured ? "unlock" : "setup";
      const response = await fetch("/api/admin/security-gate", {
        method: "POST",
        headers: securityRequestHeaders(),
        body: JSON.stringify(action === "unlock" ? { action, pin } : { action, currentPassword, pin, confirmPin }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not unlock protected settings.");
      const destination = new URLSearchParams(window.location.search).get("next");
      if (destination?.startsWith("/admin")) {
        router.push(destination);
        router.refresh();
      } else {
        reload();
        router.refresh();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not unlock protected settings.");
      setPending(false);
      reload();
    }
  }

  return (
    <section aria-labelledby="protected-settings-title" className="rounded-2xl border border-brand/25 bg-surface p-5 shadow-sm sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">Protected Settings</p>
      <h2 id="protected-settings-title" className="mt-2 text-lg font-semibold text-white">{status.configured ? "Enter security PIN" : "Set Settings PIN"}</h2>
      <p className="mt-2 text-sm leading-6 text-muted">{status.configured ? "Unlock password management and Administration for 10 minutes on this device." : "Create a 6–8 digit PIN. Confirm your current account password to protect setup on an already unlocked device."}</p>
      <form onSubmit={submit} className="mt-5 grid gap-4">
        {!status.configured && <label><span className="mb-1.5 block text-sm font-medium text-muted">Current account password</span><input type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required className={inputClass} /></label>}
        <label><span className="mb-1.5 block text-sm font-medium text-muted">Security PIN</span><input aria-label="Security PIN" type="password" inputMode="numeric" pattern="[0-9]{6,8}" minLength={6} maxLength={8} autoComplete="off" value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, "").slice(0, 8))} required className={`${inputClass} tracking-[0.35em]`} /></label>
        {!status.configured && <label><span className="mb-1.5 block text-sm font-medium text-muted">Confirm security PIN</span><input type="password" inputMode="numeric" pattern="[0-9]{6,8}" minLength={6} maxLength={8} autoComplete="off" value={confirmPin} onChange={event => setConfirmPin(event.target.value.replace(/\D/g, "").slice(0, 8))} required className={`${inputClass} tracking-[0.35em]`} /></label>}
        {status.lockedUntil && <p className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">Too many incorrect attempts. Try again after {new Date(status.lockedUntil).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}.</p>}
        {error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}</p>}
        <button type="submit" disabled={pending || Boolean(status.lockedUntil)} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-5 text-[15px] font-semibold text-brand-fg hover:bg-brand-hover disabled:cursor-wait disabled:opacity-60">{pending ? "Checking…" : status.configured ? "Unlock" : "Set PIN and unlock"}</button>
      </form>
    </section>
  );
}

function SensitiveSettings({ admin, onAdminPasswordChanged }: { admin: boolean; onAdminPasswordChanged: () => void }) {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setMsg(null);
    setPending(true);
    const response = await fetch("/api/user/change-password", { method: "POST", headers: securityRequestHeaders(), body: JSON.stringify(form) });
    const result = await response.json().catch(() => ({}));
    if (response.ok) {
      setMsg({ ok: true, text: "Password changed successfully. Other devices were signed out." });
      setForm({ currentPassword: "", newPassword: "" });
      if (admin) onAdminPasswordChanged();
    } else {
      setMsg({ ok: false, text: result.error || "Failed to change password." });
    }
    setPending(false);
  }

  return <>
    <section className="rounded-2xl border border-app-border bg-surface p-5 shadow-sm sm:p-6">
      <h2 className="text-base font-semibold text-white">Change password</h2>
      <p className="mt-1 text-sm text-muted">Use at least 8 characters. This device stays signed in; other devices are signed out.</p>
      <form onSubmit={submit} className="mt-5 grid gap-4">
        <label><span className="mb-1.5 block text-sm font-medium text-muted">Current password</span><input type="password" autoComplete="current-password" value={form.currentPassword} onChange={event => setForm({ ...form, currentPassword: event.target.value })} required className={inputClass} /></label>
        <label><span className="mb-1.5 block text-sm font-medium text-muted">New password</span><input type="password" minLength={8} maxLength={128} autoComplete="new-password" value={form.newPassword} onChange={event => setForm({ ...form, newPassword: event.target.value })} required className={inputClass} /></label>
        {msg && <p role={msg.ok ? "status" : "alert"} className={`rounded-lg border p-3 text-sm ${msg.ok ? "border-success/30 bg-success/10 text-success" : "border-danger/30 bg-danger/10 text-danger"}`}>{msg.text}</p>}
        <div className="flex justify-end"><button type="submit" disabled={pending} className="inline-flex min-h-11 items-center rounded-lg bg-brand px-5 text-[15px] font-semibold text-brand-fg hover:bg-brand-hover disabled:opacity-60">{pending ? "Saving…" : "Change password"}</button></div>
      </form>
    </section>
    {admin && <section aria-labelledby="admin-settings-heading" className="mt-6 rounded-2xl border border-app-border bg-surface p-5 shadow-sm sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">Admin</p>
      <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><h2 id="admin-settings-heading" className="text-base font-semibold text-white">Administration</h2><p className="mt-1 text-sm text-muted">Manage users, devices and security.</p></div><Link href="/admin" className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-brand px-4 text-sm font-semibold text-brand-fg hover:bg-brand-hover">Open Admin</Link></div>
    </section>}
  </>;
}

export default function SettingsPage() {
  const { data: session, status: sessionStatus } = useSession();
  const [gate, setGate] = useState<GateStatus | null>(null);
  const [gateError, setGateError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const isAdmin = session?.user?.role === "ADMIN";

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    fetch("/api/admin/security-gate", { cache: "no-store" }).then(async response => {
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not check protected settings.");
      if (active) { setGate(result); setGateError(null); }
    }).catch(caught => { if (active) setGateError(caught instanceof Error ? caught.message : "Could not check protected settings."); });
    return () => { active = false; };
  }, [isAdmin, revision]);

  useEffect(() => {
    if (!gate?.unlockedUntil) return;
    const delay = Math.max(0, new Date(gate.unlockedUntil).getTime() - Date.now() + 50);
    const timer = window.setTimeout(() => setRevision(value => value + 1), delay);
    return () => window.clearTimeout(timer);
  }, [gate?.unlockedUntil]);

  async function lock() {
    await fetch("/api/admin/security-gate", { method: "POST", headers: securityRequestHeaders(), body: JSON.stringify({ action: "lock" }) });
    setRevision(value => value + 1);
  }

  return <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
    <div className="mb-6"><h1 className="text-2xl font-semibold text-white">Settings</h1><p className="mt-1 text-sm text-muted">Manage account and administrative security.</p></div>
    {sessionStatus === "loading" || (isAdmin && !gate && !gateError) ? <p role="status" className="text-sm text-muted">Loading protected settings…</p> : null}
    {gateError ? <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{gateError}</p> : null}
    {isAdmin && gate && !gate.unlocked ? <ProtectedSettingsGate status={gate} reload={() => setRevision(value => value + 1)} /> : null}
    {(!isAdmin && sessionStatus === "authenticated") || (isAdmin && gate?.unlocked) ? <>
      {isAdmin && <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-success/25 bg-success/[0.06] p-3"><p className="text-sm text-success">Protected Settings unlocked for this device.</p><button type="button" onClick={() => void lock()} className="min-h-11 rounded-lg border border-app-border px-3 text-sm text-white hover:bg-surface-2">Lock Settings</button></div>}
      <SensitiveSettings admin={Boolean(isAdmin)} onAdminPasswordChanged={() => setRevision(value => value + 1)} />
    </> : null}
  </main>;
}
