# Changelog

Notable project changes are recorded here in reverse chronological order.

## Unreleased

### Documentation

- Added `DRIVER_COMMISSION_PARITY_AUDIT.md`: a capability-parity audit of the driver/commission surface against the legacy `admin.bookataxibarcelona.com` (`admin-dashboard`) reference system. Verdict: Taxi Reserve is mostly feature-complete and materially exceeds the legacy system (Decimal money, RBAC, audit trail, concurrency safety, reservation integration, subscriptions, bulk import). Genuine gaps are one capability regression (on-screen "commission due" list is now PDF-only), a set of small worker conveniences (filtered-row totals, date filters, unpaid quick filter, booking-reference tag, driver phone/notes), and one out-of-scope legacy module (facturación / driver self-invoicing). No production code changed.

### Added

- Added the feature-flagged Phase 1B Taxi Reserve Assistant frontend shell for authenticated navigation, with the supplied portrait launcher, responsive modal UI, typed message parts, reservation-card presentation, composer interaction architecture, focus restoration, and pinned transcript scrolling.
- Added a development-only, no-live-data fixture preview for empty, conversation, thinking, searching, reservation-card, long-content, error/retry, and stopped-response states.
- Added dependency-free Phase 1B.1 tests and a physical-device QA runbook for mobile viewport, keyboard, safe-area, scroll, input, and accessibility verification.
- Added the authenticated `POST /api/assistant/chat` foundation with a lazy server-only official OpenAI Responses client, bounded request validation, hard timeout/cancellation propagation, request IDs, safe errors, and privacy-conscious metadata logs.
- Added deterministic owner-scoped reservation read services, minimized role-aware AI DTOs, strict `search_reservations` and `get_reservation` schemas, and a shared Europe/Madrid calendar boundary module.
- Added dependency-free Phase 1C.1 trusted-boundary tests covering authorization, search filters, result limits, strict tool schemas, DST-aware dates, transport validation, aborts, timeouts, errors, and server-only configuration.
- Added the Phase 1C.2 Responses function-tool loop with a hardcoded two-tool reservation registry, server-revalidated arguments, server-provided Madrid context, four-call limit, and permission-safe minimized outputs.
- Added a typed application-owned assistant SSE protocol for status, coalesced text deltas, structured reservation cards, completion, and safe errors.
- Added deterministic Phase 1C.2 tool-loop and streaming-state suites covering ambiguity, no/inaccessible results, unknown/malformed calls, authorization boundaries, prompt injection data, call limits, interrupted streams, Stop, Retry, context limits, and duplicate cards.
- Added the Phase 1D ADMIN-only `search_drivers`, `get_driver_ledger_summary`, and `get_driver_transactions` tools to the existing hardcoded loop, with strict closed schemas, permission-safe USER failures, bounded cursors, explicit read projections, and minimized AI DTOs.
- Added application-owned driver, financial-summary, and transaction stream events plus narrow-screen cards, existing driver/reservation deep links, long-content fixtures, and duplicate-event protection.
- Added deterministic Phase 1D finance and tool-loop suites covering canonical Decimal totals, due/settled/credit classification, subscription-exempt history, driver ambiguity, civil-date periods, typed transactions, pagination, authorization-before-fetch, exact registry boundaries, and absence of repository writes.
- Added Phase 1E per-canonical-user admission control with one active generation, a rolling configurable request cap, stable `RATE_LIMITED`/`Retry-After` responses, cancellation-safe lease release, and an optional server-side email rollout allowlist.
- Added centralized assistant input/output cost ceilings, provider token-usage/result-count telemetry, privacy-preserving hashed OpenAI safety identifiers, hardened no-store response headers, and a production hardening suite.
- Added the Phase 1E release runbook with deployment configuration, controlled rollout, read-only smoke/evaluation cases, monitoring, kill switch, rollback, and physical-device release gate.

### Changed

- Increased the confirmed ADMIN driver-import capacity from 48 to 100 unique normalized Driver records after source and identity deduplication, with bounded durable-draft and pending-action envelopes sized for the larger batch.
- Hardened the assistant as a mobile full-screen workspace with coalesced Visual Viewport enhancement, offset-aware sizing, rotation recovery, four-sided safe areas, iOS-safe body locking, and keyboard-aware bottom padding.
- Added explicit idle/submitting/generating/failed request states, synchronous duplicate-submit protection, mobile multiline Return behavior, composition tracking, stable transcript anchoring, and memoized message rendering.
- Reused the shared Madrid date helper for driver financial date derivation without changing persisted financial-date semantics.
- Connected the persistent mobile provider to the real authenticated endpoint while retaining Phase 1B.1 keyboard, viewport, draft, duplicate-send, and pinned-scroll behavior.
- Wired Stop to browser/server/OpenAI cancellation and Retry to the same failed turn without duplicating its user bubble or structured results.
- Reused the shared ADMIN predicate, canonical driver financial summaries, and existing Madrid financial periods for Phase 1D; authoritative money remains server-calculated Decimal strings in EUR.
- Updated Next within 15.x, NextAuth within 4.x, Mailparser within 3.x, and only compatible direct/transitive security patches; final npm audit is zero advisories and the credential/JWT and inbox/reply architectures remain unchanged.

### Safety

- The assistant still defaults to off. Phase 1E sends only owner-scoped reservation DTOs and ADMIN-authorized minimized driver/finance DTOs through the same five approved read-only tools, exposes no unrestricted Prisma/SQL access, adds no write tool, changes no Prisma schema, and does not redesign the Phase 1B.1 mobile shell.

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
