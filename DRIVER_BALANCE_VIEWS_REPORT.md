# Driver credits, pending commissions and subscription display

Validated on 5 September 2026. No commit, push, deployment, production-data changes, schema changes or migrations were made.

1. **Existing architecture.** Next.js App Router server pages use Prisma Decimal summaries from `financials.ts` / `financialMath.ts`. `getDriverBalanceLines()` supplies all drivers and their canonical summaries. `calculateDriverFinancePosition()` separates gross pending and credits. The PDF uses `pdf-lib`. Driver pages and financial PDF endpoints are ADMIN-only.

2. **Existing routes.** `/drivers/overview` and `/api/drivers/due-pdf` existed. There was no `/drivers/credits` or `/drivers/due`, and no equivalent credits detail page. Both new routes reuse a shared server page and client search/list component.

3. **KPI navigation.** The whole Driver credits card is a semantic link to `/drivers/credits`; Pending commissions links to `/drivers/due`. Both retain their monetary hierarchy, with a small decorative chevron, pointer cursor, hover/pressed feedback and visible keyboard focus. Accessible labels identify the destination and total. The existing navy/yellow/emerald/amber tokens remain unchanged. UI UX Pro Max guidance was loaded from the alternate local Claude plugin cache and applied to focus visibility and responsive table/card behavior.

4. **Files changed.**

| File | Change |
| --- | --- |
| `src/app/drivers/page.tsx` | KPI links; shared balance source |
| `src/app/drivers/credits/page.tsx` | Credits route |
| `src/app/drivers/due/page.tsx` | Pending route |
| `src/components/drivers/DriverBalancePage.tsx` | Protected shared server page, totals, PDF link, monthly explanation |
| `src/components/drivers/DriverBalanceList.tsx` | Name/licence search, mobile cards, desktop table and ledger links |
| `src/lib/drivers/balanceReport.ts` | Shared Decimal-safe selection, ordering, totals and currency/month presentation |
| `src/lib/drivers/overview.ts` | Stored subscription for the current Madrid month; common driver metadata |
| `src/lib/drivers/financialMath.ts` | Narrowed the position helper's input type to the balance field it already uses; calculation unchanged |
| `src/lib/drivers/duePdf.ts` | Four columns, monthly explanation and fitted monetary columns |
| `src/app/api/drivers/due-pdf/route.ts` | One captured timestamp for month selection and generated date |
| `scripts/test-driver-balance-reports.mts` | Six focused financial, subscription, ordering, date and access regressions |
| `scripts/test-pending-commissions-pdf.mts` | Four-column contract and rendered PDF text/pagination tests |
| `scripts/render-pending-commissions-pdf-fixture.mts` | Subscription fixtures, large amounts and configurable row count |
| `package.json` | `test:driver-balance-reports` command |
| `DRIVER_BALANCE_VIEWS_REPORT.md` | This report |

5. **Verified formula.** `balance = totalCommissions - totalPayments - totalSubscriptionCharges`. The three totals aggregate all commission entries (manual and reservation-linked), all driver payments, and all stored subscription charges respectively. Subscriptions are deliberately deducted in the existing domain. This is also documented in `PROJECT_AUDIT.md`; the calculation was preserved exactly.

6. **Meaning of Suscripción.** The actual `DriverSubscriptionCharge.amount` whose `chargeMonth` is the first civil date of the current Madrid calendar month. The unique `(driverId, chargeMonth)` constraint permits one record per month. The amount is read from the record, including historical configuration/exemption changes; it is never reconstructed from VAN/SEDAN rates. Missing current-month records display `€ 0.00`. Both PDF and web identify the month and explain that the amount is already reflected in the balance. Prior-month records continue to affect the canonical balance, but are not included in this monthly column.

7. **No double counting.** A regression and the actual database/browser fixture use commissions `300.30`, payments `35.10`, historical plus current subscriptions `40.00`, and current-month subscription `20.00`. Both views show Suscripción `€ 20.00` and Pendiente `€ 225.20`, exactly `300.30 - 35.10 - 40.00`. The presentation does not add or subtract the monthly column again. The downloaded PDF also correctly displayed a stored nonstandard charge of `€ 12.34`, and `€ 0.00` for a driver with only a prior-month charge.

8. **Credits reconciliation.** Only `balance < 0` is selected, displayed as the positive amount in the driver's favour. Positive and zero balances are excluded. Totals use `calculateDriverFinancePosition()`, also used by the KPI. Unit fixture: `€ 19.22` in both. Authenticated browser fixture: `€ 378.12` in both.

9. **Pending reconciliation.** Only `balance > 0` is selected; credits and zero balances are excluded. The same position helper returns the gross pending total. Unit fixture: `€ 225.40` in both. Authenticated browser fixture: `€ 617.06` in both. Search changes only visible rows, with an explicit note that the overall total is unchanged.

10. **PDF reconciliation.** PDF preparation delegates to the same report preparation used by the pending page. Its existing assertion checks the Decimal sum of displayed final balances against Total pendiente. The downloaded PDF contained `€ 617.06`, matching both the KPI and pending page. No subscription total was added: this column is monthly information for the selected debtors, not a second amount to collect.

11. **Responsive QA.** Actual production-built, authenticated routes `/drivers`, `/drivers/credits` and `/drivers/due` were exercised and screenshots inspected at 360, 390, 430 and 1280 pixels. All 12 combinations passed page-overflow checks. Tested click and keyboard KPI navigation, visible focus, case-insensitive driver/licence search, deterministic order, ledger navigation, no-results/reset and unchanged overall totals. Additional 360px checks covered very large Decimal amounts, reduced motion, both empty datasets and zero totals. No page overflow or clipped detail monetary cells was found. Browser page-error collection was empty. Anonymous and USER-role access was rejected; PDF returned 401 and 403 respectively. ADMIN requests succeeded.

12. **PDF visual QA.** Used the PDF skill and rendered the actual one-page download, a 40-driver/two-page fixture, an 85-driver/four-page fixture and an empty report with Poppler. Inspected all pages for column hierarchy, long names, wrapped long licences, repeated headers, footer numbering, zebra rows, the final total and monetary alignment. Values covered `€ 0.00`, `€ 7.00`, `€ 20.00`, `€ 245.00`, `€ 2,025.00` and `€ 99,999,999.99`. Monetary values remain complete, right-aligned, with the deliberate euro gap. PDF operator tests additionally verify intact monetary text, repeated four-column headers and the total appearing only on the final page.

13. **Commands executed and results.**

| Validation command | Final result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed, no warnings |
| `npm run build` | Passed; first sandboxed attempt could not fetch the existing Google Inter font, then succeeded with network access |
| `git diff --check` | Passed |
| `npm run test:driver-balance-reports` | 6 passed |
| `npm run test:pending-commissions-pdf` | 10 passed |
| `npm run test:assistant-driver-finance` | 9 passed |
| `npm run test:assistant-commission-actions` | Passed |
| `npm run test:assistant-driver-actions` | Passed |
| `npm run test:date-display` | 12 passed |
| `npm run test:pdf-share` | 6 passed |
| `DRIVER_SUBSCRIPTION_TEST_DATABASE_URL=postgresql://taxi_test@127.0.0.1:55439/taxi_driver_test npm run test:driver-subscriptions` | Passed all integration scenarios |
| `node /private/tmp/taxi-driver-qa/browser.cjs` | Passed all route, search, keyboard, reconciliation and RBAC checks |
| `node /private/tmp/taxi-driver-qa/edge-browser.cjs` | Passed large-amount and empty-state checks |

A disposable PostgreSQL cluster was initialized in `/private/tmp/taxi-driver-qa/postgres`, bound to localhost port 55439. The existing Prisma schema was applied using `prisma db push --skip-generate` only to `taxi_driver_test`; no migration files were created. Initial setup attempts encountered locale/shared-memory sandbox restrictions and were retried successfully. Tests used synthetic records only. Browser QA used the installed Google Chrome because the bundled Playwright browser was unavailable. Poppler initially needed a local fontconfig file; the successful renders used that file and produced no fontconfig errors. An initial PDF test assumed 40 two-line licences would fit two pages; its fixture was corrected to exercise one long licence and normal remaining licences, and all 10 tests then passed.

PDF fixture commands executed:

```sh
node --conditions=react-server --experimental-transform-types scripts/render-pending-commissions-pdf-fixture.mts /private/tmp/taxi-driver-qa/pending-two-pages.pdf 40
node --conditions=react-server --experimental-transform-types scripts/render-pending-commissions-pdf-fixture.mts /private/tmp/taxi-driver-qa/pending-multiple-pages.pdf 85
```

Poppler `pdftoppm` rendered these and the actual/empty API downloads. The bundled `pdftotext -layout` extracted the actual download and confirmed the rows and `€ 617.06` total. QA screenshots and PDFs remain under `/private/tmp/taxi-driver-qa/`. The temporary Next.js server and PostgreSQL cluster were stopped after validation.

14. **Subscription semantics still unresolved.** None for the implemented current-month display. The model does not allocate payments to individual subscription records, so it cannot authoritatively identify an outstanding/unpaid subscription subtotal. This implementation makes no such claim and does not change financial meaning.

15. **Git diff statistics.** The executed `git diff --stat` output for tracked files was:

```text
 package.json                                     |   1 +
 scripts/render-pending-commissions-pdf-fixture.mts |  12 +-
 scripts/test-pending-commissions-pdf.mts           |  52 ++++++++-
 src/app/api/drivers/due-pdf/route.ts               |  11 +-
 src/app/drivers/page.tsx                           |  42 +++----
 src/lib/drivers/duePdf.ts                          | 125 +++++++++------------
 src/lib/drivers/financialMath.ts                   |   2 +-
 src/lib/drivers/overview.ts                        |  13 ++-
 8 files changed, 147 insertions(+), 111 deletions(-)
```

Git's unstaged diff statistics exclude the six new implementation/test files (293 added lines) and this report, all listed above. Including those six files, the implementation/test change is 14 files, 440 insertions and 111 deletions; the report is additional documentation. Nothing was staged or committed.
