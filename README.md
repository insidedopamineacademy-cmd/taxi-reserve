# Taxi Reserve

Taxi Reserve is the operational web application for taxi reservations, the shared email inbox, and ADMIN-only driver finance. Parts of the interface retain the `AppReserve` brand name.

The driver ledger is integrated into the existing reservation and email application. It does not replace reservation ownership, date handling, authentication, or inbox behavior. No repository migration claims to import historical balances from a previous standalone commission system.

## Current capabilities

- Credentials authentication with `USER` and `ADMIN` roles stored in PostgreSQL and propagated through NextAuth JWT sessions.
- User-owned reservation create, list, search, date filtering, sorting, editing, status updates, soft deletion, restoration, and permanent deletion of the signed-in user's deleted set.
- Call, WhatsApp, copy-number, and structured reservation-sharing actions.
- Allowlisted IMAP inbox synchronization, folder/search/unread views, sanitized messages, and SMTP replies.
- Best-effort activity logging with per-user visibility and ADMIN-wide access.
- ADMIN-only driver creation, editing, ACTIVE/INACTIVE status, reservation assignment, commissions, payments, balances, finance overview, and PDFs.
- Automatic monthly driver subscription charges secured for Vercel Cron.

## Technology

- Next.js 15 App Router, React 19, TypeScript, and Tailwind CSS 4
- NextAuth 4 credentials authentication with JWT sessions
- Prisma 6 and PostgreSQL/Neon
- IMAPFlow, Mailparser, and Nodemailer-compatible SMTP
- `pdf-lib` for driver ledger reports
- Vercel-compatible Node.js deployment

## Main operational routes

| Route | Purpose | Access |
| --- | --- | --- |
| `/reservations` | Owned active reservations, search, date range, sort, sharing, status, edit, and soft delete | Authenticated |
| `/reservations/deleted` | Restore owned reservations or permanently delete the complete owned deleted set | Authenticated |
| `/emails` | Shared inbox | Authenticated and email allowlisted |
| `/activity-log` | Activity history | Authenticated; own activity for USER, all activity for ADMIN |
| `/drivers` | Driver directory, configuration, balances, and driver detail links | ADMIN |
| `/drivers/overview` | Due, credit, payment, subscription, and recent-finance overview | ADMIN |
| `/commissions` | Reservation-linked and manual commissions | ADMIN |
| `/payments` | Driver payments | ADMIN |
| `/api/drivers/[id]/ledger-pdf` | Individual driver ledger PDF | ADMIN |
| `/api/drivers/due-pdf` | Positive driver balances due PDF | ADMIN |
| `/api/drivers/full-ledger-pdf` | Full driver ledger PDF | ADMIN |

The homepage keeps the original reservation and inbox cards. ADMIN users additionally receive direct access to Drivers and the Full Ledger PDF. The navigation exposes Overview, Drivers, Commissions, and Payments only to ADMIN users.

## Driver finance rules

Commissions are money owed to a driver. Payments and monthly subscription charges reduce that amount. Subscription charges are stored separately from `CommissionEntry`.

```text
balance = totalCommissions - totalPayments - totalSubscriptionCharges
```

All driver finance amounts use Prisma `Decimal`; reservation `priceEuro` remains the existing floating-point field.

Monthly subscription rates are centralized server-side:

- `VAN`: €20.00 per month
- `SEDAN`: €7.00 per month

Only ACTIVE, non-exempt drivers with a configured vehicle type are charged. Existing drivers may have `vehicleType = null` until an ADMIN configures them and are skipped safely in that state. Vehicle or exemption changes affect future charges and never rewrite existing charge history. The database permits at most one charge per driver and month.

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env.local`. `.env.example` lists mail and cron names; database and authentication variables must also be configured locally. Never copy production credentials into tests or commit real values.

3. Validate and generate the Prisma client:

   ```bash
   npm run prisma:validate
   npm run prisma:generate
   ```

4. Start development:

   ```bash
   npm run dev
   ```

The development server uses the standard Next.js port unless one is supplied. `npm run start` runs the production build on port 3001.

## Environment variables

| Variable | Requirement |
| --- | --- |
| `DATABASE_URL` | Required PostgreSQL/Neon connection string used by Prisma |
| `NEXTAUTH_SECRET` or `AUTH_SECRET` | Required stable production secret for JWT/session signing |
| `NEXTAUTH_URL` | Recommended canonical production URL |
| `IMAP_HOST`, `IMAP_PORT`, `IMAP_USER`, `IMAP_PASSWORD` | Required together for inbox synchronization |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` | Required together for replies and SMTP health checks |
| `EMAIL_INBOX_ALLOWED_USERS` | Comma-separated email allowlist; authentication or ADMIN status alone does not grant inbox access |
| `EMAIL_INITIAL_SYNC_LIMIT` | Optional positive initial-sync limit; application default is 100 and maximum is 5,000 |
| `CRON_SECRET` | Required production Bearer secret for the monthly driver-subscription endpoint |

Do not place real secrets in `.env.example`, Markdown, logs, or source control.

## Monthly subscription automation

`vercel.json` registers the production cron schedule:

```text
0 0 1 * *
```

Vercel interprets the schedule in UTC. Midnight UTC falls at 01:00 or 02:00 in Madrid, so execution still occurs on the first Madrid calendar day.

Vercel sends an HTTP GET to:

```text
/api/admin/driver-subscriptions/run-monthly
```

The handler fails closed if `CRON_SECRET` is missing and requires `Authorization: Bearer <CRON_SECRET>`. It creates charges for the current Madrid calendar month, reports created/existing/skipped counts, and is safe to repeat. Application checks plus `UNIQUE(driverId, chargeMonth)` prevent duplicate monthly charges.

## Production migrations

Migration execution is a separate, explicitly approved release step. The install lifecycle generates the Prisma client but does not apply migrations.

With a reviewed backup and the intended production `DATABASE_URL` configured in `.env.local`:

```bash
npm run prisma:validate
npm run prisma:generate
npm run migrate:deploy
```

Review pending migrations before the command, verify the target database, and never run destructive development migration/reset commands against production. Current driver migrations are additive and are documented in `PROJECT_AUDIT.md` and `CHANGELOG.md`.

## Validation

Before release, run:

```bash
npm run prisma:validate
npm run prisma:generate
npm run typecheck
npm run lint
npm run build
git diff --check
```

The focused monthly-subscription integration test requires an explicitly provided disposable local PostgreSQL database whose name contains `test`:

```bash
DRIVER_SUBSCRIPTION_TEST_DATABASE_URL='postgresql://.../taxi_subscription_test' \
  npm run test:driver-subscriptions
```

The test script refuses non-local hosts and database names without `test`.

## Operational safety

- Reservation reads and writes stay scoped to the signed-in user's email.
- Driver finance pages and APIs perform server-side ADMIN checks; middleware is not the sole authorization boundary.
- Inbox visibility remains controlled by `EMAIL_INBOX_ALLOWED_USERS`.
- Reservation-linked commissions take route text from their Reservation. Manual commissions keep independently editable pickup/drop-off fields.
- Commission, payment, and subscription history restricts driver deletion; reservation assignment uses `ON DELETE SET NULL`.
- Financial, reservation, email, authentication, and timezone histories must not be reinterpreted or bulk-rewritten without a dedicated backup and migration plan.

See `PROJECT_AUDIT.md` for the detailed architecture and operations handoff, and `CHANGELOG.md` for implementation history.
