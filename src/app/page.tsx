// src/app/page.tsx
export const revalidate = 0;

import Link from "next/link";
import { getServerSession } from "next-auth";
import { PdfShareButton } from "@/components/PdfShareButton";
import { authOptions } from "@/lib/auth";
import { getUnreadEmailCountSafely } from "@/lib/emails/database";
import { getEmailInboxAccess } from "@/lib/emails/permissions";
import { buildShareFilename } from "@/lib/pdfShare";
import { formatMadridDateDisplay } from "@/lib/time/madrid";

type TileProps = {
  href: string;
  title: string;
  description?: string;
  icon: React.ReactNode;
  ariaLabel?: string;
};

function Tile({ href, title, description, icon, ariaLabel }: TileProps) {
  // Icon + title only (no description) renders a vertically centered card so it
  // stays visually balanced at the standard card height; cards with a
  // description keep the top-aligned two-line layout.
  const hasDescription = Boolean(description);
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className={`group flex h-full gap-3 rounded-xl border border-app-border bg-surface-2/60 p-4 transition hover:border-app-border-strong hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${hasDescription ? "items-start" : "items-center"}`}
    >
      <span
        aria-hidden="true"
        className={`inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand/12 text-brand ${hasDescription ? "mt-0.5" : ""}`}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block font-medium text-white group-hover:text-brand">
          {title}
        </span>
        {hasDescription ? (
          <span className="mt-1 block text-sm text-muted">{description}</span>
        ) : null}
      </span>
    </Link>
  );
}

function PdfActionCard({
  href,
  title,
  icon,
  openLabel,
  filename,
  shareTitle,
  shareLabel,
}: {
  href: string;
  title: string;
  icon: React.ReactNode;
  openLabel: string;
  filename: string;
  shareTitle: string;
  shareLabel: string;
}) {
  // One coherent card with two distinct, sibling interactive targets: a
  // stretched anchor (open/download the PDF) and a share button — never a
  // button nested inside the anchor.
  return (
    <div className="group relative flex h-full items-start gap-3 rounded-xl border border-app-border bg-surface-2/60 p-4 transition hover:border-app-border-strong hover:bg-surface-2 focus-within:border-app-border-strong">
      <span
        aria-hidden="true"
        className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand/12 text-brand"
      >
        {icon}
      </span>
      <span className="min-w-0">
        <a
          href={href}
          aria-label={openLabel}
          className="rounded font-medium text-white after:absolute after:inset-0 group-hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          {title}
        </a>
      </span>
      <PdfShareButton
        pdfUrl={href}
        filename={filename}
        shareTitle={shareTitle}
        label={shareLabel}
        variant="icon"
        className="absolute bottom-2 right-2 z-10"
      />
    </div>
  );
}

const icons = {
  list: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  ),
  plus: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  users: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11" />
    </svg>
  ),
  file: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8" />
    </svg>
  ),
  fileMoney: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6" />
      <path d="M16 12.5a3.5 3.5 0 1 0 0 5M10.5 14h5M10.5 16h4.5" />
    </svg>
  ),
  mail: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-10 5L2 7" />
    </svg>
  ),
  gear: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  ),
};

export default async function Home() {
  const [inboxAccess, session] = await Promise.all([
    getEmailInboxAccess(),
    getServerSession(authOptions),
  ]);
  const email = inboxAccess.email ?? "";
  const isAdmin = session?.user?.role === "ADMIN";
  const unreadEmails = inboxAccess.allowed
    ? await getUnreadEmailCountSafely()
    : 0;
  const pdfDate = formatMadridDateDisplay(new Date());

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <section className="rounded-2xl border border-app-border bg-surface p-6 shadow-sm sm:p-8">
        <p className="text-sm font-medium text-brand">Taxi Reserve</p>
        <h1 className="mt-1 text-2xl font-semibold text-white">
          {email ? `Welcome back` : "Welcome"}
        </h1>
        <p className="mt-2 text-sm text-muted">
          {email
            ? `Signed in as ${email}. Manage bookings, drivers and finances from one place.`
            : "Manage your taxi reservations, drivers and finances from one place."}
        </p>

        <div className="mt-6 grid auto-rows-fr gap-3 sm:grid-cols-2">
          <Tile
            href="/reservations"
            title="Reservations"
            description="View & manage all bookings."
            icon={icons.list}
          />
          <Tile
            href="/reservations/new"
            title="New reservation"
            description="Create a new booking fast."
            icon={icons.plus}
          />

          {isAdmin ? (
            <>
              <div className="sm:col-span-2">
                <Tile
                  href="/drivers"
                  title="Drivers"
                  description="Manage drivers and ledgers."
                  icon={icons.users}
                />
              </div>
              <div className="grid h-full grid-cols-2 gap-3 sm:col-span-2">
                <PdfActionCard
                  href="/api/drivers/full-ledger-pdf"
                  title="Ledger"
                  icon={icons.file}
                  openLabel="Open Full Ledger PDF (all driver ledgers)"
                  filename={buildShareFilename("full-driver-ledger", pdfDate)}
                  shareTitle="Full driver ledger"
                  shareLabel="Share Full Ledger PDF"
                />
                <PdfActionCard
                  href="/api/drivers/due-pdf"
                  title="Pending"
                  icon={icons.fileMoney}
                  openLabel="Open Pending Commissions PDF (outstanding balances)"
                  filename={buildShareFilename("comisiones-pendientes", pdfDate)}
                  shareTitle="Pending commissions"
                  shareLabel="Share Pending Commissions PDF"
                />
              </div>
            </>
          ) : null}

          {inboxAccess.allowed ? (
            <Tile
              href="/emails"
              title="Inbox"
              description={`${unreadEmails} unread ${unreadEmails === 1 ? "email" : "emails"}.`}
              icon={icons.mail}
            />
          ) : null}

          <Tile
            href={email ? "/settings" : "/login"}
            title={email ? "Settings" : "Login"}
            description={email ? "Account preferences." : "Sign in to your account."}
            icon={icons.gear}
          />
        </div>
      </section>
    </main>
  );
}
