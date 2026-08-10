# Changelog

Notable project changes are recorded here in reverse chronological order.

## 2026-08-10

### Added

- Added nullable `Driver.vehicleType` (`VAN`/`SEDAN`) and the `subscriptionExempt` flag; new-driver workflows require a vehicle while existing drivers remain safely unconfigured until edited.
- Added the separate `DriverSubscriptionCharge` model with Decimal amounts, PostgreSQL month dates, restrictive driver history, a month index, and a unique driver/month constraint.
- Added centralized monthly rates (`VAN` €20.00, `SEDAN` €7.00) and eligibility rules for ACTIVE, non-exempt, configured drivers.
- Added the idempotent monthly generation service and protected `GET /api/admin/driver-subscriptions/run-monthly` handler using `CRON_SECRET` Bearer authorization.
- Added Vercel Cron configuration for `0 0 1 * *` and best-effort subscription charge/batch activity events.
- Added a disposable-local-PostgreSQL subscription integration test covering rates, skips, duplicate execution, month changes, immutable history, balance math, uniqueness, and restrictive deletion.

### Changed

- Extended the centralized driver balance to `commissions - payments - subscription charges` using Prisma Decimal.
- Added subscription configuration, totals, and history to driver directory/detail/edit screens and monthly subscription totals to the finance overview.
- Extended individual, due, and full driver PDFs with subscription totals/history and final subscription-adjusted balances.

### Database

- Added the additive `20260810120000_add_driver_subscriptions` migration.
- Existing commission and payment records are not reinterpreted, and no external/standalone ledger history is claimed as migrated.

## 2026-08-09

### Added

- Added the ADMIN-only Driver foundation: Driver records, ACTIVE/INACTIVE status, reservation assignment, reservation-linked commissions, manual commissions, payments, and Decimal balances.
- Added driver create/list/detail/edit/status workflows and commission/payment create/edit/delete APIs and pages.
- Added transactional reservation assignment and linked-commission synchronization with one linked commission maximum per reservation.
- Added the reservation-card Assign Driver shortcut and ADMIN-only assigned-driver/commission data for reservation details and WhatsApp sharing.
- Added `/drivers/overview`, `/commissions`, and `/payments`, plus ADMIN navigation and homepage driver-finance access.
- Added individual Driver Ledger, Due Commission, and Full Ledger PDFs, including direct ADMIN Full Ledger download from the homepage.
- Added manual commission pickup/drop-off context and shared route resolution across pages and PDFs.

### Changed

- Restructured Reservation Edit into Ride Details, Passenger & Journey, Booking & Operations, and ADMIN-only Driver & Commission sections without changing ownership or timezone semantics.
- Extended activity logging with driver, assignment, commission, and payment actions.

### Database

- Added `20260809120000_add_driver_commission_foundation` for Driver, CommissionEntry, DriverPayment, and `Reservation.driverId`.
- Added `20260809160000_unique_commission_reservation` to enforce at most one reservation-linked commission.
- Added `20260809210000_add_manual_commission_route` for editable manual route fields.
- Driver financial relations preserve history through `RESTRICT`; reservation assignment and commission reservation references use `SET NULL` where defined.

## 2026-07-06

### Added

- Added the additive `ActivityLog` Prisma model and migration, including indexes for creation time, user email, entity type, and action.
- Added best-effort structured activity logging for registration, login/logout, admin login and user-list access, plus reservation create, update, restore, soft-delete, bulk-delete, and permanent-delete flows.
- Added the protected `/activity-log` route with server-side ownership scoping, admin-wide visibility, search, entity filtering, and newest/oldest sorting.
- Added Activity Log links to desktop and responsive navigation for authenticated users.

### Security

- Normal users can query only activity associated with their own normalized session email; admins can view all activity only after a server-side role check.
- Activity metadata is intentionally limited to operational fields and never includes passwords, auth secrets, full tokens, or session payloads.
- Activity writes are best-effort: failures are reported to server logs without breaking the originating user action.

## 2026-07-02

### Changed

- Hardened native date, time, and `datetime-local` controls globally for reliable iOS Safari height, alignment, value rendering, and picker visibility.
- Added conservative production security headers for frame denial, MIME sniffing prevention, referrer control, and unused device permissions.

### Documentation

- Added `PROJECT_AUDIT.md` with architecture, routes, data flow, operations, risks, protected areas, and QA guidance.

### Safety

- No Prisma schema, migration, or database changes.
- No reservation CRUD or timezone conversion logic changes.
