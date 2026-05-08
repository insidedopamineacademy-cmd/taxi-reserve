// src/components/UserMenu.tsx
"use client";

import { useState, useRef, useEffect } from "react";
import { signOut } from "next-auth/react";

export default function UserMenu({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md border border-gray-700 px-3 py-1 hover:bg-gray-800"
      >
        <span className="truncate max-w-[180px] text-sm text-gray-200">{email}</span>
        <svg width="16" height="16" viewBox="0 0 20 20" className={`transition ${open ? "rotate-180" : ""}`}>
          <path fill="currentColor" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.11l3.71-3.88a.75.75 0 0 1 1.08 1.04l-4.25 4.45a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06z"/>
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-56 rounded-lg border border-gray-700 bg-gray-900 shadow-lg overflow-hidden">
          <div className="px-4 py-3 text-xs text-gray-400 border-b border-gray-800">
            Signed in as<br /><span className="text-gray-200">{email}</span>
          </div>
          <ul className="py-1 text-sm">
            <li>
              <a href="/reservations" className="block px-4 py-2 hover:bg-gray-800">My reservations</a>
            </li>
            <li>
              <a href="/settings" className="block px-4 py-2 hover:bg-gray-800">Settings</a>
            </li>
          </ul>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="w-full text-left px-4 py-2 text-red-300 hover:bg-gray-800"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
