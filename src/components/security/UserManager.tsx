"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatLocalInstantDateDisplay } from "@/lib/dateDisplay";
import { securityRequestHeaders } from "@/lib/security/securityRequestGuard";

type ManagedUser = {
  id: string;
  name: string | null;
  email: string;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "INACTIVE";
  createdAt: string;
  activeSessions: number;
  canChangePassword: boolean;
  canDeactivate: boolean;
  canReactivate: boolean;
};

type UserData = { currentUserId: string; users: ManagedUser[] };
type DialogState =
  | { kind: "create" }
  | { kind: "password"; user: ManagedUser }
  | { kind: "deactivate"; user: ManagedUser };

const fieldClass = "h-11 w-full rounded-lg border border-app-border bg-surface-2 px-3 text-base text-white outline-none placeholder:text-subtle focus:border-brand/50 focus:ring-2 focus:ring-brand/25";

function ManagedDialog({ state, busy, error, close, refresh }: {
  state: DialogState;
  busy: boolean;
  error: string | null;
  close: () => void;
  refresh: (message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const locked = busy || submitting;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); previous?.focus(); };
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) return;
    setSubmitting(true);
    setSubmitError(null);
    const form = new FormData(event.currentTarget);
    const endpoint = state.kind === "create"
      ? "/api/admin/users"
      : state.kind === "password"
        ? `/api/admin/users/${state.user.id}/password`
        : `/api/admin/users/${state.user.id}/status`;
    const body = state.kind === "create"
      ? { name: form.get("name"), email: form.get("email"), password: form.get("password"), confirmPassword: form.get("confirmPassword") }
      : state.kind === "password"
        ? { password: form.get("password"), confirmPassword: form.get("confirmPassword") }
        : { active: false };
    try {
      const response = await fetch(endpoint, { method: "POST", headers: securityRequestHeaders(), body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not update the user.");
      refresh(state.kind === "create" ? "Worker account created." : state.kind === "password" ? "Password changed and active devices logged out." : "User deactivated. Historical records were preserved.");
    } catch (caught) {
      setSubmitError(caught instanceof Error ? caught.message : "Could not update the user.");
      setSubmitting(false);
    }
  }

  const title = state.kind === "create" ? "Create user" : state.kind === "password" ? "Change password" : `Deactivate ${state.user.name || state.user.email}?`;
  return (
    <dialog ref={dialog} aria-labelledby="managed-user-dialog-title" onCancel={event => { event.preventDefault(); if (!locked) close(); }} className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl border border-app-border bg-surface p-5 text-white shadow-xl backdrop:bg-black/70 sm:p-6">
      <h2 id="managed-user-dialog-title" className="text-xl font-semibold">{title}</h2>
      {state.kind !== "create" && <p className="mt-2 break-all text-sm text-muted">{state.user.email}</p>}
      {state.kind === "deactivate" && <p className="mt-4 text-sm leading-6 text-muted">This prevents new logins and logs out active devices. Historical reservations, activity and finance references will be preserved.</p>}
      <form onSubmit={event => void submit(event)} className="mt-5 grid gap-4" data-managed-user-form>
        {state.kind === "create" && <>
          <label><span className="mb-1.5 block text-sm text-muted">Name</span><input name="name" required maxLength={100} autoComplete="off" className={fieldClass} /></label>
          <label><span className="mb-1.5 block text-sm text-muted">Email</span><input name="email" required type="email" autoComplete="off" className={fieldClass} /></label>
        </>}
        {(state.kind === "create" || state.kind === "password") && <>
          <label><span className="mb-1.5 block text-sm text-muted">{state.kind === "create" ? "Initial password" : "New password"}</span><input name="password" required type="password" minLength={8} maxLength={128} autoComplete="new-password" className={fieldClass} /></label>
          <label><span className="mb-1.5 block text-sm text-muted">Confirm password</span><input name="confirmPassword" required type="password" minLength={8} maxLength={128} autoComplete="new-password" className={fieldClass} /></label>
        </>}
        {(submitError || error) && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{submitError || error}</p>}
        <div className="flex flex-wrap justify-end gap-3 pt-1">
          <button type="button" disabled={locked} onClick={close} className="min-h-11 rounded-lg border border-app-border px-4 text-sm hover:bg-surface-2 disabled:opacity-60">Cancel</button>
          <button type="submit" disabled={locked} className={`min-h-11 rounded-lg px-4 text-sm font-semibold disabled:opacity-60 ${state.kind === "deactivate" ? "bg-danger text-white" : "bg-brand text-brand-fg"}`}>{locked ? "Saving…" : state.kind === "create" ? "Create user" : state.kind === "password" ? "Change password" : "Deactivate"}</button>
        </div>
      </form>
    </dialog>
  );
}

export default function UserManager() {
  const router = useRouter();
  const [data, setData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dialogState, setDialogState] = useState<DialogState | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch("/api/admin/users", { cache: "no-store" }).then(async response => {
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (result.code === "SETTINGS_LOCKED") router.push("/settings?next=%2Fadmin%2Fusers");
        throw new Error(result.error || "Could not load users.");
      }
      if (active) setData(result);
    }).catch(caught => { if (active) setError(caught instanceof Error ? caught.message : "Could not load users."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision, router]);

  async function completeDialog(successMessage: string) {
    setMessage(successMessage);
    setDialogState(null);
    setDialogError(null);
    setBusy(false);
    setRevision(value => value + 1);
  }

  async function reactivate(user: ManagedUser) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/users/${user.id}/status`, { method: "POST", headers: securityRequestHeaders(), body: JSON.stringify({ active: true }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not reactivate the user.");
      setMessage("User reactivated. They can sign in with their current password.");
      setRevision(value => value + 1);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not reactivate the user."); }
    finally { setBusy(false); }
  }

  return <>
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted">{data ? `${data.users.length} accounts` : "Worker accounts"}</p>
      <button type="button" onClick={() => { setDialogError(null); setDialogState({ kind: "create" }); }} className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-brand-fg hover:bg-brand-hover">Create user</button>
    </div>
    {message && <p role="status" className="mt-4 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">{message}</p>}
    {error && <p role="alert" className="mt-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}</p>}
    {loading && <p role="status" className="mt-5 text-sm text-muted">Loading users…</p>}
    <ul className="mt-5 grid gap-3">
      {data?.users.map(user => <li key={user.id} className="min-w-0 rounded-xl border border-app-border bg-surface p-4 sm:p-5">
        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="break-words font-semibold text-white">{user.name || "Unnamed user"}</p>
            <p className="mt-1 break-all text-sm text-muted">{user.email}</p>
            <p className="mt-2 text-xs font-medium text-subtle">{user.role} · {user.status}</p>
            <p className="mt-1 text-xs text-subtle">Created {formatLocalInstantDateDisplay(new Date(user.createdAt))} · {user.activeSessions} active {user.activeSessions === 1 ? "device" : "devices"}</p>
          </div>
          <div className="flex flex-wrap gap-2 sm:max-w-[28rem] sm:justify-end">
            {user.canChangePassword && <button type="button" onClick={() => { setDialogError(null); setDialogState({ kind: "password", user }); }} className="min-h-11 rounded-lg border border-app-border px-3 text-sm text-white hover:bg-surface-2">Change password</button>}
            <Link href={`/admin/sessions?userId=${encodeURIComponent(user.id)}`} className="inline-flex min-h-11 items-center rounded-lg border border-app-border px-3 text-sm text-white hover:bg-surface-2">View sessions</Link>
            {user.canDeactivate && <button type="button" onClick={() => { setDialogError(null); setDialogState({ kind: "deactivate", user }); }} className="min-h-11 rounded-lg border border-danger/30 px-3 text-sm text-danger hover:bg-danger/10">Deactivate</button>}
            {user.canReactivate && <button type="button" disabled={busy} onClick={() => void reactivate(user)} className="min-h-11 rounded-lg border border-success/30 px-3 text-sm text-success hover:bg-success/10 disabled:opacity-60">Reactivate</button>}
          </div>
        </div>
        {user.id === data.currentUserId && <p className="mt-3 text-xs text-brand">Current administrator account</p>}
      </li>)}
    </ul>
    {!loading && data?.users.length === 0 && <p className="mt-5 rounded-xl border border-app-border bg-surface p-6 text-sm text-muted">No users found.</p>}
    {dialogState && <ManagedDialog
      state={dialogState}
      busy={busy}
      error={dialogError}
      close={() => { if (!busy) setDialogState(null); }}
      refresh={message => { setBusy(true); void completeDialog(message); }}
    />}
  </>;
}
