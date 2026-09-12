# Driver subscription status and automatic payment allocation

Updated 12 September 2026. This report supersedes the earlier manual-only
subscription-status description. No production migration, production-data change,
commit, push or deployment was performed.

## Accounting contract

The pre-change audit found this exact implementation:

```text
balance = totalCommissions - totalPayments - totalSubscriptionCharges
```

At the same time, the product labelled a positive balance as owed to the business.
That sign made a new subscription lower the driver's liability and produced €124,
not the required €164, for commissions €244, subscription €20 and payment €100.
The subscription term therefore had to change sign to implement the stated
business rule. No other finance term or aggregate source changed.

`DriverSubscriptionCharge` is the authoritative monthly liability row. The
canonical balance is:

```text
balance = totalCommissions + totalSubscriptionCharges - totalPayments
```

Positive means the driver owes the business, zero means settled, and negative is a
credit in the driver's favour. All driver money uses Prisma `Decimal`.
`DriverSubscriptionPaymentAllocation` explains how a payment was divided; it is
reconciliation metadata and is never added to or subtracted from the balance.

## Existing monthly generation

The protected monthly cron remains the only automatic charge generator. It creates
one stored row per eligible ACTIVE, non-exempt, configured driver and Madrid month:
VAN €20.00 or SEDAN €7.00. The unique `(driverId, chargeMonth)` key keeps reruns
idempotent. Configuration changes never rewrite history, and allocation never
fabricates a missing charge.

Historical status semantics remain compatible. Rows backfilled by the earlier
status migration remain UNVERIFIED until an admin reviews them. Existing PAID rows
without allocation evidence remain PAID. Newly generated rows default to UNPAID.

## Allocation model

Migration `20260912120000_add_driver_subscription_payment_allocations` adds a
positive Decimal join row with `driverPaymentId`, `subscriptionChargeId`, `amount`
and `createdAt`. A unique payment/charge pair prevents duplicate portions. Payment
deletion cascades its allocations; charge deletion is restricted.

When an admin records a payment, the server:

1. locks the Driver row inside a database transaction;
2. validates an ACTIVE driver and an amount of at least €0.01 with at most two decimals;
3. creates the `DriverPayment`;
4. loads eligible non-PAID charges no later than the payment month, ordered by month, creation time and ID;
5. allocates as much as possible to each charge in that order;
6. treats any remainder as commission settlement; and
7. writes one structured ActivityLog row before committing.

The driver lock serializes simultaneous payments for the same driver. The payment,
all allocations and audit are atomic, so an audit failure rolls back the financial
mutation. The invariant is exact:

```text
payment amount = subscription allocations + commission remainder
```

## Derived status and reversal

The persisted compatibility enum remains UNVERIFIED, UNPAID or PAID. Automatic
allocation derives presentation as follows:

| Evidence | Display status |
| --- | --- |
| No allocation, stored UNVERIFIED | Unverified |
| No allocation, stored UNPAID | Unpaid |
| Allocation greater than zero and below amount | Partially paid |
| Allocation equals amount, or historical stored PAID | Paid |

Every view computes paid and remaining amounts from exact allocation sums. Editing
a payment may change only method or notes. Correcting amount or date requires
deleting the payment and recording a replacement. Deletion atomically removes the
payment's allocations and writes a reversal audit containing the former
subscription portions and commission remainder. A repeated delete is idempotent
and does not create another audit event.

The older manual reconciliation control remains under Historical reconciliation
for an unallocated row. It is rejected once an automatic allocation exists, which
prevents two sources from claiming the same receipt.

## Worker-visible behavior

The Record payment form previews the exact split before submission. It lists each
oldest subscription portion, remaining subscription debt, and commission balance.
The driver ledger shows the same split on each payment and shows paid/remaining
amounts for every monthly charge. Record payment is the primary driver action; Add
commission remains adjacent.

Drivers, Pending Commissions, the due PDF, individual ledger PDF and full ledger
PDF use the same canonical balance and settlement derivation. The Pending column
can show `€10.00/€20.00`, `PARCIAL`, and the exact remaining subscription without
changing the final amount due.

The Activity Log stores the payment amount, method, driver ID, subscription total,
per-month allocation/status transition and commission remainder. Reversal events
store the former portions. It does not store tokens, credentials or payment
secrets.

ADMIN users can reach the Administration hub from Settings. The hub provides
responsive Users and Devices & Sessions cards. Client visibility is backed by the
existing middleware and server/API ADMIN checks.

## Validation evidence

- Pure/unit coverage: partial, exact, excess, no-charge, multiple-month oldest-first,
  below-minimum validation, derived states, authoritative formula and no double count.
- Disposable PostgreSQL coverage: historical PAID/UNVERIFIED compatibility,
  exempt/inactive behavior, second payment completion, reversal/idempotency,
  protected edits, manual compatibility, two concurrent payments and forced audit
  failure rollback.
- Browser coverage: Settings/Admin/Sessions navigation, USER denial, payment preview,
  PARTIAL then PAID ledger states, due PDF and widths 360, 390, 430 and 1280 pixels.
- The additive migration was applied to a disposable database built from the
  pre-change schema. Schema validation and the existing monthly generator suite pass.

## Deployment requirements and limitations

Before this build receives traffic, back up the target database, verify its Prisma
migration history and apply `npm run migrate:deploy` with the intended production
`DATABASE_URL`. Confirm `20260905180000_driver_subscription_payment_status` and
`20260906090000_device_sessions_location` are already applied, then verify the new
`20260912120000_add_driver_subscription_payment_allocations` row in migration
history. Never use `prisma migrate dev`, reset or `db push` against production.

The repository's empty historical baseline still prevents treating the full
migration directory as a blank-database bootstrap. The new migration proves an
upgrade from the prior schema, not a clean installation. Allocation only uses
stored charges through the payment month; missed cron rows require a separately
reviewed operational correction. No physical phone was attached for this change;
responsive behavior was validated in Chromium emulation.
