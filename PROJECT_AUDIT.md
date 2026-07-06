# Taxi Reserve — Project Audit and Handoff

Last audited: 2026-07-06

## Project name and purpose

Taxi Reserve (branded as `AppReserve` in parts of the UI) is an authenticated taxi-booking operations app. Users create, view, filter, edit, soft-delete, restore, and permanently delete their own reservations. Approved users can also use a shared email inbox and reply workflow.

## Tech stack

- Next.js 15 App Router, React 19, and TypeScript
- Tailwind CSS 4 plus global CSS in `src/app/globals.css` and `src/app/mobile.css`
- NextAuth 4 credentials authentication with JWT sessions
- Prisma 6 with Neon/PostgreSQL through `DATABASE_URL`
- `bcryptjs`/`bcrypt` for password verification and hashing
- IMAPFlow and Mailparser for inbox synchronization
- Nodemailer-compatible SMTP transport for replies
- Vercel-compatible deployment; Node.js runtime is explicitly used for database and mail routes

## Repository structure

```text
src/
  app/
    (auth)/                 Login and registration pages
    api/                    Auth, reservation, user, admin, and email endpoints
    emails/                 Inbox list and thread detail pages
    activity-log/           Protected, server-rendered activity history
    reservations/           Active, new, edit, deleted, and server-action flows
    settings/               Password-change UI
    globals.css             Global theme and native-control hardening
    mobile.css              Mobile reservation layout styles
    layout.tsx              Root layout, providers, and server navbar
  components/
    emails/                 Inbox state, sync, message, read, and reply UI
    PhoneActions.tsx        Call, WhatsApp, and copy actions
    ReservationsList.tsx    Primary responsive reservation list UI
    NavbarClient.tsx        Desktop/mobile navigation
  lib/
    emails/                 IMAP/SMTP configuration, sync, send, health, and helpers
    auth.ts                 NextAuth credentials and JWT configuration
    activityLog.ts          Best-effort structured activity writer
    parseStartAt.ts         Local-wall-time/UTC conversion and date display helpers
    phoneActions.ts         Phone normalization for call and WhatsApp links
    prisma.ts               Shared Prisma client
    reservationStatus.ts    Reservation status mapping
prisma/
  schema.prisma             Production PostgreSQL data model (protected)
  migrations/               Database migration history (protected)
public/                     Static assets
next.config.ts              Next.js configuration and response security headers
src/middleware.ts           Route-level NextAuth protection
```

## Main routes and pages

| Route | Purpose | Access |
| --- | --- | --- |
| `/` | Dashboard links and unread inbox count | Public shell; content adapts to session/inbox access |
| `/login` | Credentials sign-in | Public |
| `/register` | Account registration | Public |
| `/reservations` | Current user's active reservations, search, sort, status, phone, edit, and delete actions | Authenticated |
| `/reservations/new` | Create a reservation | Authenticated by middleware and API session check |
| `/reservations/[id]/edit` | Edit one owned, non-deleted reservation | Authenticated and ownership-checked |
| `/reservations/deleted` | Restore or permanently clear the current user's deleted reservations | Authenticated |
| `/emails` | Foldered, searchable shared inbox with manual sync | Authenticated and email allowlisted |
| `/emails/[threadId]` | Thread history, mark-read behavior, and reply composer | Authenticated and email allowlisted |
| `/settings` | Change the signed-in user's password | Authenticated |
| `/admin` | User-count/list view | Admin role |
| `/activity-log` | Searchable, filterable activity history | Authenticated; own rows for users, all rows for admins |

## Main components

- `ServerNavbar` resolves the session/inbox permission; `NavbarClient` renders desktop and mobile navigation.
- `ReservationsList` is the primary responsive reservation UI. It handles client search/sort state, expandable details, phone actions, sharing, optimistic soft delete/restore, and status updates.
- `ReservationsFilters` contains reusable status/date-range filters. Its native date inputs are covered by the global iOS control rules even if the component is mounted in a future screen.
- `EditReservationForm` owns the edit UI and uses `datetime-local` values before submitting UTC dates to the existing API.
- `PhoneActions` normalizes a displayed phone number and exposes `tel:`, WhatsApp, and clipboard actions with an accessible status announcement.
- Email UI components cover configuration/setup states, manual synchronization, progress, sanitized message display, mark-read, and reply composition.

## API routes

| Method and route | Responsibility |
| --- | --- |
| `GET/POST /api/auth/[...nextauth]` | NextAuth credentials/session endpoints |
| `POST /api/register` | Validate and create a user with a hashed password |
| `POST /api/user/change-password` | Verify the current password and store a new hash |
| `GET/DELETE /api/admin` | Return user count/list to admins; the DELETE handler is deliberately disabled with HTTP 405 |
| `GET /api/dev/make-due` | Disabled development endpoint |
| `POST /api/reservations` | Validate and create an owned reservation |
| `PATCH /api/reservations/[id]` | Update an owned, active reservation |
| `DELETE /api/reservations/[id]` | Soft-delete an owned reservation |
| `POST /api/reservations/bulk-delete` | Soft-delete up to the endpoint limit for the current user |
| `PATCH /api/reservations/[id]/restore` | Restore an owned soft-deleted reservation |
| `DELETE /api/reservations/deleted/permanent-delete-all` | Permanently delete all soft-deleted reservations owned by the current user |
| `GET /api/emails/config-check` | Check allowlisted inbox setup and mail connection health |
| `POST /api/emails/sync` | Run allowlisted IMAP synchronization |
| `POST /api/emails/send` | Send and persist an allowlisted thread reply |
| `POST /api/emails/threads/[threadId]/read` | Mark a thread read for an allowlisted inbox user |

## Authentication and authorization

- NextAuth uses the Credentials provider and JWT sessions. `src/lib/auth.ts` looks up a normalized email, compares a password hash, and copies the database role into the JWT and session.
- `src/middleware.ts` sends unauthenticated users to `/login` for reservation, email, settings, and admin pages; `/admin` additionally requires the `ADMIN` token role.
- Sensitive pages and APIs also perform server-side session checks. Reservation reads and writes are scoped to `session.user.email`; the edit page verifies ownership and excludes deleted records.
- `/activity-log` repeats authorization at query time: normal users are constrained to their normalized session email and only admins receive an unscoped query.
- Inbox access requires both authentication and membership in `EMAIL_INBOX_ALLOWED_USERS`.
- Do not weaken the server-side checks in favor of middleware-only authorization.

## Activity logging

- The additive `ActivityLog` model stores an action, entity type, optional entity ID, normalized user email, optional structured JSON metadata, and creation time. Individual indexes support the primary audit filters.
- `src/lib/activityLog.ts` is deliberately best-effort. It catches and reports database failures so logging cannot turn a successful reservation or authentication action into an application error.
- Tracked actions are `reservation_created`, `reservation_updated`, `reservation_deleted`, `user_registered`, `user_login`, `user_logout`, `admin_login`, and `admin_viewed_users`.
- Reservation metadata records only operational summaries such as changed field names, status, passenger count, deletion type/count, restore context, or view context. Authentication metadata is limited to role where applicable.
- Passwords, password hashes, credentials, auth secrets, tokens, session payloads, phone numbers, reservation notes, and address text are not copied into activity metadata.
- The app has no dedicated reservation-details route. The edit page can be prefetched and reservation-card expansion is client-only, so `reservation_viewed` is intentionally not emitted. Client-only phone copying is also not logged.
- Admin user deletion remains disabled by the existing API, so `admin_deleted_user` is not emitted.

## Reservation data flow

1. The create form collects a local date and time, combines them as local wall time, and uses `localDateTimeToUtcIso` before calling `POST /api/reservations`.
2. The API validates the request, reads the authenticated email, and creates a reservation owned by that email.
3. The reservations page queries only active records for the authenticated email, serializes dates to epoch milliseconds, and passes them to `ReservationsList`.
4. The edit page queries one owned active record. The client form displays local `datetime-local` values and submits JavaScript `Date` values to the existing PATCH endpoint.
5. Delete is normally a soft delete (`isDeleted`). Deleted records can be restored or permanently removed through explicit, user-scoped actions.

Timezone conversion in `src/lib/parseStartAt.ts` and `EditReservationForm.tsx` is operationally sensitive. UI-only changes must not alter parsing, offsets, serialization, or database date handling.

## Email and inbox synchronization

- Inbox access is a server-side email allowlist.
- IMAP sync discovers and classifies Inbox, Sent, Spam, Archive, and Trash folders, then stores thread/message state in PostgreSQL. Sync-state rows track mailbox UID progress.
- The UI supports folder browsing, search, unread filtering, manual sync/progress, thread reading, and replies.
- SMTP replies preserve thread headers, send through the configured account, and persist an outgoing message plus thread metadata in a transaction.
- HTML message content is sanitized before rendering. Health/configuration checks avoid exposing mail credentials.
- Email schema readiness is checked before inbox reads. Do not bypass it or alter sync/archive classification without explicit approval and dedicated regression testing.

## Phone actions

- `normalizePhoneForActions` preserves a trimmed display value and derives digit-only call/WhatsApp targets.
- `PhoneActions` provides Call (`tel:`), WhatsApp (`https://wa.me/` with `noopener noreferrer`), and Copy actions.
- Phone actions appear in reservation details and on the edit form. The reservation sharing flow can also build a WhatsApp message containing booking details.

## Environment variables

Never commit real values. Configure production secrets in the deployment platform.

| Variable | Requirement |
| --- | --- |
| `DATABASE_URL` | Required PostgreSQL/Neon connection string used by Prisma |
| `NEXTAUTH_SECRET` or `AUTH_SECRET` | Required stable production secret for NextAuth JWT/session signing |
| `NEXTAUTH_URL` | Recommended canonical application URL for self-hosted/production NextAuth deployments |
| `IMAP_HOST`, `IMAP_PORT`, `IMAP_USER`, `IMAP_PASSWORD` | Required together for inbox synchronization |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` | Required together for replies and SMTP health checks |
| `EMAIL_INBOX_ALLOWED_USERS` | Required comma-separated allowlist to expose inbox features |
| `EMAIL_INITIAL_SYNC_LIMIT` | Optional positive integer; defaults to 100 and is capped at 5,000 |

`.env.example` currently documents the mail settings only. Local `.env*` files are ignored; verify database/auth settings separately when onboarding.

## Deployment notes

- Run `npm install`, `npm run lint`, and `npm run build` before release.
- The install lifecycle runs `prisma generate`; it does not authorize a migration.
- Deploy with a supported Node.js runtime and configure all required environment variables in every target environment.
- `npm run start` binds Next.js to port 3001; `npm run dev` uses the normal Next.js development default unless a port is supplied.
- Database/mail routes require Node.js rather than an Edge-only runtime.
- Apply migrations only through an explicitly approved, backed-up release procedure. Never point local experiments at production Neon/Postgres.
- Response headers in `next.config.ts` deny framing, prevent MIME sniffing, use a conservative referrer policy, and disable camera/microphone/geolocation. CSP is intentionally deferred until it can be tested against Next.js, NextAuth, and inbox behavior.

## Known protected areas

- Prisma schema and generated assumptions
- Activity-log migration history, write helper, and per-user/admin query boundaries
- Migration files and migration history
- Neon/PostgreSQL production data
- Local-time to UTC conversion and date serialization
- Reservation create/read/update/delete, ownership, soft-delete, restore, and permanent-delete behavior
- NextAuth credentials, JWT/session callbacks, middleware, and server-side authorization checks
- Email sync state, folder/archive classification, message threading, outgoing persistence, and allowed-user enforcement

## Known risks

- Public registration has no application-level rate limiting or invitation gate; deployment-level abuse controls should be considered without changing auth semantics casually.
- Login and password-change endpoints also rely on platform/network controls for brute-force protection.
- Middleware improves navigation protection but must never be treated as the only authorization boundary; retain page/API session and ownership checks.
- A strict Content Security Policy is not yet enabled. Add one only after testing framework scripts, NextAuth, inbox HTML rendering, and all interactive flows.
- Email synchronization depends on provider folder naming/special-use flags and on the email tables matching application expectations.
- Permanent deletion is irreversible by design; the endpoint is user-scoped but should remain prominently confirmed in UI and operational procedures.
- Date/time behavior depends on browser local time. iOS display hardening must remain CSS-only unless timezone work is separately approved.
- Dependency security updates require routine review and full regression testing; do not combine them with data-model changes.

## QA checklist

- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `git diff --check`
- [ ] On a real iPhone/iOS Safari, confirm date, time, and `datetime-local` controls are at least 44px high, left-aligned, unclipped, and retain a visible picker indicator.
- [ ] Check both portrait and landscape layouts at narrow widths.
- [ ] Open and close the mobile navigation; confirm every link and the user menu remain aligned and usable.
- [ ] Test reservation date filters wherever `ReservationsFilters` is mounted; clear dates and verify query parameters.
- [ ] Create a reservation and verify the displayed local time matches the entered local wall time.
- [ ] Edit start/end values and verify save, reload, and display without a time shift.
- [ ] Search, sort, change status, soft-delete, restore, and confirm permanent-delete warnings using non-production test data.
- [ ] Verify Call, WhatsApp, and Copy on an iPhone and desktop browser.
- [ ] Sign in, refresh an authenticated route, sign out, and verify protected-route redirects; verify admin and inbox access restrictions.
- [ ] Verify `/activity-log` search, entity filter, sorting, responsive cards, user ownership scoping, and admin-wide visibility.
- [ ] Confirm logged actions contain no credentials, tokens, phone numbers, notes, or address text.
- [ ] If inbox is configured, browse folders, search, sync, open a thread, mark it read, and send a test reply from a non-production mailbox.
- [ ] Inspect production responses for the configured security headers.

## Do not touch without explicit approval

Do not modify, regenerate, reset, rename, delete, migrate, or reinterpret any of the following without explicit approval and a dedicated backup/test plan:

1. `prisma/schema.prisma`, `prisma/migrations/**`, or live Neon/PostgreSQL data.
2. Reservation CRUD, ownership filters, soft-delete/restore/permanent-delete semantics, or persisted field types.
3. Timezone conversion, `Date` parsing, UTC serialization, or date-range boundary behavior.
4. NextAuth credentials, secrets, JWT/session role propagation, middleware matchers, or server-side auth checks.
5. Email sync state, folder/archive/trash classification, threading headers, allowlist checks, or reply persistence.
6. Existing user, reservation, reminder, or email data.
