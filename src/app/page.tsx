// src/app/page.tsx
export const revalidate = 0;

import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export default async function Home() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email ?? "";

  return (
    <main className="mx-auto max-w-3xl p-6">
      <section className="rounded-2xl border border-white/10 bg-[#0e1426] p-6">
        <h1 className="text-2xl font-semibold text-white">
          {email ? `Welcome, ${email}` : "Welcome to AppReserve"}
        </h1>
        <p className="mt-2 text-sm text-neutral-300">
          Manage your taxi reservations from one place.
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Link
            href="/reservations"
            className="rounded-lg border border-white/10 bg-black/30 p-4 hover:border-white/20"
          >
            <h3 className="font-medium text-white">Reservations</h3>
            <p className="mt-1 text-sm text-neutral-300">
              View & manage all bookings.
            </p>
          </Link>

          <Link
            href="/reservations/new"
            className="rounded-lg border border-white/10 bg-black/30 p-4 hover:border-white/20"
          >
            <h3 className="font-medium text-white">New reservation</h3>
            <p className="mt-1 text-sm text-neutral-300">
              Create a new booking fast.
            </p>
          </Link>

          <Link
            href={email ? "/settings" : "/login"}
            className="rounded-lg border border-white/10 bg-black/30 p-4 hover:border-white/20"
          >
            <h3 className="font-medium text-white">
              {email ? "Settings" : "Login"}
            </h3>
            <p className="mt-1 text-sm text-neutral-300">
              {email ? "Account preferences." : "Sign in to your account."}
            </p>
          </Link>
        </div>
      </section>
    </main>
  );
}
