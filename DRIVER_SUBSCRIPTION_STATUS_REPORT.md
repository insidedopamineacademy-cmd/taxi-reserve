# Alphabetical driver lists and monthly subscription payment status

## Pre-implementation audit and proposed schema

The existing `DriverSubscriptionCharge` is a generated monthly ledger deduction,
not evidence of receipt of money. It stores `driverId`, a civil `chargeMonth`,
the historical Decimal `amount`, and timestamps. Its unique driver/month key
already enforces one monthly record. All stored amounts participate in
`commissions - payments - subscriptionCharges = balance`, without payment allocation.

The existing monthly cron generates charges on the first day of each month for
active, non-exempt drivers with a configured vehicle type (VAN 20.00, SEDAN 7.00).
It preserves previous records, skips inactive/exempt/unconfigured drivers, and is
idempotent. Those generation rules and all balance calculations will remain intact.

Proposed additive Prisma change, recorded before schema implementation:

```prisma
enum DriverSubscriptionPaymentStatus {
  UNVERIFIED
  UNPAID
  PAID
}

// Additional fields on the existing DriverSubscriptionCharge:
paymentStatus   DriverSubscriptionPaymentStatus @default(UNPAID)
paidAt          DateTime? @db.Date
paidByUserId    String?
paidByUser      User? @relation("SubscriptionRecordedBy", fields: [paidByUserId], references: [id], onDelete: Restrict)
paymentNote     String? @db.VarChar(500)
paymentRevision Int @default(0)
```

`User` receives the inverse relation. Existing rows will be backfilled as
`UNVERIFIED`, as explicitly chosen by the user; subsequently generated rows
default to `UNPAID`. Paid date and recording admin must exist for PAID status.
An optimistic revision prevents a stale confirmation from overwriting newer
changes. Status changes and their ActivityLog audit are written atomically.

No production data will be modified or migrated during this task. Migration
validation and write tests will use disposable local PostgreSQL only.

## Implementation report — 6 September 2026

### 1. Driver-list surfaces audited

| Surface | Result |
| --- | --- |
| `/drivers` and its search results | Shared A–Z ordering; filtering preserves that order. |
| `/drivers/credits` and `/drivers/due` | Shared report preparation now sorts names A–Z; totals and financial inclusion rules are unchanged. |
| Pending Commissions PDF | Uses the same ordered report as the Pending page. |
| Full driver ledger PDF | Driver sections are A–Z; entries within each driver's ledger retain date order. |
| Driver Credits PDF | No separate credits PDF exists. The credits drill-down is covered above. |
| Commissions and Payments driver dropdowns | Active drivers sorted with the shared helper. These pages have event lists, rather than separate driver filter controls. |
| Assign Driver on reservation edit | Same ordering; existing eligibility and assignment behavior preserved. |
| Finance Overview | Summary cards and recent commission/payment timelines; no separate driver list. Recent events retain their chronological ordering. |
| Admin driver selectors | The finance and reservation selectors above are the existing admin driver choices; no additional standalone selector found. |
| Assistant driver searches/results and choices | All matching candidate identities sorted before pagination; financial summaries still fetched in bounded batches. |
| Assistant import matching and review | Matching candidates sorted before the existing 200-candidate cap. Review rows sorted within their existing review-state groups, before display truncation. Source draft records and workflow group priority are preserved. |
| Reservation, commission, payment and monthly history timelines | Chronological sorting preserved. Subscription batch ID order is internal processing order, not a driver list shown to workers. |

There was no existing user-selected balance sort to retain on the balance drill-down pages.

### 2. Exact ordering rule

`src/lib/drivers/driverOrder.ts` uses a fixed `en-GB` `Intl.Collator` with
`sensitivity: "base"` and `numeric: true`. Names are trimmed, NFKD-normalized and
lowercased before comparison. Ties resolve by normalized name codepoint order,
collated normalized licence, normalized licence codepoint order, then stable ID.
Thus `Ali`/`ali` group together, accented European names sort naturally, and licence
2 precedes 20 for identical names. Sorting copies arrays and does not mutate inputs.

Database ordering does not decide presentation or page boundaries. Assistant
search and import matching retrieve the matching identity metadata before sorting
and slicing. This trades an additional in-memory metadata sort for consistent
ordering; it does not fetch all financial histories for each search page.

### 3. Files changed for sorting

- `src/lib/drivers/driverOrder.ts` — shared comparator, copy-sort and pagination.
- `src/lib/drivers/overview.ts` — main list and finance report source.
- `src/lib/drivers/balanceReport.ts` — Credits, Pending and Pending PDF ordering.
- `src/components/drivers/DriverBalanceList.tsx` — A–Z ordering label.
- `src/app/commissions/page.tsx` and `src/app/payments/page.tsx` — driver dropdowns.
- `src/app/reservations/[id]/edit/page.tsx` — driver assignment choices.
- `src/app/api/drivers/full-ledger-pdf/route.ts` — ordered driver sections.
- `src/lib/drivers/assistant-finance-repository.ts` — candidates before pagination.
- `src/lib/drivers/import-prisma.ts` — candidates before the matching cap.
- `src/components/assistant/DriverImportDraftCard.tsx` — names within review groups.
- Sorting regression coverage is in `scripts/test-driver-order.mts` and the updated balance/PDF tests.

### 4. Existing subscription semantics discovered

`DriverSubscriptionCharge` already owns the monthly amount and civil `chargeMonth`
(first day of the month, stored as SQL DATE). It has the unique
`(driverId, chargeMonth)` key and historical Decimal amounts. It was a generated
ledger deduction without payment evidence, paid date or recording user.

`subscriptionCore.ts` generates VAN €20.00 and SEDAN €7.00 charges. Existing records
are retained on repeat generation, including their original amount. Inactive,
exempt and unconfigured drivers are skipped. `subscriptions.ts` scopes the batch
to the Madrid calendar month. The existing protected endpoint is
`/api/admin/driver-subscriptions/run-monthly`, scheduled by `vercel.json` on the
first day of each month and authorized by `CRON_SECRET`.

`financialMath.ts`, `financials.ts`, `DriverFinancialSummary`, and
`getDriverBalanceLines()` use all stored subscription amounts in the existing
formula. There was no receipt allocation model. This implementation adds receipt
status without reinterpreting that accounting behavior.

### 5. Schema migration requirement

An additive migration was necessary because the previous model had no payment
evidence fields. The proposed schema above was recorded before implementation.
Migration: `prisma/migrations/20260905180000_driver_subscription_payment_status/migration.sql`.
It extends the existing model; no parallel monthly model was created.

### 6. Monthly subscription status model

Each existing monthly row now has `paymentStatus`, `paidAt`, `paidByUserId`,
`paymentNote`, and `paymentRevision`. `PAID`, `UNPAID` and `UNVERIFIED` are stored
states. Historical rows become **UNVERIFIED**, following the user's decision;
newly generated rows default to **UNPAID**.

SQL constraints require a paid date and recording user for PAID, and require
both to be null otherwise. The user relation is restricted against deletion.
Notes are limited to 500 characters. A non-negative optimistic revision protects
against stale updates. The existing monthly uniqueness constraint remains intact.

If there is no monthly row, the UI separately labels the current situation as
Not generated, Exempt, Inactive or Type required. These are display explanations,
not invented payment records. A stored row always takes precedence over today's
driver configuration. Historical amounts are never recomputed from current rates.

### 7. Marking a month paid and correcting mistakes

An admin opens the driver's Monthly subscription section, chooses the month, and
uses Record subscription payment (or Review payment status for legacy records).
They enter a paid date and optional reference, then confirm an action that names
the driver, month and stored amount. Future or invalid paid dates are rejected.

Edit / undo payment supports correcting paid details or marking the month unpaid.
Undo requires confirmation, clears the current paid date/recorder, retains the
monthly row and amount, and preserves the previous details in ActivityLog. Notes
can document a correction. Identical repeated confirmations do not create another
audit entry or change the original recorder. A conflicting stale update returns
409 and asks the worker to reload and review the month.

### 8. Inspecting historical months

The detail page's month selector starts on the current month, followed by all
stored months in descending order. The current-month summary remains visible
while viewing an older month. Each selected record shows its stored amount,
status, paid date, recording admin and note when present. The previous 100-record
display cap was removed so older recorded months remain accessible.

### 9. Independence from weekly commission payments

The formula remains exactly `commissions − payments − subscriptions = balance`.
Status updates do not write `DriverPayment`, alter the monthly amount, or adjust
the balance. Weekly settlements, a zero balance and driver credit never imply
subscription payment. Marking paid is an operational receipt confirmation for an
already stored monthly charge; it does not add another financial deduction.

### 10. Current-month presentation

| Surface | Presentation |
| --- | --- |
| Drivers | Small month/status text beneath driver metadata; success for Paid, warning for Unpaid and neutral text for Unverified or missing-record explanations. |
| Driver detail | Monthly subscription section directly after financial summary; current month and amount always visible, with month history and payment controls. |
| Pending page | Existing four columns retained; stored subscription amount with explicit Spanish status beneath it. The page identifies the subscription month and explains independence from commission balances. |
| Pending PDF | Four columns retained: CONDUCTOR, LICENCIA, SUSCRIPCIÓN, PENDIENTE. Amount plus PAGADO, PENDIENTE, SIN VERIFICAR or the missing-record explanation. Month context appears near the header. |
| Credits | A–Z ordering retained with its compact three-column presentation. The optional subscription indicator was not added here. |

The existing navy, yellow, emerald, warning colors, cards and controls are reused.
All states have text; none relies on color alone. UI UX Pro Max guidance was used
for compact status text, feedback, confirmation and mobile controls.

### 11. Authorization and audit

The new PATCH route reuses driver ADMIN access checks. It rejects anonymous
requests with 401 and non-admins with 403. The transaction also rechecks the
actor's current database role, preventing a stale ADMIN session from authorizing
a user whose database role has changed. A subscription must belong to the driver
in the route. Client-supplied amount, recording-user and unexpected fields are
rejected.

Each effective update and its ActivityLog entry commit in one transaction. Audit
metadata records driver, month, old/new status, paid date, recorder, note and
revision, with the acting admin's email. An audit write failure rolls back the
status update. Changes are visible through the existing Activity log; reversal
does not delete earlier evidence.

### 12. Tests and validation

All completed successfully:

| Check | Result / coverage |
| --- | --- |
| `npm run test:driver-order` | 4 passed: case/accents, licence/ID ties, filtered order, pagination, reports and shared producers. |
| `npm run test:subscription-payment-input` | 3 passed: strict civil dates, fields, notes, revisions, authorization before DB access and record/eligibility display states. |
| `npm run test:subscription-payments` | Disposable PostgreSQL integration passed: legacy preservation, defaults, uniqueness, rates/history, inactive/exempt handling, paid metadata, idempotency, undo/audit, stale/concurrent updates, role enforcement and forced audit-failure rollback. |
| `npm run test:driver-subscriptions` | Existing disposable-DB subscription integration passed. |
| `npm run test:driver-balance-reports` | 6 passed; totals, sign handling, search and alphabetical report order. |
| `npm run test:pending-commissions-pdf` | 10 passed; Decimal totals, states, pagination, labels and final-page total. |
| `npm run test:assistant-driver-finance` | 9 passed. |
| `npm run test:assistant-commission-actions` | Passed. |
| `npm run test:assistant-driver-actions` | Passed. |
| `npm run test:assistant-driver-import` | 21 passed, including after the import review sorting change. |
| `npm run typecheck` | Passed. |
| `npm run lint` | Passed without lint warnings. |
| `npm run build` | Passed, including the final repeat after the import review presentation change. |
| `git diff --check` | Passed. |

Browser tests exercised the production build with synthetic data and a locally
signed test session through the normal access guards: A–Z lists/search, all three
driver dropdowns, previous-month selection, cancel confirmation, mark paid, paid
date/admin display, PDF download, undo, and 401/403/409/invalid-field API responses.
The browser flow produced two audit records, retained August's UNVERIFIED record,
and left the number of ordinary driver payments at one. Pending page and downloaded
PDF both showed €755.20; the chosen driver's balance stayed €125.00 when marked paid.

### 13. Responsive and PDF QA

Actually inspected Drivers, driver detail, Pending, Credits, subscription history
and payment forms at **360, 390, 430 and 1280px**. All 16 route/viewport checks
passed without page overflow or browser errors. Long names/licences wrapped,
actions fit, and status text stayed distinct from balances.

The rendered assistant import review component was also checked at all four
widths: names were A–Z inside review groups, ambiguous-name fallbacks remained
readable, and the original draft row order was unchanged.

Rendered and visually inspected every page of the one-page downloaded report,
the 36-driver two-page fixture, and the 85-driver five-page fixture. Checked long
names/licences, statuses, large amounts, page breaks, repeated headers and the
single final total. PDFs are fixed A4 exports, independent of browser viewport.

Temporary screenshots, synthetic fixtures, browser scripts and PDFs are under
`/private/tmp/taxi-subscription-qa/`. They are QA artifacts, not production records.

### 14. Migration status and deployment limitation

The new migration successfully applied with Prisma migrate deploy to the
disposable local `taxi_subscription_upgrade_test` database. A seeded pre-change
record retained its ID, €12.34 amount and monthly identity and became UNVERIFIED.
New records defaulted to UNPAID. PostgreSQL constraints and concurrency behavior
were exercised in integration tests.

A separate attempt to replay the repository's complete existing migration chain
against an empty test database failed at
`20260809120000_add_driver_commission_foundation`: the historical baseline did not
create `Reservation`, which that migration expects. To test this additive upgrade,
a second disposable database was created from the pre-change schema, its prior
migrations were baselined locally, then the new migration was deployed normally.
This proves the upgrade from the prior schema; it does **not** claim a clean
full-history bootstrap works. Historic migrations were not altered.

No production migration, reset, `db push`, data mutation, commit, push or deployment
was performed. Applying the additive migration is required before running this
version against an existing database. The unrelated historical baseline issue
should be addressed separately when supporting a fresh-database installation.

### 15. Remaining business questions and known behavior

No business decision blocks this implementation. The legacy-state question was
resolved by the user's choice of UNVERIFIED until reviewed.

The existing scheduled batch remains responsible for creation. An eligible driver
added after the monthly run, or a missed batch, can have no record for that month;
the UI says Not generated and does not offer to mark a nonexistent row paid. There
is no new automatic catch-up, historical eligibility inference or cron behavior.
Inactive drivers retain reviewable historical records and receive no new charges
under the existing rule. Production cron health and environment configuration
were not checked or changed.

### 16. Working-tree change summary

`git diff --stat` (tracked files; new files listed separately below):

```text
 package.json                                       |  3 ++
 prisma/schema.prisma                               | 37 ++++++++-----
 scripts/render-pending-commissions-pdf-fixture.mts |  3 ++
 scripts/test-driver-balance-reports.mts            |  7 +--
 scripts/test-pending-commissions-pdf.mts           |  7 ++-
 src/app/api/drivers/full-ledger-pdf/route.ts       |  3 +-
 src/app/commissions/page.tsx                       |  3 +-
 src/app/drivers/[id]/page.tsx                      | 60 +++++++++-------------
 src/app/drivers/page.tsx                           |  8 ++-
 src/app/payments/page.tsx                          |  3 +-
 src/app/reservations/[id]/edit/page.tsx            |  3 +-
 src/components/assistant/DriverImportDraftCard.tsx |  8 ++-
 src/components/drivers/DriverBalanceList.tsx       |  9 ++--
 src/components/drivers/DriverBalancePage.tsx       |  2 +-
 src/components/drivers/DriversList.tsx             |  6 ++-
 src/lib/drivers/assistant-finance-repository.ts    |  8 +--
 src/lib/drivers/balanceReport.ts                   | 16 ++----
 src/lib/drivers/duePdf.ts                          | 18 +++++--
 src/lib/drivers/import-prisma.ts                   |  5 +-
 src/lib/drivers/overview.ts                        |  7 ++-
 20 files changed, 126 insertions(+), 90 deletions(-)
```

Eleven additional new files, not included by unstaged `git diff --stat`:

```text
DRIVER_SUBSCRIPTION_STATUS_REPORT.md
prisma/migrations/20260905180000_driver_subscription_payment_status/migration.sql
scripts/test-driver-order.mts
scripts/test-subscription-payment-input.mts
scripts/test-subscription-payments.mjs
src/app/api/drivers/[id]/subscriptions/[subscriptionId]/route.ts
src/components/drivers/SubscriptionHistory.tsx
src/components/drivers/SubscriptionStatusBadge.tsx
src/lib/drivers/driverOrder.ts
src/lib/drivers/subscriptionPaymentCore.ts
src/lib/drivers/subscriptionStatus.ts
```
