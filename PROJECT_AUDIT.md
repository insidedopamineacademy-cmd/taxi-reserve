# Taxi Reserve — Current Architecture and Operations Handoff

Last audited: 2026-08-10

## Project purpose and system boundary

Taxi Reserve, branded as `AppReserve` in parts of the UI, is the current operational system for:

- authenticated, user-owned taxi reservations;
- the allowlisted shared email inbox and reply workflow;
- activity history; and
- ADMIN-only driver assignment, commissions, payments, subscriptions, balances, and ledger reports.

The driver/finance module was integrated into Taxi Reserve without replacing or reinterpreting the existing reservation, authentication, email, or timezone architecture. Any previous standalone commission application is historical/reference context only. This repository contains no migration that claims to import its historical financial data; new driver-ledger operations are recorded in Taxi Reserve's current models.

## Technology stack

- Next.js 15 App Router, React 19, and TypeScript
- Tailwind CSS 4 plus `src/app/globals.css` and `src/app/mobile.css`
- NextAuth 4 Credentials provider with JWT sessions
- Prisma 6 with PostgreSQL/Neon through `DATABASE_URL`
- `bcryptjs`/`bcrypt` for password verification and hashing
- IMAPFlow and Mailparser for inbox synchronization
- Nodemailer-compatible SMTP transport for replies
- `pdf-lib` for driver ledger reports
- Vercel-compatible deployment with Node.js routes and Vercel Cron configuration

## Repository structure

```text
src/
  app/
    (auth)/                 Login and registration
    api/                    Auth, reservation, admin, email, driver, finance, PDF, and cron handlers
    activity-log/           Protected activity history
    commissions/            ADMIN commission operations
    drivers/                ADMIN directory, detail, edit, finance overview, and entry pages
    emails/                 Allowlisted inbox and thread pages
    payments/               ADMIN payment operations
    reservations/           Active, new, edit, deleted, restore, and delete flows
    settings/               Password-change UI
  components/
    drivers/                Driver, commission, payment, balance, and status UI
    emails/                 Inbox state, sync, message, read, and reply UI
    ReservationsList.tsx    Reservation search, cards, sharing, status, assignment shortcut, and delete UI
    PhoneActions.tsx        Call, WhatsApp, and copy-number actions
    NavbarClient.tsx        Responsive navigation with role/allowlist visibility
  lib/
    drivers/                ADMIN access, validation, route context, Decimal finance, subscriptions, overview, PDFs
    emails/                 IMAP/SMTP config, permissions, sync, persistence, health, and content helpers
    auth.ts                 NextAuth configuration and role propagation
    activityLog.ts          Best-effort activity writer
    parseStartAt.ts         Reservation local-wall-time conversion helpers
    phoneActions.ts         Phone normalization
    prisma.ts               Shared Prisma client
prisma/
  schema.prisma             Current PostgreSQL model
  migrations/               Recorded additive migration history
scripts/
  test-driver-subscriptions.mjs
vercel.json                 Monthly subscription cron schedule
next.config.ts              Next.js configuration and response security headers
src/middleware.ts           Page-level NextAuth protection
```

## Access-control model

### Authentication and roles

- `User.role` is the Prisma `Role` enum: `USER` or `ADMIN`; registrations default to `USER`.
- NextAuth normalizes the login email, verifies the stored password hash, and copies the database role into the JWT and session.
- Because the role is held in the JWT, a database role change is reflected after the user starts a new authenticated session.
- Middleware protects reservation, inbox, settings, activity, admin, driver, commission, and payment pages.
- `/admin`, `/drivers`, `/commissions`, and `/payments` page paths require an `ADMIN` token role in middleware.
- Driver/finance pages and APIs repeat authorization through server session checks. Middleware is not the sole security boundary.

### Reservation ownership

- Reservation reads and writes are constrained by `Reservation.userEmail = session.user.email`.
- Edit, assignment, restore, soft-delete, and permanent-delete operations cannot cross this ownership boundary.
- An ADMIN receives driver/commission controls only for reservations the ADMIN already owns; ADMIN does not bypass reservation ownership.

### Inbox permission

- Authentication, USER/ADMIN role, and inbox access are separate concepts.
- `EMAIL_INBOX_ALLOWED_USERS` is parsed as a normalized, comma-separated allowlist.
- The Inbox card/navbar link and every email page/API depend on allowlist access. ADMIN status alone does not grant inbox access.

## Current pages

| Route | Purpose | Access |
| --- | --- | --- |
| `/` | Reservation dashboard, allowlisted unread Inbox card, ADMIN Drivers and Full Ledger PDF actions | Public shell; content adapts to session/permissions |
| `/login`, `/register` | Credentials sign-in and account registration | Public |
| `/reservations` | Owned active reservations, free-text search, optional URL date range, sort, status, phone, sharing, edit, assignment shortcut, and soft delete | Authenticated |
| `/reservations/new` | Create an owned reservation | Authenticated |
| `/reservations/[id]/edit` | Edit an owned active reservation; ADMIN-only driver/commission section | Authenticated and ownership-checked |
| `/reservations/deleted` | Restore owned deleted records or permanently delete the complete owned deleted set | Authenticated |
| `/emails` | Foldered/searchable shared inbox and manual sync | Authenticated and allowlisted |
| `/emails/[threadId]` | Thread history, mark-read behavior, and reply composer | Authenticated and allowlisted |
| `/settings` | Change the signed-in user's password | Authenticated |
| `/activity-log` | Searchable/filterable activity history | Authenticated; own rows for USER, all rows for ADMIN |
| `/admin` | User count/list | ADMIN |
| `/drivers` | Driver directory, configuration state, aggregate finance, balances | ADMIN |
| `/drivers/new` | Create a driver | ADMIN |
| `/drivers/[id]` | Driver details, finance summary, histories, actions, individual PDF | ADMIN |
| `/drivers/[id]/edit` | Edit name, license, vehicle, exemption, and status | ADMIN |
| `/drivers/overview` | Due/credit/net position, payments, monthly subscriptions, recent entries | ADMIN |
| `/commissions` | Search/list reservation-linked and manual commissions; launch manual entry | ADMIN |
| `/payments` | Search/list payments; launch payment entry | ADMIN |

The desktop and mobile navbar expose Overview, Drivers, Commissions, and Payments only to ADMIN users. The homepage preserves reservation/inbox/settings behavior and adds ADMIN-only Drivers and direct Full Ledger PDF cards.

## Main API surface

| Method and route | Responsibility |
| --- | --- |
| `GET/POST /api/auth/[...nextauth]` | NextAuth credentials and session endpoints |
| `POST /api/register` | Validate and register a default-USER account |
| `POST /api/user/change-password` | Verify current password and store a new hash |
| `GET /api/admin` | Return user count/list after an ADMIN session check |
| `DELETE /api/admin` | Deliberately disabled with HTTP 405 |
| `POST /api/reservations` | Create an owned reservation |
| `PATCH /api/reservations/[id]` | Update an owned active reservation; transactionally handle ADMIN assignment/linked commission when supplied |
| `DELETE /api/reservations/[id]` | Soft-delete an owned reservation |
| `POST /api/reservations/bulk-delete` | Soft-delete a bounded owned set |
| `PATCH /api/reservations/[id]/restore` | Restore an owned soft-deleted reservation |
| `DELETE /api/reservations/deleted/permanent-delete-all` | Permanently delete the owner's complete soft-deleted set |
| `POST /api/drivers` | Create a driver after an ADMIN check |
| `PATCH /api/drivers/[id]` | Edit driver profile/configuration/status after an ADMIN check |
| `POST /api/drivers/[id]/commissions` | Create a manual commission for an ACTIVE driver |
| `PATCH/DELETE /api/drivers/[id]/commissions/[commissionId]` | Edit/delete an owned driver commission entry in the ADMIN ledger |
| `POST /api/drivers/[id]/payments` | Create a payment for an ACTIVE driver |
| `PATCH/DELETE /api/drivers/[id]/payments/[paymentId]` | Edit/delete a driver payment |
| `GET /api/drivers/[id]/ledger-pdf` | Individual driver PDF |
| `GET /api/drivers/due-pdf` | Positive-balance due PDF |
| `GET /api/drivers/full-ledger-pdf` | Full driver ledger PDF |
| `GET /api/admin/driver-subscriptions/run-monthly` | Bearer-secured monthly subscription batch |
| `GET /api/emails/config-check` | Allowlist and email-connection readiness |
| `POST /api/emails/sync` | Allowlisted IMAP synchronization |
| `POST /api/emails/send` | Allowlisted SMTP reply and outgoing persistence |
| `POST /api/emails/threads/[threadId]/read` | Mark an allowlisted thread read |

Driver lists/details and financial pages use server-side Prisma queries; there is no general public driver read API.

## Reservation workflows

### Create, list, search, and sort

1. The create form combines browser-local date and time and converts the local wall time to a UTC ISO instant through `localDateTimeToUtcIso`.
2. `POST /api/reservations` validates the request and stores it with the authenticated email as owner.
3. `/reservations` queries only the owner's non-deleted records, accepts `from`/`to` URL date boundaries, orders by `startAt`, caps the result at 500, and serializes dates to epoch milliseconds.
4. `ReservationsList` performs client-side free-text search across phone, pickup, drop-off, flight, notes, assigned driver where visible, price, status label, and formatted date/time. Numeric phone matching is normalized separately.
5. The visible sort control updates the `sort=asc|desc` URL parameter.

`ReservationsFilters` contains reusable status/from/to/sort controls, but it is not currently mounted on `/reservations`; the current page also does not apply its `status` parameter. Do not document a visible status/date filter panel as active until it is wired into the page.

### Edit structure

The redesigned Reservation Edit page keeps the existing PATCH semantics and groups fields into:

- Ride Details — pickup, drop-off, start, and optional end;
- Passenger & Journey — passengers, flight, phone, and phone actions;
- Booking & Operations — price, status, and notes; and
- Driver & Commission — ADMIN-only assignment and reservation-linked commission controls.

The ADMIN section is addressable as `#driver-commission`, which is the target of the reservation-card `Assign Driver`/assigned-driver shortcut.

### Status and deletion

- Current editable status codes normalize to `ASSIGNED` (`Falta cobrar por el conductor`) or `COMPLETED` (`Cobrado`).
- Reservation cards cycle these statuses through the owned PATCH endpoint.
- Normal deletion sets `isDeleted = true` and removes the row optimistically from the active list.
- `/reservations/deleted` restores individual owned reservations.
- `DELETE /api/reservations/deleted/permanent-delete-all` permanently deletes every soft-deleted reservation owned by the current user after explicit confirmation. There is no individual hard-delete action in the current UI.

### Phone and sharing

- Phone actions expose `tel:`, WhatsApp, and clipboard copy targets after normalization.
- Structured WhatsApp sharing includes trip, schedule, customer, notes, booking status, and price when present.
- The server adds `driverName` and linked `commissionAmount` to reservation-card props only for ADMIN sessions.
- Consequently, ADMIN shares may include assigned driver and commission, while normal-user shares cannot receive or expose commission data through this workflow.

## Driver management

- Driver pages and APIs are ADMIN-only.
- A driver has a unique license number and `ACTIVE` or `INACTIVE` status.
- Current operations are create, read/list, edit, activate, and deactivate. No driver-delete route or UI is implemented.
- New drivers must select `VAN` or `SEDAN`. Existing production drivers are migration-safe because `vehicleType` is nullable and appear as `Not set - configuration required` until edited.
- `subscriptionExempt` defaults to `false` and can be changed in the driver form.
- Inactive drivers remain visible with full historical entries. They cannot receive new reservation assignments, manual commissions, or payments; the current inactive reservation assignment can remain selected while editing.
- Status/configuration changes do not mutate historical commissions, payments, or subscription charges.

## Reservation assignment and commission synchronization

- `Reservation.driverId` is optional and links a reservation to one driver.
- ADMIN edits submit driver and commission values together to the existing owned reservation PATCH endpoint.
- The reservation update, driver assignment, and reservation-linked commission synchronization run in one Prisma transaction.
- Only ACTIVE drivers may receive a new assignment. The current inactive driver may remain attached.
- A reservation may have at most one linked commission because `CommissionEntry.reservationId` is unique.
- Adding/changing a driver with an amount creates or updates that linked commission.
- Removing the assignment or amount from an existing linked commission requires explicit confirmation and removes only the linked commission; manual commissions and payments are unaffected.
- A linked commission's `entryDate` is the Madrid calendar date of the reservation start instant when created. Later amount/driver updates do not silently rewrite its date.

## Commission route context

Commission route display is resolved by source:

- A reservation-linked `CommissionEntry` reads pickup and drop-off directly from its related `Reservation`, keeping the route aligned with reservation edits while that relation exists.
- A manual commission has `reservationId = null` and stores independently editable `manualPickupText` and `manualDropoffText`.
- `CommissionEntry.reservationId` uses `ON DELETE SET NULL`; permanent Reservation deletion preserves the financial entry but severs its Reservation route source. No automatic route snapshot is created at deletion time.

The commission list, driver ledger, finance overview, individual PDF, and full PDF use this shared route-resolution rule.

## Payments and financial calculations

- `DriverPayment` records a date, positive Decimal amount, method (`CASH`, `BANK`, or `OTHER`), optional notes, and driver.
- Manual commissions and payments can be created for ACTIVE drivers and later edited/deleted from ADMIN workflows.
- Commission/payment date inputs are validated as `YYYY-MM-DD` and stored as UTC-midnight financial dates for stable display.
- All ledger arithmetic uses Prisma `Decimal`; no floating-point arithmetic is used for driver money.
- Reservation `priceEuro` intentionally remains the pre-existing `Float` field and is not part of driver ledger arithmetic.

The centralized balance formula is:

```text
balance = totalCommissions - totalPayments - totalSubscriptionCharges
```

Interpretation:

- positive balance: Taxi Reserve still owes the driver;
- negative balance: driver credit/amount on the business side;
- zero: settled.

`/drivers` shows aggregate commission, payment, subscription, and outstanding totals. `/drivers/overview` derives Total Commission Due, Driver Credits, and Net Position from final per-driver balances, and also shows payments this week/month, subscriptions this month, active-driver count, and recent commission/payment activity.

## Monthly driver subscription system

Subscriptions are money owed by the driver and are never stored in `CommissionEntry`.

### Configuration and rates

| Vehicle type | Monthly charge |
| --- | ---: |
| `VAN` | €20.00 |
| `SEDAN` | €7.00 |

Rates are centralized in `src/lib/drivers/subscriptionCore.ts` as Decimal strings.

### Eligibility and history

For a monthly run, a driver must be:

- `ACTIVE` at execution time;
- `subscriptionExempt = false`; and
- configured with a valid vehicle type.

Inactive, exempt, and unconfigured drivers are skipped and counted. A charge uses the configuration present when it is created. Later vehicle/status/exemption changes do not rewrite or remove historical charges. Reactivating a driver later in a month does not itself generate a charge; only an explicit generator execution can create a missing current-month charge.

### Month and idempotency

- `chargeMonth` is normalized to the first date of the Madrid calendar month and stored as PostgreSQL `DATE`.
- `UNIQUE(driverId, chargeMonth)` enforces at most one monthly charge per driver.
- The generator checks for an existing row before insert and also catches the uniqueness race, so repeated or concurrent execution cannot duplicate the charge.
- No arbitrary manual subscription amount editor exists.

### Cron endpoint

`vercel.json` configures:

```text
schedule: 0 0 1 * *
GET /api/admin/driver-subscriptions/run-monthly
```

Vercel Cron expressions use UTC. Midnight UTC is still the first calendar day in Madrid (01:00 CET or 02:00 CEST), and the service independently normalizes the charge to the Madrid month.

The route:

- uses the Node.js runtime;
- fails with 503 if `CRON_SECRET` is absent;
- requires an exact `Authorization: Bearer <CRON_SECRET>` header using a timing-safe comparison;
- returns only month and created/existing/skipped counts; and
- writes best-effort per-charge and batch activity events.

Do not publish a real secret or add a query-string secret. Vercel Cron activates only after a production deployment containing the schedule; this repository configuration alone does not prove that production automation is enabled.

## Driver PDFs

All PDF routes perform server-side ADMIN checks and return private, non-cached downloads:

| Route | Content |
| --- | --- |
| `GET /api/drivers/[id]/ledger-pdf` | Driver identity; commission, payment, subscription, and balance totals; commission routes; payment history; subscription month/amount history |
| `GET /api/drivers/due-pdf` | Drivers with positive final balances and totals including subscription deductions |
| `GET /api/drivers/full-ledger-pdf` | Every driver with commission routes, payments, subscriptions, and final balance |

The homepage exposes the Full Ledger PDF directly to ADMIN users. The finance overview exposes the Due PDF, and each driver detail page exposes the individual ledger.

## Database model and preservation behavior

### Driver-related models

- `Driver`: unique license, status, nullable vehicle type, exemption flag, and relations to reservations and all ledger records.
- `CommissionEntry`: Decimal commission, financial date, optional notes, optional unique reservation, and optional manual route fields.
- `DriverPayment`: Decimal payment, date, method, optional notes, and driver.
- `DriverSubscriptionCharge`: Decimal monthly charge and PostgreSQL date, with unique driver/month constraint.
- `Reservation.driverId`: optional driver assignment indexed for lookup.

### Relationship behavior

| Relationship | Delete behavior | Principle |
| --- | --- | --- |
| `Reservation.driverId -> Driver.id` | `SET NULL` | Reservation history survives removal of a driver reference |
| `CommissionEntry.driverId -> Driver.id` | `RESTRICT` | Commission history prevents driver deletion |
| `CommissionEntry.reservationId -> Reservation.id` | `SET NULL` | Financial entry survives permanent reservation deletion |
| `DriverPayment.driverId -> Driver.id` | `RESTRICT` | Payment history prevents driver deletion |
| `DriverSubscriptionCharge.driverId -> Driver.id` | `RESTRICT` | Subscription history prevents driver deletion |

There is no current driver-delete API. The restrictive financial foreign keys provide an additional database-level preservation boundary.

## Email and inbox system

- IMAP sync discovers/classifies Inbox, Sent, Spam, Archive, and Trash folders and persists threads, messages, attachments, folder/mailbox membership, and sync progress.
- The inbox supports folder navigation, search, unread filtering, manual sync/progress, sanitized HTML/text display, mark-read, and replies.
- SMTP replies preserve thread headers and persist the outgoing message and thread state transactionally.
- Configuration/health errors avoid exposing credentials.
- Email schema readiness is checked before inbox reads. Do not bypass allowlist, schema, or folder-classification rules.

## Activity logging

`ActivityLog` records action, entity type, optional entity ID, optional normalized user email, optional JSON metadata, and timestamp. `logActivity` is deliberately best-effort: logging failure is reported but never fails the originating operation.

Implemented action families include:

- authentication/administration: registration, login/logout, admin login, admin user-list view;
- reservations: create/update/delete/restore contexts, assignment changes, linked-commission create/update/remove;
- drivers: create/update/activate/deactivate;
- manual commissions: create/update/delete;
- payments: create/update/delete; and
- subscriptions: per-charge generation and monthly batch run.

Normal users query only rows with their own normalized email. ADMIN users query all rows, including system subscription events whose `userEmail` is null. Financial activity metadata follows the existing minimal policy and does not copy commission/payment/subscription amounts.

## Date and timezone behavior

Three date categories intentionally coexist:

1. Reservation instants: browser-local wall time is converted to UTC before storage; display converts stored instants back through JavaScript/browser locale behavior.
2. Commission/payment financial dates: date-only form values are represented as UTC-midnight `DateTime` values and displayed in UTC to avoid calendar drift.
3. Subscription months: the current Madrid calendar month is normalized to its first day and stored as PostgreSQL `DATE`.

Madrid conversion is also used when deriving a reservation-linked commission date and finance reporting periods. Do not casually merge these categories or change offsets/serialization as part of UI work.

## Environment variables

Never commit real values. Configure production values in the deployment platform.

| Variable | Requirement |
| --- | --- |
| `DATABASE_URL` | Required PostgreSQL/Neon connection string |
| `NEXTAUTH_SECRET` or `AUTH_SECRET` | Required stable production session/JWT secret |
| `NEXTAUTH_URL` | Recommended canonical production URL |
| `IMAP_HOST`, `IMAP_PORT`, `IMAP_USER`, `IMAP_PASSWORD` | Required together for inbox synchronization |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` | Required together for email replies/health |
| `EMAIL_INBOX_ALLOWED_USERS` | Required comma-separated inbox allowlist |
| `EMAIL_INITIAL_SYNC_LIMIT` | Optional positive initial-sync limit; default 100, maximum 5,000 |
| `CRON_SECRET` | Required production Bearer secret for monthly subscriptions |

`.env.example` contains mail variables and `CRON_SECRET`. Database and authentication names are documented here/README but real values must remain outside version control.

## Setup, validation, and deployment

### Local setup

```bash
npm install
npm run prisma:validate
npm run prisma:generate
npm run dev
```

`postinstall` runs `prisma generate`; it does not apply a database migration.

### Validation

```bash
npm run prisma:validate
npm run prisma:generate
npm run typecheck
npm run lint
npm run build
git diff --check
```

The focused subscription test requires a disposable local PostgreSQL URL supplied as `DRIVER_SUBSCRIPTION_TEST_DATABASE_URL`. Its script refuses non-local hosts and database names that do not include `test`.

### Production migration workflow

After review, backup, approval, and verification that `.env.local` targets the intended production database:

```bash
npm run prisma:validate
npm run prisma:generate
npm run migrate:deploy
```

Do not use `prisma migrate dev`, reset, schema push, or test scripts against production. Deploy application code and enable cron only after the required migration and `CRON_SECRET` are ready.

The repository's `00000000000000_baseline/migration.sql` is empty. Therefore, the recorded migration directory must not be assumed to bootstrap a blank PostgreSQL database: later migrations expect the original User/Reservation/Reminder schema to exist. Existing production deployments must have schema and migration history aligned; a brand-new environment requires a separately reviewed baseline/bootstrap procedure. Do not rewrite historical migration files to hide this condition.

## Recent driver migration history

| Migration | Current effect |
| --- | --- |
| `20260809120000_add_driver_commission_foundation` | Adds Driver status/payment enums, Driver, CommissionEntry, DriverPayment, `Reservation.driverId`, indexes, and preservation-oriented foreign keys |
| `20260809160000_unique_commission_reservation` | Replaces the reservation commission index with a unique index, allowing at most one linked commission while still allowing many manual rows with null reservation IDs |
| `20260809210000_add_manual_commission_route` | Adds optional manual pickup/drop-off fields without changing reservation-linked route ownership |
| `20260810120000_add_driver_subscriptions` | Adds vehicle enum/configuration, exemption flag, DriverSubscriptionCharge, month index, unique driver/month constraint, and restrictive driver relation |

All are additive relative to the live Taxi Reserve architecture. No migration imports or reinterprets financial history from an external standalone system.

## Response and browser hardening

- `next.config.ts` denies framing, prevents MIME sniffing, applies a conservative referrer policy, and disables camera/microphone/geolocation.
- CSP remains intentionally deferred until Next.js, NextAuth, inbox HTML, and interactive flows can be tested together.
- Global/mobile CSS hardens native date/time controls for iOS without changing date conversion logic.

## Known risks and limitations

- Public registration, login, and password change have no application-level rate limiting; deployment/network controls remain important.
- Driver deletion is not implemented despite database relationships being designed to preserve history.
- The reusable reservation status/date filter UI is not mounted, and `/reservations` does not currently apply a status filter parameter.
- The empty historical baseline migration prevents treating `prisma migrate deploy` as a blank-database bootstrap mechanism.
- Vercel Cron does not retry failed invocations automatically; monitor function logs and rely on safe idempotent reruns.
- Email folder discovery depends on provider naming/special-use flags and correct email-table readiness.
- Permanent reservation deletion is irreversible and can sever reservation route context from preserved linked commissions.
- Date/time behavior depends on browser-local conversion for reservations; timezone changes need dedicated regression testing.
- A strict Content Security Policy is not yet enabled.

## QA checklist

- [ ] Run Prisma validate/generate, typecheck, lint, build, and `git diff --check`.
- [ ] Sign in as USER and ADMIN; verify role-specific navbar/homepage and server denials.
- [ ] Confirm USER reservations remain owner-scoped and do not receive driver commission data in cards or WhatsApp shares.
- [ ] Search reservations; test `from`/`to` URL ranges, sort order, status cycling, edit sections, soft delete, restore, and permanent-delete-all confirmation.
- [ ] Verify local reservation date/time survives save/reload without shifting.
- [ ] Verify Call, WhatsApp, Copy, and structured share on mobile and desktop.
- [ ] Verify Inbox visibility for an allowlisted user and denial for authenticated users not on the allowlist.
- [ ] Create/edit/activate/deactivate a driver, including an existing driver whose vehicle is initially unset.
- [ ] Assign/change/unassign an ACTIVE driver and create/update/remove the reservation-linked commission with confirmation.
- [ ] Create/edit/delete manual commissions and payments; verify route source labels.
- [ ] Confirm finance balances and overview use commissions minus payments minus subscriptions.
- [ ] Generate individual, due, and full ledger PDFs and inspect multi-page route/payment/subscription layout.
- [ ] Run monthly subscription tests on disposable PostgreSQL data for rates, skips, two months, idempotency, history preservation, and uniqueness.
- [ ] Call the cron route with missing/wrong/valid Bearer values only in a non-production environment.
- [ ] Verify activity queries are user-scoped for USER and complete for ADMIN, with no private payloads.
- [ ] Test inbox folder browsing, search, sync, mark-read, and reply with a non-production mailbox.

## Protected areas

Do not modify, reset, reinterpret, or deploy changes to these areas without explicit approval, backups, and focused regression testing:

1. Prisma schema, migrations, migration records, or live PostgreSQL/Neon data.
2. Reservation ownership, CRUD, status, soft-delete/restore/permanent-delete, assignment transaction, or persisted field types.
3. Commission/payment/subscription Decimal calculations, uniqueness, financial dates, or history-preservation relations.
4. Reservation timezone conversion, financial date normalization, Madrid month derivation, or date-range boundaries.
5. NextAuth credentials, JWT role propagation, secrets, middleware, or server-side authorization.
6. Inbox allowlist, IMAP sync state, folder classification, threading, sanitization, SMTP, or outgoing persistence.
7. Cron secret validation, schedule, or monthly eligibility/idempotency rules.
