"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import UserMenu from "./UserMenu";
import { AssistantLauncher } from "./assistant/AssistantLauncher";

type Props = {
  userEmail: string | null;
  canAccessInbox: boolean;
  isAdmin: boolean;
  assistantEnabled: boolean;
};

type NavItem = {
  href: string;
  label: string;
  match: (pathname: string) => boolean;
};

const exact = (href: string) => (pathname: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

function buildNavItems(isAdmin: boolean, canAccessInbox: boolean): NavItem[] {
  const items: NavItem[] = [
    {
      href: "/reservations",
      label: "Reservations",
      // Active for a reservation and its detail/edit, but not New / Deleted.
      match: (p) =>
        p === "/reservations" ||
        (p.startsWith("/reservations/") &&
          !p.startsWith("/reservations/new") &&
          !p.startsWith("/reservations/deleted")),
    },
  ];

  if (isAdmin) {
    items.push(
      { href: "/drivers/overview", label: "Overview", match: exact("/drivers/overview") },
      {
        href: "/drivers",
        label: "Drivers",
        match: (p) =>
          p === "/drivers" ||
          (p.startsWith("/drivers/") && !p.startsWith("/drivers/overview")),
      },
      { href: "/commissions", label: "Commissions", match: exact("/commissions") },
      { href: "/payments", label: "Payments", match: exact("/payments") },
    );
  }

  if (canAccessInbox) {
    items.push({ href: "/emails", label: "Inbox", match: exact("/emails") });
  }

  items.push(
    { href: "/reservations/new", label: "New", match: exact("/reservations/new") },
    { href: "/reservations/deleted", label: "Deleted", match: exact("/reservations/deleted") },
  );

  return items;
}

function BrandMark() {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-fg shadow-sm"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M5 11l1.2-3.6A2 2 0 0 1 8.1 6h7.8a2 2 0 0 1 1.9 1.4L19 11m-14 0h14m-14 0a2 2 0 0 0-2 2v3h2m14-5a2 2 0 0 1 2 2v3h-2m-14 0v1.5a1 1 0 0 0 1 1H8a1 1 0 0 0 1-1V16m-4 0h4m6 0v1.5a1 1 0 0 0 1 1h1.5a1 1 0 0 0 1-1V16m-4.5 0h4.5m-9 0h4"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export default function NavbarClient({ userEmail, canAccessInbox, isAdmin, assistantEnabled }: Props) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() || "";

  useEffect(() => {
    const handler = () => setOpen(false);
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  const navItems = buildNavItems(isAdmin, canAccessInbox);

  const mobileMenuButton = (
    <button
      type="button"
      className="inline-flex size-11 items-center justify-center rounded-lg text-2xl text-white/90 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand lg:hidden"
      onClick={() => setOpen((value) => !value)}
      aria-label="Toggle navigation menu"
      aria-expanded={open}
      aria-controls="mobile-navigation"
    >
      ☰
    </button>
  );

  return (
    <>
      <nav className="sticky top-0 z-50 w-full border-b border-white/10 bg-nav text-white shadow-[0_1px_0_0_rgba(255,255,255,0.04),0_8px_24px_-12px_rgba(0,0,0,0.6)] backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link
            href="/"
            className="flex items-center gap-2.5 rounded-lg py-1 pr-2 font-semibold tracking-tight text-white"
          >
            <BrandMark />
            <span className="text-[15px]">
              Taxi<span className="text-brand"> Reserve</span>
            </span>
          </Link>

          <div className="hidden items-center gap-1 lg:flex">
            {navItems.map((item) => {
              const active = item.match(pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={
                    active
                      ? "rounded-lg bg-white/[0.08] px-3 py-1.5 text-sm font-medium text-white shadow-[inset_0_-2px_0_0_var(--brand)]"
                      : "rounded-lg px-3 py-1.5 text-sm font-medium text-white/70 hover:bg-white/[0.05] hover:text-white"
                  }
                >
                  {item.label}
                </Link>
              );
            })}

            {userEmail ? (
              <div className="ml-1 flex items-center gap-1 border-l border-white/10 pl-2">
                <Link
                  href="/activity-log"
                  aria-current={pathname.startsWith("/activity-log") ? "page" : undefined}
                  className={
                    pathname.startsWith("/activity-log")
                      ? "rounded-lg bg-white/[0.08] px-3 py-1.5 text-sm font-medium text-white shadow-[inset_0_-2px_0_0_var(--brand)]"
                      : "rounded-lg px-3 py-1.5 text-sm font-medium text-white/70 hover:bg-white/[0.05] hover:text-white"
                  }
                >
                  Activity
                </Link>
                <UserMenu email={userEmail} />
              </div>
            ) : (
              <div className="ml-1 flex items-center gap-2 border-l border-white/10 pl-3">
                <Link
                  href="/login"
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-white/70 hover:bg-white/[0.05] hover:text-white"
                >
                  Login
                </Link>
                <Link
                  href="/register"
                  className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-brand-fg transition hover:bg-brand-hover"
                >
                  Register
                </Link>
              </div>
            )}
          </div>

          {mobileMenuButton}
        </div>

        {open ? (
          <div id="mobile-navigation" className="border-t border-white/10 px-3 pb-3 lg:hidden">
            <div className="flex flex-col gap-1 pt-2">
              {navItems.map((item) => {
                const active = item.match(pathname);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={
                      active
                        ? "flex min-h-11 items-center rounded-lg border-l-2 border-brand bg-white/[0.07] px-3 text-[15px] font-medium text-white"
                        : "flex min-h-11 items-center rounded-lg border-l-2 border-transparent px-3 text-[15px] font-medium text-white/75 hover:bg-white/[0.05] hover:text-white"
                    }
                  >
                    {item.label}
                  </Link>
                );
              })}

              {userEmail ? (
                <>
                  <Link
                    href="/activity-log"
                    onClick={() => setOpen(false)}
                    aria-current={pathname.startsWith("/activity-log") ? "page" : undefined}
                    className={
                      pathname.startsWith("/activity-log")
                        ? "flex min-h-11 items-center rounded-lg border-l-2 border-brand bg-white/[0.07] px-3 text-[15px] font-medium text-white"
                        : "flex min-h-11 items-center rounded-lg border-l-2 border-transparent px-3 text-[15px] font-medium text-white/75 hover:bg-white/[0.05] hover:text-white"
                    }
                  >
                    Activity Log
                  </Link>
                  <div className="mt-1 border-t border-white/10 pt-2">
                    <UserMenu email={userEmail} />
                  </div>
                </>
              ) : (
                <div className="mt-1 flex flex-col gap-2 border-t border-white/10 pt-3">
                  <Link
                    href="/login"
                    onClick={() => setOpen(false)}
                    className="flex min-h-11 items-center rounded-lg px-3 text-[15px] font-medium text-white/80 hover:bg-white/5"
                  >
                    Login
                  </Link>
                  <Link
                    href="/register"
                    onClick={() => setOpen(false)}
                    className="flex min-h-11 items-center justify-center rounded-lg bg-brand px-3 text-[15px] font-semibold text-brand-fg transition hover:bg-brand-hover"
                  >
                    Register
                  </Link>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </nav>

      {assistantEnabled ? (
        <>
          <AssistantLauncher variant="mobile" onBeforeOpen={() => setOpen(false)} />
          <AssistantLauncher variant="desktop" />
        </>
      ) : null}
    </>
  );
}
