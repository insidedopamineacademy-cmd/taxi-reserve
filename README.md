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
- Feature-flagged, authenticated AI assistant with server-only OpenAI configuration and owner-scoped read-only reservation search/get tools.

## Technology

- Next.js 15 App Router, React 19, TypeScript, and Tailwind CSS 4
- Node.js 22 or newer (required by the installed official OpenAI Node SDK)
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
| `POST /api/assistant/chat` | Streamed Phase 1D read-only reservation, driver, and finance assistant | Authenticated; driver/finance tools require ADMIN |

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

   Use Node.js 22 or newer.

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
| `AI_ASSISTANT_ENABLED` | Optional server-side Phase 1B UI flag; defaults to disabled unless set exactly to `true` |
| `AI_ASSISTANT_PREVIEW` | Development-only fixture switch; requires `AI_ASSISTANT_ENABLED=true` and is always disabled in production |
| `OPENAI_API_KEY` | Required server-only secret when the enabled assistant transport makes a Responses API call |
| `AI_ASSISTANT_MODEL` | Required server-side OpenAI model identifier; no public/client equivalent |
| `AI_ASSISTANT_REQUEST_TIMEOUT_MS` | Optional hard request timeout from 1,000 to 120,000 ms; defaults to 30,000 |
| `AI_ASSISTANT_MAX_REQUESTS_PER_MINUTE` | Optional per-user, per-instance accepted-generation cap from 1 to 60; defaults to 6 |
| `AI_ASSISTANT_MAX_INPUT_CHARS` | Optional user-message cap from 100 to 20,000 characters; defaults to 2,000 |
| `AI_ASSISTANT_MAX_OUTPUT_TOKENS` | Optional per-model-round ceiling from 100 to 4,000 tokens; defaults to 1,200 |
| `AI_ASSISTANT_ALLOWED_EMAILS` | Optional comma-separated initial-rollout allowlist; when unset, all authenticated users remain eligible |

Do not place real secrets in `.env.example`, Markdown, logs, or source control.

## AI reservation assistant

The authenticated application shell remains behind `AI_ASSISTANT_ENABLED`. When the flag is absent or false, no assistant launcher or panel is mounted and the endpoint rejects before admission, tools, or OpenAI. Phase 1E keeps exactly five read-only functions: `search_reservations`, `get_reservation`, `search_drivers`, `get_driver_ledger_summary`, and `get_driver_transactions`. The route keeps server-only configuration, bounded payload/context/output, request IDs, hard timeout/cancellation propagation, metadata-only telemetry, `store: false`, no automatic OpenAI retries, `parallel_tool_calls: false`, and a maximum of four tool calls per user turn.

Accepted requests are protected by a canonical-user admission controller: one active generation and a configurable rolling requests-per-minute cap. Rejections return stable `RATE_LIMITED` errors with `Retry-After`. The controller is intentionally process-local, so each serverless/application instance enforces its own window; use deployment-level shared rate controls if a globally authoritative cap becomes necessary. Cancellation, timeout, success, and failure release the active lease. `AI_ASSISTANT_ALLOWED_EMAILS` can restrict the initial server-side rollout without trusting a browser identity.

Reservation access is prepared behind a separate deterministic service. Both USER and ADMIN searches are restricted to `Reservation.userEmail = authenticated user email` and `isDeleted = false`; ADMIN does not receive cross-user reservations. ADMIN may use assignment filters and receive minimal driver identity, while USER DTOs omit it. Search results default to 10 and cannot exceed 20. Madrid calendar dates and DST-aware day boundaries are resolved by the application before Prisma. The database has no passenger-name field, so no passenger-name filter or invented DTO field exists.

Strict closed `search_reservations` and `get_reservation` schemas are passed from a hardcoded registry and revalidated before every service call. The server resolves current Madrid date/time, attaches canonical authentication context, executes only the deterministic reservation service, and sends minimized role-aware results back to the model. Stored route, phone, and other reservation strings are untrusted data, never instructions.

All three driver/finance tools authorize the canonical database-backed user role before any driver lookup. Only ADMIN may use them; USER failures return a permission-safe token that does not reveal whether a driver exists. Driver search defaults to 10 results, caps at 20, scans at most 200 candidates per request for application-owned DUE/CREDIT/SETTLED filtering, and resumes with a bounded cursor. Transaction pages default to 10, cap at 25, accept validated civil-date ranges, and never include notes or raw Prisma objects.

Finance DTOs reuse the canonical Prisma Decimal summaries and formula `commissions - payments - subscription charges`. Every amount crossing the AI or browser boundary is an exact decimal string with `EUR`; application code classifies positive balances as DUE, zero as SETTLED, and negative as CREDIT. Period totals are aggregated by the application rather than inferred from the visible transaction rows. Existing `/drivers/[id]` and authorized `/reservations/[id]/edit` links are reused.

The browser receives only small typed application-owned events, including `assistant.reservation_result`, `assistant.driver_result`, `assistant.driver_financial_summary`, and `assistant.driver_transactions`; raw provider events never reach it. Text is animation-frame coalesced; cards come from structured facts rather than Markdown parsing. Stop aborts the live request and preserves partial output. Retry reuses the failed turn without duplicating its user bubble or cards. Conversation context is ephemeral, text-only, and capped at six entries/4,000 characters; it is not stored in browser storage, OpenAI conversations, or Taxi Reserve tables.

No AI write, reservation/driver/finance mutation, unrestricted Prisma/SQL access, conversation persistence, or Phase 1D database migration was added.

For local visual QA only, set both flags to `true` while running the development server and visit `/assistant-preview`. This route presents clearly labelled static fixtures and returns 404 in production. It must never be used as a source of operational truth.

Phase 1B.1 mobile behavior, supplemental checks, and the required physical-device matrix are documented in `ASSISTANT_MOBILE_QA.md`. Taxi Reserve does not currently provide a manifest or service worker, so standalone/PWA testing is not applicable.

Production rollout, read-only smoke tests, deterministic answer evaluation, monitoring, and rollback are documented in `ASSISTANT_RELEASE_RUNBOOK.md`.

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
npm run test:assistant-mobile
npm run test:assistant-foundation
npm run test:assistant-tool-loop
npm run test:assistant-streaming
npm run test:assistant-driver-finance
npm run test:assistant-driver-tool-loop
npm run test:assistant-production
npm run build
git diff --check
npm audit --json
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
