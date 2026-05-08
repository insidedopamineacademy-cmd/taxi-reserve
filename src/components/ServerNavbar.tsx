"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import UserMenu from "./UserMenu";

export default function ServerNavbar() {
  const { data: session } = useSession();
  const user = session?.user;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => setOpen(false);
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  return (
    <nav className="sticky top-0 z-50 w-full bg-[#0b1324] text-white shadow-md">
      <div className="mx-auto max-w-6xl px-4 h-12 flex items-center justify-between">
        <Link href="/" className="text-xl font-semibold hover:text-yellow-400">
          AppReserve
        </Link>

        {/* Desktop Menu */}
        <div className="hidden sm:flex items-center gap-6">
          <Link href="/reservations" className="hover:text-yellow-400">Reservations</Link>
          <Link href="/reservations/new" className="hover:text-yellow-400">New</Link>
          <Link href="/reservations/deleted" className="hover:text-yellow-400">Deleted</Link>

          {user ? (
            <UserMenu email={user.email ?? "Account"} />
          ) : (
            <div className="flex items-center gap-4">
              <Link href="/login" className="hover:text-yellow-400">Login</Link>
              <Link
                href="/register"
                className="bg-yellow-500 text-black px-3 py-1 rounded-md hover:bg-yellow-400 transition"
              >
                Register
              </Link>
            </div>
          )}
        </div>

        {/* Mobile Menu Toggle */}
        <button className="sm:hidden" onClick={() => setOpen(v => !v)} aria-label="Menu">
          ☰
        </button>
      </div>

      {/* Mobile Dropdown */}
      {open && (
        <div className="sm:hidden border-t border-white/10 px-4 pb-3">
          <div className="flex flex-col gap-3 pt-3">
            <Link href="/reservations" onClick={() => setOpen(false)}>Reservations</Link>
            <Link href="/reservations/new" onClick={() => setOpen(false)}>New</Link>
            <Link href="/reservations/deleted" onClick={() => setOpen(false)}>Deleted</Link>

            {user ? (
              <UserMenu email={user.email ?? "Account"} />
            ) : (
              <div className="flex flex-col gap-3">
                <Link href="/login" onClick={() => setOpen(false)}>Login</Link>
                <Link
                  href="/register"
                  onClick={() => setOpen(false)}
                  className="bg-yellow-500 text-black px-3 py-1 rounded-md hover:bg-yellow-400 transition text-center"
                >
                  Register
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
