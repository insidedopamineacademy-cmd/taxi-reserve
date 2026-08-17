"use client";
import { useState } from "react";

export default function SettingsPage() {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setPending(true);
    const res = await fetch("/api/user/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      setMsg({ ok: true, text: "Password changed successfully." });
      setForm({ currentPassword: "", newPassword: "" });
    } else {
      setMsg({
        ok: false,
        text: (await res.json()).error || "Failed to change password.",
      });
    }
    setPending(false);
  }

  const inputClass =
    "h-11 rounded-lg border border-app-border bg-surface-2 px-3 text-[15px] text-white outline-none placeholder:text-subtle focus:border-brand/50 focus:ring-2 focus:ring-brand/25";

  return (
    <main className="mx-auto max-w-lg px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Settings</h1>
        <p className="mt-1 text-sm text-muted">Manage your account security.</p>
      </div>

      <section className="rounded-2xl border border-app-border bg-surface p-6 shadow-sm">
        <h2 className="text-base font-semibold text-white">Change password</h2>
        <p className="mt-1 text-sm text-muted">
          Use at least 8 characters. You&apos;ll stay signed in after changing it.
        </p>

        <form onSubmit={submit} className="mt-5 grid gap-4">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-muted">Current password</span>
            <input
              type="password"
              autoComplete="current-password"
              placeholder="Current password"
              value={form.currentPassword}
              onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
              className={inputClass}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-muted">New password</span>
            <input
              type="password"
              autoComplete="new-password"
              placeholder="New password (min 8 chars)"
              value={form.newPassword}
              onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
              className={inputClass}
            />
          </label>

          {msg && (
            <p
              className={
                msg.ok
                  ? "rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success"
                  : "rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
              }
            >
              {msg.text}
            </p>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={pending}
              className="inline-flex h-11 items-center justify-center rounded-lg bg-brand px-5 text-[15px] font-semibold text-brand-fg transition hover:bg-brand-hover disabled:cursor-wait disabled:opacity-70"
            >
              {pending ? "Saving…" : "Change password"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
