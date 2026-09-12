# Driver credits, pending commissions and subscription display

Originally validated on 5 September 2026 and updated on 12 September 2026 for
automatic subscription allocation and the combined-charge double-count correction.
No commit, push, deployment or production-data change was made.

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
| `src/lib/drivers/financialMath.ts` | Uses the combined charge aggregate minus payments and keeps subscription as breakdown-only metadata |
| `src/lib/drivers/duePdf.ts` | Four columns, monthly explanation and fitted monetary columns |
| `src/app/api/drivers/due-pdf/route.ts` | One captured timestamp for month selection and generated date |
| `scripts/test-driver-balance-reports.mts` | Eight focused reconciliation, Decimal, subscription, ordering, date and access regressions |
| `scripts/test-pending-commissions-pdf.mts` | Four-column contract and rendered PDF text/pagination tests |
| `scripts/render-pending-commissions-pdf-fixture.mts` | Subscription fixtures, large amounts and configurable row count |
| `package.json` | `test:driver-balance-reports` command |
| `DRIVER_BALANCE_VIEWS_REPORT.md` | This report |

5. **Current verified formula.** `balance = combinedChargeTotal - totalPayments`.
The legacy `totalCommissions` value is the raw `CommissionEntry` aggregate and is
the combined charge total in current operational data. A read-only configured-data
query found exactly the reported shape: 25 commission rows totaling €264.00, no
payments, and one separate €20.00 subscription row. No commission row is typed or
marked as subscription. Under the confirmed business contract, €244.00 is ordinary
commission and €20.00 is the subscription component of the €264.00 combined total.
Positive is due to the business; negative is credit in the driver's favour.

6. **Meaning of Suscripción.** The actual `DriverSubscriptionCharge.amount` whose
`chargeMonth` is the first civil date of the current Madrid calendar month. The
unique `(driverId, chargeMonth)` constraint permits one record per month. The amount
is read from the record and shown as a component/status breakdown; it is never
reconstructed from VAN/SEDAN rates or independently added to the balance. Missing
current-month records display `€ 0.00`.

7. **No double counting.** The exact regression fixture uses combined charges
`264.00`, payments `0.00`, and a stored subscription component of `20.00`. The
final liability is `264.00`. A €100.00 payment allocates €20.00 to subscription
and €80.00 to commission, while the final liability becomes €164.00. Allocation
classifies the payment and never adds or subtracts another monetary term.

8. **Credits reconciliation.** Only `balance < 0` is selected, displayed as the
positive amount in the driver's favour. Positive and zero balances are excluded.
Totals use `calculateDriverFinancePosition()`, also used by the KPI.

9. **Pending reconciliation.** Only `balance > 0` is selected; credits and zero
balances are excluded. The same position helper returns the gross pending total.
The €264.00 regression fixture produces €264.00 in driver detail, driver KPI,
Pending page, and Pending PDF preparation.

10. **PDF reconciliation.** Pending PDF preparation delegates to the same report
preparation used by the web page. The individual and full ledger routes pass the
same canonical summary balance into their PDF builders. A single regression test
renders all three PDF forms and proves the €264.00 balance matches the web/KPI
result. Subscription presentation includes paid/total and remaining values,
including `PARCIAL`, while allocation amounts remain classification evidence.

11. **Responsive QA.** Actual production-built, authenticated routes `/drivers`, `/drivers/credits` and `/drivers/due` were exercised and screenshots inspected at 360, 390, 430 and 1280 pixels. All 12 combinations passed page-overflow checks. Tested click and keyboard KPI navigation, visible focus, case-insensitive driver/licence search, deterministic order, ledger navigation, no-results/reset and unchanged overall totals. Additional 360px checks covered very large Decimal amounts, reduced motion, both empty datasets and zero totals. No page overflow or clipped detail monetary cells was found. Browser page-error collection was empty. Anonymous and USER-role access was rejected; PDF returned 401 and 403 respectively. ADMIN requests succeeded.

12. **PDF visual QA.** Used the PDF skill and rendered the actual one-page download, a 40-driver/two-page fixture, an 85-driver/four-page fixture and an empty report with Poppler. Inspected all pages for column hierarchy, long names, wrapped long licences, repeated headers, footer numbering, zebra rows, the final total and monetary alignment. Values covered `€ 0.00`, `€ 7.00`, `€ 20.00`, `€ 245.00`, `€ 2,025.00` and `€ 99,999,999.99`. Monetary values remain complete, right-aligned, with the deliberate euro gap. PDF operator tests additionally verify intact monetary text, repeated four-column headers and the total appearing only on the final page.

13. **Commands executed and results for the double-count correction.**

| Validation command | Final result |
| --- | --- |
| `npm test` | Passed the complete configured suite |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed, no warnings |
| `npm run build` | Passed |
| `git diff --check` | Passed |
| `npm run test:driver-balance-reports` | 8 passed, including €264 reconciliation and Decimal edge cases |
| `npm run test:pending-commissions-pdf` | 11 passed |
| `npm run test:assistant-driver-finance` | 9 passed |
| `npm run test:assistant-driver-tool-loop` | 9 passed |
| `npm run test:assistant-streaming` | 9 passed |
| `npm run test:admin-payment-ui` | 5 passed |
| `npm run test:driver-subscriptions` against disposable PostgreSQL | Passed all integration scenarios |
| `npm run test:subscription-payments` against disposable PostgreSQL | Passed allocation, partial-payment, reversal, concurrency and audit scenarios |
| `node scripts/test-admin-payment-browser.mjs` against the disposable local app/database | Passed protected navigation, responsive layouts, €264 → €254 → €204 balances, allocation states, three PDF routes and USER denial |

The database integration and browser suites used synthetic records in a disposable
PostgreSQL cluster bound only to localhost. The current schema was loaded into a
fresh test database from a schema-only SQL file; no Prisma migration command or
production write was run. Browser QA used the installed Google Chrome. The local
Next.js server and disposable PostgreSQL cluster were stopped after validation.

14. **Subscription settlement semantics.** The additive allocation model now identifies exact paid and remaining amounts per generated monthly charge. Payments apply oldest first through the payment month; PARTIAL is derived when the allocated sum is between zero and the charge amount. Historical PAID rows without allocations remain compatible, and UNVERIFIED rows remain reviewable until allocated or manually reconciled.

15. **Working-tree safety.** Nothing was staged, committed, pushed or deployed.
The formula correction created no migration and changed no stored financial row.
The working tree also contains the previously requested uncommitted administrator
user-lifecycle work, so whole-tree diff statistics include both tasks. The final
task report records the current `git diff --stat` and identifies the finance files
separately.
