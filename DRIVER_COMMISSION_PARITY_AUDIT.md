# Driver & Commission — Capability-Parity Audit

**Legacy reference system:** `admin.bookataxibarcelona.com`
→ source at `/Users/venom/Desktop/bookataxi/admin-dashboard` (GitHub `insidedopamineacademy-cmd/bookataxibarcelona`, package `admin-dashboard`, last commit `1502ec4` 2026‑07‑06).

**New authoritative system:** Taxi Reserve
→ source at `/Users/venom/Desktop/taxi-reserve` (GitHub `insidedopamineacademy-cmd/taxi-reserve`, last commit `bd18e09` 2026‑08‑12).

**Audit date:** 2026‑08‑18 · **Method:** code/route/model/migration/test inspection of both repositories, end‑to‑end workflow reconstruction, financial‑semantics reconciliation. No production code was changed.

**Framing (per clarification):** This is a *capability‑gap* audit, not an implementation comparison. Taxi Reserve is treated as the authoritative modern platform and is expected to be better engineered. The legacy app is a **product‑requirements archive** used to discover worker capabilities that may have been left behind. Recommendations are native Taxi Reserve extensions — never legacy code ports.

---

## A. Executive Summary

**Verdict: Taxi Reserve is mostly feature‑complete and materially exceeds the legacy system on architecture, financial correctness, auditability, concurrency safety, and reservation integration. The workers' claim ("many functions are missing") is only partially correct — and mostly at the level of small operational conveniences and one on‑screen report, not core capability.**

The core driver/commission worker loop that the legacy app supported is fully present and *safer* in Taxi Reserve:

- create/edit/deactivate drivers, record commissions, record payments, see per‑driver balances, see company‑wide due/credit/net totals, download a due report and a per‑driver ledger PDF — all present.
- Money is computed in `Prisma.Decimal` end‑to‑end (legacy summed JS floats via `toNumber`). Every financial mutation is authorization‑checked server‑side and written to an immutable `ActivityLog` with the acting user and changed fields (legacy had **no** audit trail and a single shared admin login). Reservation↔driver↔commission changes run in a transaction with optimistic‑concurrency guards (legacy had none).

**What is genuinely missing or degraded** falls into three buckets:

1. **One capability regression (Medium):** the legacy on‑screen "Total Commission Due" list (drivers with a positive balance + grand total, browsable in the UI) exists in Taxi Reserve **only as a downloadable PDF** — there is no filterable on‑screen "who owes us" view.
2. **A cluster of small worker conveniences** that neither app had *strongly*, but which the legacy app hinted at and workers value: filtered totals, date/month filters on ledgers, an on‑screen unpaid view, per‑driver "jobs this month," a booking‑reference tag on manual commissions, and an explicit balance‑adjustment line type.
3. **One legacy module that is entirely absent: driver self‑invoicing / facturación** (Spanish IVA invoices, `DRIVER_PUBLIC_FORM`). This is a distinct billing/accounting concern outside the dispatch commission ledger and needs a business/scope decision, not a like‑for‑like restore.

**Financial‑semantics flag (needs business confirmation, not a regression):** both systems model the ledger as *"driver owes the company"* (commissions + subscriptions as debits, payments as credits). Neither cleanly models a **payout the company owes a driver** for a prepaid/card fare. This shared limitation should be confirmed as intended (payouts handled outside this ledger) or scoped as a new credit line type.

---

## B. Legacy Capability Count

Discovered legacy capabilities in the driver/commission surface (excluding the separate facturación module): **~34**.

| Disposition | Count | Notes |
|---|---:|---|
| **Full parity** | 18 | Same worker outcome, often via a cleaner workflow |
| **Improved** | 9 | Decimal money, RBAC, audit log, concurrency, reservation link, subscriptions, timezone‑correct periods |
| **Partial / UX regression** | 3 | On‑screen due list → PDF‑only; unlimited ledger history → capped at 100 rows on the detail page; commission `bookingReference` field dropped |
| **Missing** | 2 | Facturación / driver self‑invoicing module; hard‑delete of a driver (intentionally removed — see Obsolete) |
| **Obsolete / legacy anti‑pattern** | 2 | Driver hard‑delete with cascade (destroys financial history); single shared admin credential |

Net: the legacy system is **not** substantially more capable. It is a simpler standalone manual ledger + a Spanish invoicing module. Taxi Reserve reproduces the ledger and improves nearly every part of it, at the cost of a few conveniences and the invoicing module.

---

## C. How the two systems actually work (reconstructed workflows)

### Legacy (`admin-dashboard`)
A standalone manual ledger. **It has no reservations at all.** A single shared admin (env `ADMIN_USERNAME`/`ADMIN_PASSWORD`, HMAC cookie — `lib/auth/session.ts`, `lib/auth/actions.ts`) logs in and:

- **Drivers** (`app/dashboard/drivers`): create (name + unique `licenseNumber`), inline‑edit name/license/status, Activate/Deactivate, hard‑**Delete** (transactionally deletes the driver *and all their commissions and payments* — `lib/actions/drivers.ts:98`), name search, status badge, "View Ledger".
- **Commissions** (`app/dashboard/commissions`): add a commission = **manually typed euro amount** the driver owes for a job, with date, driver, pickup, dropoff, `bookingReference`, notes. Inline edit / delete each entry. Newest first. **No percentage anywhere.**
- **Payments** (`app/dashboard/payments`): record a payment the driver made (date, amount, method CASH/BANK/OTHER, notes). Inline edit / delete.
- **Overview** (`app/dashboard/page.tsx`): Total Commission Due, Driver Credits, Net Position, Collected This Week/Month, Active Drivers, recent commissions/payments, and a full **Driver Balances** table.
- **Total Commission Due** (`app/dashboard/commissions/due`): on‑screen table of drivers with `balance > 0` + grand total + Download PDF.
- **Driver ledger** (`app/dashboard/drivers/[id]`): totals + full commission history + full payment history + Download Ledger PDF.
- **Balance math** (`lib/queries/shared.ts`): `balance = Σcommissions − Σpayments`, computed **dynamically** (no stored running balance, no settlement records, no history of who changed what). Summed with `toNumber()` → **JS floating point**.
- **Facturación** (`app/dashboard/facturacion`, `app/driver-invoice`): full Spanish IVA (10%) invoicing — `BillingSettings`, `Invoice`, `InvoiceServiceLine`, invoice numbering series, invoice PDFs, and a **public driver form** where drivers self‑generate an invoice to bill the company (`source = DRIVER_PUBLIC_FORM`, `lib/actions/driver-invoices.ts`).

### New (Taxi Reserve)
A full reservation platform with an integrated driver ledger, driver subscriptions, an AI assistant, an activity log, and an email inbox. Real auth: NextAuth with `Role { USER, ADMIN }`; every driver/commission/payment page and API route is gated by `getDriverAdminAccess()` / `requireDriverAdminPage()` requiring `role === "ADMIN"` (`src/lib/drivers/access.ts`).

- **Drivers** (`src/app/drivers`, API `src/app/api/drivers`): create/edit driver = name, `licenseNumber` (**not unique** — identity is the case‑insensitive `name`+`licenseNumber` pair; migration `20260812180000_allow_shared_driver_license_numbers`), `vehicleType {VAN,SEDAN}`, `subscriptionExempt`, status. **No hard delete** — status → INACTIVE only (history preserved).
- **Commissions**: created two ways — (a) **manually** against a driver (`POST /api/drivers/[id]/commissions`), or (b) **reservation‑linked** when a driver is assigned to a reservation with a commission amount (`changeOwnedReservationDriverAndCommission`, `src/lib/reservations/commission-aware-assignment-core.ts`). Still a **manually entered euro amount** — no percentage. `CommissionEntry.reservationId` is unique (one commission per reservation).
- **Payments**: `POST /api/drivers/[id]/payments` (active driver required), method CASH/BANK/OTHER.
- **Subscriptions** (new): monthly charge per active, non‑exempt driver with a vehicle type — VAN €20 / SEDAN €7 (`src/lib/drivers/subscriptionCore.ts`), idempotent per `(driverId, chargeMonth)`, run by a bearer‑secured cron.
- **Overview** (`src/app/drivers/overview`): Total Commission Due, Driver Credits, Net Position, Collected This Week/Month, **Subscriptions This Month**, Active Drivers, recent commissions/payments, Download Due PDF. Periods computed in **Europe/Madrid** (`src/lib/drivers/overview.ts`, `financialDateCore.ts`) — legacy used server‑local dates.
- **Driver ledger** (`src/app/drivers/[id]`): summary (commissions / payments / subscriptions / outstanding) + commission history + payment history + subscription history + Ledger PDF. History lists use `take: 100` (balance uses a full aggregate, so it stays correct).
- **Balance math** (`src/lib/drivers/financialMath.ts`): `balance = Σcommissions − Σpayments − ΣsubscriptionCharges`, `Prisma.Decimal` throughout. Company position: positive balances → "Total Commission Due", negative → "Driver Credits".
- **Audit**: `logActivity(...)` on every create/update/delete with `userEmail` + `changedFields` (`src/lib/activityLog.ts`, surfaced at `/activity-log`, admin sees all, non‑admins scoped to their own).
- **Concurrency**: reservation/driver/commission mutations run inside `prisma.$transaction` with a guarded `update … where { updatedAt, driverId, commissionEntries }` that returns a conflict (P2025) instead of silently overwriting (`commission-aware-assignment-prisma.ts`).
- **No facturación** — 0 references to invoice/factura/IVA/BillingSettings anywhere in `src`.

---

## D. Financial semantics (understood exactly)

**Business meaning (identical in both systems):**
- A **commission entry** is a euro amount the **driver owes the company** for a job. It is entered by a worker; there is **no percentage engine** in either system (the only "rate" anywhere is the new fixed monthly subscription).
- A **subscription charge** (new only) is a euro amount the driver owes the company for the month.
- A **payment** is a euro amount the **driver paid the company** (method = how they paid).
- **Balance > 0** ⇒ driver owes the company. **Balance < 0** ⇒ company holds a credit for the driver (overpayment).

**Worked example — €100 booking, 20% commission, CASH:**
Neither system stores "€100" or "20%". A worker computes €20 and records it as the commission the driver owes.
- Driver keeps: €80 (collected €100 cash from the passenger, owes €20 to the office).
- Driver owes company: **€20**. Company owes driver: €0. Balance change: **+€20**.
- Driver later pays €20 cash → `DriverPayment €20 (CASH)` → balance **€0**.
- Legacy: standalone commission entry. New: same amount, but linked to the reservation, audited, Decimal‑exact. **Business outcome identical.**

**Worked example — €100 booking, 20% commission, CARD/PREPAID:**
The company already collected €100 by card; the driver is owed their €80 fare share.
- In **both** systems the commission ledger only expresses "driver owes company €20." There is **no first‑class way to post the €80 the company owes the driver** (no negative/credit line type; `parsePositiveMoney` rejects ≤ 0 in the new system, `min 0.01` in legacy).
- Consequence: prepaid‑fare payouts to drivers are **out of scope of this ledger in both systems** — presumably settled elsewhere. **⚠ Flag for business confirmation.** If payouts must live here, add an explicit credit/adjustment line type (see P0/P2 below). This is **not a regression** — it is a shared, pre‑existing limitation.

**Precision:** legacy stored `Decimal(10,2)` but aggregated with `toNumber()` (float) — accumulation error is possible on large ledgers. New keeps `Prisma.Decimal` through summation and formatting (`financials.ts`, `formatEuro`). **New is strictly more correct.**

---

## E. Feature‑Parity Matrix (capability level)

| Area | Legacy capability | Taxi Reserve equivalent | Status | Severity | Evidence |
|---|---|---|---|---|---|
| Driver create | Name + unique license | Name + license (+ vehicleType, subscriptionExempt); identity = name+license pair | IMPROVED | — | `api/drivers/route.ts`, `profile-core.ts` |
| Driver edit | Inline name/license/status | Dedicated edit + PATCH, field‑level change tracking + audit | IMPROVED | — | `api/drivers/[id]/route.ts:34` |
| Driver activate/deactivate | Toggle button | Status button + audit (`driver_activated/deactivated`) | FULL | — | `api/drivers/[id]/route.ts:191` |
| Driver **delete** | Hard delete + cascade of all commissions/payments | **None** (deactivate only) | OBSOLETE (safer) / MISSING (destructive path intentionally dropped) | Low | legacy `actions/drivers.ts:98`; new has no DELETE |
| Driver search | By name | By name **or** license | IMPROVED | — | `DriversList.tsx:24` |
| Driver status badge | Yes | Yes | FULL | — | `DriverStatusBadge.tsx` |
| Add commission (manual €) | Date/driver/€/pickup/dropoff/**bookingRef**/notes | Date/€/pickup/dropoff/notes (**no bookingRef**), active‑driver required, audited | PARTIAL | Low | `CommissionForm.tsx`; legacy `commissions/page.tsx:84` |
| Edit / delete commission | Inline, no audit | Dedicated edit + PATCH/DELETE, audited | IMPROVED | — | `api/drivers/[id]/commissions/[commissionId]/route.ts` |
| Commission ↔ reservation link | N/A (no reservations) | First‑class, transactional, concurrency‑guarded | IMPROVED (new capability) | — | `commission-aware-assignment-*.ts` |
| Percentage / rate commission | None | None | FULL (neither has it) | — | grep: no rate logic |
| Record payment | Date/€/method/notes | Same + active‑driver check + audit | IMPROVED | — | `api/drivers/[id]/payments/route.ts` |
| Payment method (cash/bank/other) | Yes | Yes | FULL | — | both schemas |
| Per‑driver balance | Σcomm − Σpay (float) | Σcomm − Σpay − Σsub (Decimal) | IMPROVED | — | `financialMath.ts` |
| Per‑driver ledger view | Full commission + payment history | Commission + payment + **subscription** history + summary; **capped at 100 rows** | PARTIAL | Low | `drivers/[id]/page.tsx:50` |
| Company totals (due/credit/net) | Yes | Yes + Subscriptions This Month | IMPROVED | — | `overview.ts` |
| Collected this week/month | Yes (server‑local dates) | Yes (**Madrid** tz) | IMPROVED | — | `overview.ts:37` |
| **On‑screen "Total Commission Due" list** | On‑screen table + total + PDF | **PDF only** (no on‑screen due list) | REGRESSION | Medium | new: only `api/drivers/due-pdf`; no `/drivers/due` route |
| Due report PDF | Yes | Yes | FULL | — | `due-pdf/route.ts`, `pdf.ts` |
| Driver ledger PDF | Yes | Yes (+ full‑ledger PDF) | FULL/IMPROVED | — | `api/drivers/[id]/ledger-pdf`, `full-ledger-pdf` |
| Recent commissions/payments feed | Yes | Yes (clickable driver links) | IMPROVED | — | `overview/page.tsx` |
| Commission list search | None | Driver/pickup/dropoff/date | IMPROVED | — | `CommissionsList.tsx` |
| Payment list search | None | Driver/method | IMPROVED | — | `PaymentsList.tsx` |
| Filtered‑row totals | None | None | FULL (neither) — enhancement | Medium | — |
| Date/month range filter on ledgers | None | None | FULL (neither) — enhancement | Medium | — |
| Sortable columns / pagination | None (loads all) | None (loads all) | FULL (neither) — scale risk both | Low | — |
| CSV/Excel export | None (PDF only) | None (PDF only) | FULL (neither) | Low | — |
| Settlement objects / select‑jobs‑to‑settle / partial settlement | **None** (net‑balance only) | **None** (net‑balance only) | FULL (neither — never existed) | — | both use running balance |
| Reverse/correct a payment | Edit/delete (no trail) | Edit/delete (audited) | IMPROVED | — | payments API |
| Manual balance **adjustment** line type | None (add commission/payment) | None (add commission/payment) | FULL (neither) — enhancement | Medium | — |
| Permissions / RBAC | Single shared login | NextAuth USER/ADMIN, server‑side on every route | IMPROVED | — | `access.ts`, `access-core.ts` |
| Audit trail (who/when/what) | **None** | `ActivityLog` on all mutations + `/activity-log` UI | IMPROVED | — | `activityLog.ts`, `activity-log/page.tsx` |
| Concurrency / double‑submit safety | None | Transactional + optimistic‑concurrency guards | IMPROVED | — | `commission-aware-assignment-prisma.ts:193` |
| Bulk driver import | **None** | Free‑text parser, vehicle classifier, dup/conflict detection, 100‑row cap, review loop | IMPROVED (new capability) | — | `import-core.ts` |
| Driver subscriptions | None | Monthly VAN €20 / SEDAN €7, idempotent, cron | IMPROVED (new capability) | — | `subscriptionCore.ts` |
| Reservation reassignment + commission move | N/A | First‑class, audited, concurrency‑safe | IMPROVED (new capability) | — | `reservations/[id]/route.ts:161` |
| **Facturación (admin invoices)** | Full IVA invoicing + PDF + numbering | **Absent** | MISSING (out of scope) | Scope decision | legacy `actions/invoices.ts`; new: 0 refs |
| **Driver self‑invoice public form** | Drivers self‑bill company (IVA) | **Absent** | MISSING (out of scope) | Scope decision | legacy `driver-invoice/`; new: 0 refs |
| Automated tests for finance | **None** | Node `--test` suites for finance/import/commission/assignment | IMPROVED | — | `scripts/test-*.mts` |

---

## F. Worker Task Matrix

| Worker task | Legacy | Taxi Reserve | Gap | Importance | Recommended TR solution |
|---|---|---|---|---|---|
| "See everything Driver X owes us." | Driver ledger totals | Driver ledger: commissions+subs−payments = outstanding | **None** | — | Already covered |
| "Driver X gave me €300 cash — record it." | Add payment | `Record payment` (CASH) on driver, audited | **None** | — | Already covered |
| "This booking has a special commission." | Type the € amount | Enter € when assigning driver, or manual commission | **None** | — | Already covered (custom € per job) |
| "I assigned the wrong driver." | N/A (no reservations) | Reassign on reservation; commission moves with it, audited | **None (improved)** | — | Already covered |
| "Which drivers haven't settled / who owes cash?" | On‑screen Due list + total | **PDF only** — no on‑screen view | **Partial** | **High** | Add `/drivers/due` on‑screen list (reuse `getDriverBalanceLines`) |
| "All jobs Driver X completed last month." | Ledger (all rows, no date filter) | Ledger capped at 100, no date filter | **Partial** | Medium | Add month/date filter to driver ledger + commissions list |
| "Why did this driver's balance change?" | Not answerable (no audit) | `/activity-log` filtered by driver/entity | **None (improved)** | — | Already covered |
| "Correct a mistake from yesterday." | Edit/delete (no trail) | Edit/delete, audited | **None (improved)** | — | Already covered |
| "Total of the rows I'm looking at." | No filtered totals | No filtered totals | **Missing (both)** | Medium | Add sum‑of‑filtered footer to lists |
| "Export this month's commissions." | PDF only | PDF only | **Missing (both)** | Medium | Add CSV export endpoint |
| "Company prepaid this fare — pay the driver their share." | Not modeled | Not modeled | **Missing (both)** | **Confirm** | Business decision → optional credit line type |
| "Add/verify a driver's phone to call/WhatsApp them." | No driver phone | No driver phone (reservations have phone) | **Missing (both)** | Medium | Add `phone`/`notes` to Driver profile |
| "Import the whole driver list at once." | Manual only | Bulk import (≤100) | **None (improved)** | — | Already covered |

---

## G. Small Missing Features / Worker Conveniences

Ranked by frequency × implementation size (High‑frequency + Tiny = do first).

| # | Convenience | Frequency | Impl. size | Legacy had it? | Notes |
|---|---|---|---|---|---|
| 1 | On‑screen "who owes us" (due) list, not just PDF | High | Small | Yes (regressed) | Reuse `getDriverBalanceLines()` + a page like `/drivers/overview` |
| 2 | Sum‑of‑filtered‑rows footer on commissions/payments/ledger | High | Tiny | No | Compute from the already‑filtered client array |
| 3 | Month / date‑range filter on driver ledger + commissions list | High | Small | No | Client filter or query param |
| 4 | "Unpaid / owes cash" quick filter/badge on drivers list | High | Small | Partial (due page) | Derive from balance sign already loaded |
| 5 | Booking‑reference field on manual commissions | Medium | Tiny | Yes (dropped) | Add nullable `bookingReference` column + form field |
| 6 | Driver `phone` (+ tel/WhatsApp shortcut) and `notes` on profile | Medium | Small | No | New Driver fields; reuse `phoneActions.ts` |
| 7 | Search commissions/payments by amount and notes | Medium | Tiny | No | Extend the existing client filter arrays |
| 8 | Raise the 100‑row cap on the driver ledger detail (or paginate) | Medium | Small | Yes (unlimited) | Balance already correct; only display is capped |
| 9 | CSV export of commissions/payments for a period | Medium | Small | No | New route returning `text/csv` |
| 10 | Explicit balance **adjustment** line type (+/−, reason, audited) | Occasional | Medium | No (worked around) | Cleaner than fake commission/payment |
| 11 | Guarded driver delete (only when zero financial records) | Occasional | Small | Yes (unsafe) | Safe replacement for legacy cascade delete |
| 12 | Sortable columns / pagination on large lists | Occasional | Medium | No | Scale hardening for both lists |

---

## H. Opportunity Matrix (Worker Value vs Implementation Cost)

| Feature | Worker value | Frequency | Impl. cost | Risk | Recommendation |
|---|---|---|---|---|---|
| On‑screen due list (#1) | High | High | Small | Low | **Do first** |
| Filtered‑row totals (#2) | High | High | Tiny | Low | **Do first** |
| Date/month ledger filter (#3) | High | High | Small | Low | **Do first** |
| Unpaid quick filter (#4) | High | High | Small | Low | **Do first** |
| Booking‑reference on commission (#5) | Medium | Medium | Tiny | Low | Quick win |
| Driver phone/notes (#6) | Medium | Medium | Small | Low | Quick win |
| Amount/notes search (#7) | Medium | Medium | Tiny | Low | Quick win |
| CSV export (#9) | Medium | Medium | Small | Low | Batch with filters |
| Raise/replace 100‑row cap (#8) | Medium | Medium | Small | Low | Correctness‑adjacent |
| Adjustment line type (#10) | Medium | Low | Medium | Medium (financial) | Design carefully, audit |
| Prepaid payout / credit semantics | High (if needed) | Confirm | Medium | High (financial) | **Business decision first** |
| Facturación / driver self‑invoice | Depends | Low | Large | Medium | **Scope decision first** |

**Highest ROI (HIGH value + LOW cost): #1, #2, #3, #4, #5, #7.**

---

## I. FEATURES WE SHOULD ADD TO TAXI RESERVE

> Every item below is a **native extension** of current Taxi Reserve infrastructure (Prisma models, ADMIN‑gated API routes, `logActivity`, `Prisma.Decimal`, the existing list components and PDF/overview services). No legacy code is ported.

### P0 — Financial / Data Safety
- **Confirm prepaid/card payout semantics.** *Worker gain:* correct accounting when the company owes a driver for a prepaid fare. *Revealed by:* card/prepaid worked example — neither system models a payout. *Existing infra:* `DriverPayment`/`CommissionEntry`, `financialMath.ts`, audit. *Modern implementation:* **decision first**; if in scope, add a single signed **ledger adjustment/credit** line type (see P2 #10) rather than negative commissions. *Complexity:* Medium. *Deps:* business sign‑off. *Tests:* balance math with credits; overview due/credit split.
- **Guard the driver‑ledger 100‑row display cap.** *Worker gain:* never appear to "lose" old jobs on very active drivers. *Revealed by:* legacy showed unlimited history. *Existing infra:* `drivers/[id]/page.tsx` (balance already uses full aggregate — correctness is fine, only display truncates). *Modern implementation:* paginate or lazy‑load history; keep the aggregate balance. *Complexity:* Small. *Tests:* driver with >100 entries shows correct balance and reaches all rows.

### P1 — Essential Worker Features
- **On‑screen "Total Commission Due" list** (`/drivers/due`). *Worker gain:* see at a glance who owes and how much, without downloading a PDF. *Revealed by:* legacy `commissions/due` page (regressed to PDF‑only). *Existing infra:* `getDriverBalanceLines()`, `formatEuro`, `requireDriverAdminPage`, the `/drivers/overview` layout. *Modern implementation:* new ADMIN page filtering `summary.balance > 0`, sorted desc, grand total, link each row to the ledger; keep the existing Due PDF button. *Complexity:* Small. *Deps:* none. *Tests:* only positive balances shown; total equals PDF total.
- **Date/month filter on driver ledger + commissions/payments lists.** *Worker gain:* "Driver X's jobs last month," month‑end reconciliation. *Existing infra:* `getMadridFinancialPeriods`, list components. *Modern implementation:* month/range query params (server) or client filter reusing `dateSearch`. *Complexity:* Small. *Tests:* boundary dates in Madrid tz.
- **"Unpaid / owes cash" quick filter + badge on the drivers list.** *Worker gain:* isolate drivers who still owe. *Existing infra:* balances already loaded in `DriversList`. *Modern implementation:* client toggle on balance sign + a small badge. *Complexity:* Small. *Tests:* filter matches balance sign.

### P2 — High‑Value Convenience Features
- **Sum‑of‑filtered‑rows footer** on commissions, payments, and ledger lists. *Worker gain:* totals for exactly what's on screen. *Existing infra:* filtered array already in the client components; format with `Prisma.Decimal`‑derived strings server‑side or a small client accumulator. *Complexity:* Tiny. *Tests:* footer equals sum of visible rows.
- **Booking‑reference on manual commissions.** *Worker gain:* tag a commission to an external booking id. *Existing infra:* `CommissionEntry`, `CommissionForm`. *Modern implementation:* nullable `bookingReference` column (migration) + optional field, searchable. *Complexity:* Tiny. *Deps:* migration. *Tests:* create/edit/search by reference.
- **Driver `phone` + `notes` (with tel/WhatsApp shortcut).** *Worker gain:* contact a driver from their profile; internal notes. *Existing infra:* Driver model, `phoneActions.ts`. *Modern implementation:* two nullable columns + profile fields + reuse phone action buttons. *Complexity:* Small. *Deps:* migration. *Tests:* validation, render, activity log on change.
- **Search commissions/payments by amount and notes.** *Worker gain:* find a specific figure fast. *Existing infra:* client filter arrays. *Complexity:* Tiny. *Tests:* match on amount/notes.
- **CSV export of commissions/payments for a period.** *Worker gain:* hand data to accounting/Excel. *Existing infra:* ADMIN route pattern, PDF services as a model. *Modern implementation:* `GET …/export.csv?from&to` returning `text/csv`. *Complexity:* Small. *Tests:* row/columns/escaping; period bounds.
- **Explicit balance adjustment line type.** *Worker gain:* correct a balance transparently instead of faking a commission/payment. *Existing infra:* ledger + audit. *Modern implementation:* signed `LedgerAdjustment` (amount, reason, createdBy) folded into `calculateDriverFinancialSummary`. *Complexity:* Medium. *Risk:* financial — audit + tests mandatory. *Tests:* balance with adjustments; overview split.

### P3 — Nice‑to‑Have
- **Guarded driver delete** (only when the driver has zero commissions/payments/subscriptions) — safe replacement for legacy cascade delete. *Complexity:* Small. *Tests:* refuse delete when records exist.
- **Sortable columns / pagination** on large commission/payment lists. *Complexity:* Medium.
- **Facturación / driver self‑invoicing** — **scope decision required.** Legacy let drivers self‑generate IVA invoices to bill the company and let admins issue client invoices. This is a distinct accounting module, likely handled by external accounting today. *Recommendation:* confirm whether it must live in Taxi Reserve before any build; if yes, design natively (Invoice model + numbering + PDF service + ADMIN/authenticated driver flow), do **not** port legacy code. *Complexity:* Large.

---

## J. Data‑Integrity Scenario Analysis

| Scenario | Behavior in Taxi Reserve | Verdict |
|---|---|---|
| Reservation edited after completion | Commission **amount is frozen** on its own `CommissionEntry`; only the displayed route follows the reservation. Editing price does not change commission. | Safe |
| Driver commission % changed | No percentages exist; nothing recalculates retroactively. | N/A (safe) |
| Driver deactivated | History preserved; new commissions/payments blocked while INACTIVE; balance intact. | Safe (improved) |
| Driver "deleted" | No hard delete exists; only deactivate → no orphaned/destroyed financial history. | Safe (improved vs legacy cascade) |
| Reservation reassigned | Commission moves to the new driver atomically (`ASSIGN_WITH_COMMISSION`/`MOVED`), audited. | Safe |
| Reservation cancelled/soft‑deleted after commission exists | `isDeleted=true` only; linked commission **retained** (driver still owes). PATCH path requires `confirmCommissionRemoval` before removing a linked commission. | Safe (see note) |
| Cash → card method changed | Payment method is descriptive; balance unaffected. Commission not payment‑method‑derived. | Safe |
| Booking amount changed | Commission is independent of booking price; unaffected. | Safe (by design) |
| Settlement then booking edit | No settlement snapshots; balance is a live Decimal aggregate — always consistent. | Safe |
| Two admins settle same balance | Payments are additive; reservation/commission mutations use optimistic‑concurrency guards (P2025 → conflict). | Safe |
| Duplicate submit / refresh / replay | Reservation‑linked ops are idempotent under the guard; subscriptions unique per month; deletes use `deleteMany` count. **Manual** commission/payment POSTs have **no idempotency key** → a fast double‑click can create two entries. | Mostly safe; see finding |

**Minor findings (not urgent, no data corruption):**
1. **Manual commission/payment create has no idempotency key** — a double network submit can create duplicate entries (the client disables the button while saving, which mitigates in practice). *Optional:* accept a client idempotency key or de‑dupe on `(driverId, amount, date, createdAt~)`.
2. **Soft‑deleted reservation keeps showing its route on the retained commission** with no "reservation deleted" cue. Financially correct; a small label would aid clarity.
3. **Manual commission/payment PATCH/DELETE lack the optimistic‑concurrency guard** used on reservation‑linked ops. Because these write absolute values (not deltas) and delete is idempotent, this is not a correctness risk, only a last‑writer‑wins edit.

None meet the bar for an in‑audit hotfix (no data/financial corruption, no auth gap). They are logged here for the roadmap.

---

## K. Architecture Findings (why gaps exist)

- The rebuild correctly **re‑scoped** the product: legacy was a standalone manual ledger + invoicing app; Taxi Reserve folded the ledger into a reservation platform and added subscriptions, an assistant, RBAC, and audit. The gaps are **conveniences and one module left behind**, not architectural debt.
- **Money:** new uses `Prisma.Decimal` end‑to‑end; legacy summed floats (`toNumber`). Improvement.
- **Auth:** new has real server‑side RBAC on every route; legacy had one shared credential. Improvement. UI hiding is backed by server checks (verified) — no reliance on hidden controls.
- **Audit/concurrency/transactions:** present in new, absent in legacy. Improvement.
- **No duplicated commission engine:** commission is a single manual‑amount concept reused by both the manual and reservation‑linked paths (`commissionRoute.ts`, `financialMath.ts`). Good — the recommendations above extend this, they don't fork it.
- **Scale:** both apps load full lists client‑side and neither paginates; the new driver‑detail cap (100) is the only place display and data diverge. Worth hardening (P0/P3).

---

## L. Tests

- **Legacy:** **0 automated tests.**
- **Taxi Reserve:** 15 Node `--test` suites in `scripts/`; the finance/driver/commission/import/assignment ones pass (this audit ran: import 21/21, driver‑finance 9/9, driver‑actions 26/26, commission‑actions 28/28). Subscriptions test is an integration test requiring a disposable Postgres DB (`DRIVER_SUBSCRIPTION_TEST_DATABASE_URL`).
- **Recommended coverage for new features:** due‑list totals; period‑filter boundaries (Madrid tz); filtered‑row sum equals visible rows; booking‑reference create/edit/search; adjustment‑line balance math; CSV escaping/bounds; ledger pagination correctness with >100 rows; optional idempotency‑key de‑dup on manual create.

---

## M. Files Reviewed (key)

**Legacy (`admin-dashboard`):** `prisma/schema.prisma`; `lib/actions/{commissions,drivers,payments,driver-invoices}.ts`; `lib/queries/{shared,dashboard,drivers,commissions,due-commissions,payments}.ts`; `lib/utils/format.ts`; `lib/auth/{session,actions}.ts`; `lib/validation/drivers.ts`; `app/dashboard/{page,drivers,drivers/[id],commissions,commissions/due,payments}`; `components/dashboard/drivers/DriverSearchList.tsx`; `components/dashboard/dashboard-nav-links.ts`.

**Taxi Reserve:** `prisma/schema.prisma` (+ migrations); `src/lib/drivers/{financials,financialMath,financialValidation,commissionRoute,subscriptionCore,overview,access,access-core,import-core}.ts`; `src/lib/reservations/commission-aware-assignment-{core,prisma}.ts`; `src/app/api/drivers/route.ts`, `…/[id]/route.ts`, `…/[id]/commissions[/…]/route.ts`, `…/[id]/payments[/…]/route.ts`, `…/due-pdf/route.ts`; `src/app/api/reservations/[id]/route.ts`; `src/app/{drivers,drivers/[id],drivers/overview,commissions,payments}/page.tsx`; `src/app/activity-log/page.tsx`; `src/components/drivers/{DriversList,CommissionsList,PaymentsList,CommissionForm}.tsx`; `src/components/NavbarClient.tsx`; `scripts/test-*` (finance/driver/commission/import).

## N. Validation performed
- `npm run test:assistant-driver-import` → **21 pass / 0 fail**.
- `npm run test:assistant-driver-finance` → **9 pass / 0 fail**.
- `npm run test:assistant-driver-actions` → **26 pass / 0 fail**.
- `npm run test:assistant-commission-actions` → **28 pass / 0 fail**.
- `npm run test:driver-subscriptions` → **not run** (integration test; requires `DRIVER_SUBSCRIPTION_TEST_DATABASE_URL`).
- Static evidence: grep confirms **0** invoice/factura/IVA/BillingSettings references in `src`; **no** driver DELETE route; **no** `/drivers/due` on‑screen route.
- No production code changed. Typecheck/lint/build not run (documentation‑only change).

## O. Unresolved questions / scope decisions
1. **Prepaid/card payouts:** is "company owes driver" meant to live in this ledger, or is it settled elsewhere? (Drives P0.)
2. **Facturación / driver self‑invoicing:** required in Taxi Reserve, or intentionally handled by external accounting? (Drives P3.)
3. **Driver delete:** do workers need to remove test/duplicate drivers with zero history? (Drives P3 guarded‑delete.)
4. Confirmed intentional and **preserved**: shared (non‑unique) license numbers, name+license identity, bulk‑import behavior (≤100), subscription model.
