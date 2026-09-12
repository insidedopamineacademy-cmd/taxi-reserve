# Device-session security and location-removal report

Date: 12 September 2026

## Current architecture found

Taxi Reserve uses NextAuth 4 Credentials with bcrypt password verification and an
encrypted JWT cookie. It does not use a NextAuth database adapter. Every successful
Credentials authentication transaction creates a PostgreSQL `DeviceSession`, puts
its random UUID in the encrypted JWT as `sid`, and writes exactly one `user_login`
ActivityLog row. The transaction locks and rechecks the User password hash so a
concurrent password change cannot admit a login verified against the old hash.

Every decoded application token is checked against the DeviceSession registry. The
record must exist, belong to the token subject, be unrevoked and be before its
absolute 30-day expiry. The current User email, name and role are reloaded from the
database. Missing, malformed, legacy-without-`sid`, expired, revoked and
owner-mismatched tokens fail closed. The five-minute `lastSeenAt` predicate prevents
normal parallel requests from writing on every request.

The previous implementation combined this useful registry with a mandatory
browser-location gate. Location was enforced independently in the NextAuth session
callback, Node middleware, ADMIN session mutations and password change. A root
`LocationBoundary` also called the Permissions and Geolocation APIs, submitted GPS
coordinates and repeated verification on resume. Those parts have now been removed.

## Location functionality removed

Valid registered sessions now reach authorized pages, APIs, server actions and the
assistant immediately. The application no longer has a `/location` page or
`/api/security/location` route. It performs no browser permission query, no
`navigator.geolocation` call, no GPS submission, no freshness check, no resume
location check, no `/location` redirect and no location-specific HTTP 428 response.
`Permissions-Policy` is `camera=(), microphone=(), geolocation=()`.

The former client boundary is replaced by a session-only boundary. It checks the
registered session once per minute while visible, on persisted-page/app resume, and
after protected same-origin APIs return 401. It never asks for device permission.
A temporary network failure leaves the valid local UI intact; server authorization
still fails closed on each protected request.

Removed runtime files:

- `src/components/security/LocationBoundary.tsx`
- `src/lib/security/geolocationClient.ts`
- `src/lib/security/locationDiagnostics.ts`
- `src/lib/security/locationRequestGuard.ts`
- `src/app/location/page.tsx`
- `src/app/api/security/location/route.ts`

## Retained device-session behavior

Every fresh login inserts a new independent DeviceSession. No lookup attempts to
match or resurrect an old session by IP, user agent, device, browser or account.
Revocation only marks the chosen session ID. A browser revoked as Session A may
authenticate again as Session B with identical metadata. There is no device, IP,
browser, user-agent or account blacklist.

The session records retain creation, last-active, absolute expiry, revocation time,
revoking user, reason, bounded raw user agent, parsed device/browser/OS, trusted IP,
and optional Vercel network fields. Device labels are best-effort user-agent
categories such as iPhone/Safari/iOS or Mac/Chrome/macOS; they do not identify a
specific handset and no fingerprint is built.

IP and approximate city/region/country values are accepted only from existing
Vercel-controlled headers when `VERCEL=1`. Generic client-supplied forwarding
headers are not trusted. The values are display/audit context only and never affect
login, authorization, revocation or expiry. No external IP-geolocation service is
used.

The ADMIN `/admin/sessions` page searches users and shows the selected user's name,
email, obvious count of active non-revoked non-expired sessions, device/browser/OS,
IP/network estimate, login time, last-active time, expiry and `THIS DEVICE`. It does
not select or render GPS coordinates, accuracy, capture time or verification time.
Recently ended sessions remain visible separately in the same list with private
network values suppressed.

Individual ADMIN revocation is transactional: it marks the target, records the
actor and reason, clears private session metadata, and writes one audit. The current
ADMIN session cannot be revoked through this action; normal Sign out revokes it.
Counted bulk revocation requires confirmation and rejects a stale target list. For
the current account it excludes the actor; for another selected account it revokes
all active sessions. USER sessions cannot enumerate or mutate global session data.

Changing a password retains the current valid session and transactionally revokes
all other active sessions. Normal logout revokes only the current session. Original
LOGIN ActivityLog rows survive revocation, logout and eventual DeviceSession row
deletion.

## LOGIN audit contract

One new DeviceSession and one `user_login` ActivityLog row commit in the same
transaction. The immutable login snapshot contains the event type, canonical user
ID/email/role, safe session ID, login time, parsed device/browser/OS, trusted IP and
optional network labels. It excludes the password/hash, cookie, JWT, auth secret,
full user agent and GPS. Refresh, route navigation, app reopen, foreground polling,
last-seen updates, revocation and logout do not add or replace LOGIN rows. A second
real authentication creates a second session and second independent LOGIN row.

Failed credential attempts are not added to ActivityLog. The public Credentials
callback has no bounded security-event store or abuse-rate contract, and adding
unbounded attacker-controlled attempted-email rows would expand privacy and abuse
scope. Successful-login history remains separate and precise.

## Cleanup and data retention

The Vercel cron at `/api/admin/sessions/cleanup` remains scheduled daily at 04:10
UTC and uses the existing `CRON_SECRET` authorization. Revoked or expired rows have
IP, network and raw-user-agent values scrubbed. While the legacy nullable GPS
columns exist, the same privacy cleanup nulls any coordinates that an older
deployment may have written. Rows ended more than 30 days ago are deleted; minimal
ActivityLog history remains.

## Prisma and migration impact

No schema change or migration is created by location removal. Local code expects the
existing additive migration:

`prisma/migrations/20260906090000_device_sessions_location/migration.sql`

That migration creates the DeviceSession registry and also contains nullable
`latitude`, `longitude`, `accuracy`, `locationCapturedAt` and
`locationVerifiedAt` columns. The columns remain nullable and unused by new
sessions. Dropping them would be destructive, so it is deferred to a separately
reviewed cleanup migration. The current application does not expose them or use
them for authorization.

Production was manually rolled back, so its database state cannot be inferred from
the local Git history or an earlier operator report. Before application deployment,
inspect the production `_prisma_migrations` table and actual `DeviceSession` table.
If `20260906090000_device_sessions_location` is absent, review and apply that
existing additive migration before deploying code that requires the table. Do not
use `migrate reset`, `db push`, or `migrate dev` against production.

Existing pre-registry JWT cookies have no `sid` and continue to fail closed.
Deploying the DeviceSession architecture therefore requires every user with an old
stateless cookie to log in once. This is intentional; no unsafe compatibility path
has been introduced.

## Deployment prerequisites

1. Back up or snapshot the production database according to the normal operator
   procedure.
2. Inspect production migration history and the DeviceSession table for the exact
   existing migration above; do not infer state from the rolled-back application.
3. If absent, apply only the reviewed additive migration using the normal production
   migration workflow before the application rollout.
4. Confirm stable `DATABASE_URL`, `NEXTAUTH_SECRET`/`AUTH_SECRET`, canonical HTTPS
   `NEXTAUTH_URL`, and `CRON_SECRET` in the deployment platform.
5. Deploy the reviewed location-free application build. This checkout does not
   authorize or perform deployment.
6. Tell users with pre-registry cookies that one login is required.
7. Smoke-test USER and ADMIN login, direct route/API access without location,
   session listing/counts, single and bulk revoke, same-browser relogin, password
   change, logout, LOGIN history and cleanup authorization.

## Validation scope

Focused tests cover safe login presentation, user-agent parsing and trusted Vercel
metadata. The disposable PostgreSQL suite covers new-session and exact LOGIN
transactions, same-IP/user-agent repeated login, relogin after revoke, no blacklist,
ownership/expiry/legacy rejection, throttled `lastSeenAt`, individual/bulk/current
session behavior, transactional audit rollback, password change, logout, historical
LOGIN retention and cleanup.

The Chromium browser suite uses Geolocation and Permissions tripwires configured as
denied. It verifies direct `/drivers`, protected API and iPhone Home Screen-style
access without touching either browser API; deleted location routes return 404 and
no response is 428. It also covers refresh/reopen, ADMIN/USER roles, individual
revoke and client redirect, revoked-browser relogin, bulk revoke, password change,
malformed/legacy/expired cookies, activity presentation and ADMIN session layout at
360, 390, 430 and 1280 pixels. Physical iPhone suspension behavior remains a
manual QA item because no physical device is attached.

No commit, push, deployment, production database access or production migration is
performed by this work.
