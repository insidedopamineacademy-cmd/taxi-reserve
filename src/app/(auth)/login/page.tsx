"use client";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") || "");
    const password = String(form.get("password") || "");

    const res = await signIn("credentials", {
      email,
      password,
      redirect: false, // stay here
    });

    if (res?.ok) {
      // Force rerender of server components that read session + navigate
      router.push("/reservations");
      router.refresh();
    } else {
      setError("Invalid email or password");
      setPending(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-6 text-center">
        <span
          aria-hidden="true"
          className="mx-auto mb-4 inline-flex size-12 items-center justify-center rounded-xl bg-brand text-brand-fg shadow-md"
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M5 11l1.2-3.6A2 2 0 0 1 8.1 6h7.8a2 2 0 0 1 1.9 1.4L19 11m-14 0h14m-14 0a2 2 0 0 0-2 2v3h2m14-5a2 2 0 0 1 2 2v3h-2m-14 0v1.5a1 1 0 0 0 1 1H8a1 1 0 0 0 1-1V16m-4 0h4m6 0v1.5a1 1 0 0 0 1 1h1.5a1 1 0 0 0 1-1V16m-4.5 0h4.5m-9 0h4"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <h1 className="text-xl font-semibold text-white">Welcome back</h1>
        <p className="mt-1 text-sm text-muted">Sign in to your Taxi Reserve account.</p>
      </div>

      <form
        onSubmit={onSubmit}
        className="rounded-2xl border border-app-border bg-surface p-6 shadow-lg"
      >
        <div className="grid gap-4">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-muted">Email</span>
            <input
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              className="h-11 rounded-lg border border-app-border bg-surface-2 px-3 text-[15px] text-white outline-none placeholder:text-subtle focus:border-brand/50 focus:ring-2 focus:ring-brand/25"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-muted">Password</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              className="h-11 rounded-lg border border-app-border bg-surface-2 px-3 text-[15px] text-white outline-none placeholder:text-subtle focus:border-brand/50 focus:ring-2 focus:ring-brand/25"
            />
          </label>

          {error && (
            <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="mt-1 inline-flex h-11 items-center justify-center rounded-lg bg-brand px-4 text-[15px] font-semibold text-brand-fg transition hover:bg-brand-hover disabled:cursor-wait disabled:opacity-70"
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </form>
    </div>
  );
}
