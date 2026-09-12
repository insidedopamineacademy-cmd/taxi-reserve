# ADMIN-managed User Lifecycle Security Report

Audited: 2026-09-12

## Result

Taxi Reserve has no public account-creation path. An authenticated ADMIN must unlock
its current device session through Settings before opening user or device
administration. The ADMIN can create ACTIVE worker accounts, change a worker's
password, revoke its sessions, and deactivate or reactivate that same User row.
There is no user deletion or role-editing endpoint.

## Existing data dependencies

The lifecycle is preservation-first because operational history identifies people
through either `User.id` or `User.email`:

| Dependent data | User key/relation | Delete behavior in current schema | Lifecycle behavior |
| --- | --- | --- | --- |
| Reservations | `Reservation.userEmail -> User.email` | Restrictive/default | Preserved because email and User row stay unchanged |
| Reminders | `Reminder.userEmail -> User.email` | Restrictive/default | Preserved |
| Subscription payment attribution | `DriverSubscriptionCharge.paidByUserId -> User.id` | RESTRICT | Preserved |
| Device sessions | `DeviceSession.userId -> User.id` | RESTRICT | Preserved; active sessions are revoked, ended history remains |
| Session revoker attribution | `DeviceSession.revokedByUserId -> User.id` | SET NULL | Preserved while the User remains |
| Pending assistant actions | `AiPendingAction.userId -> User.id` | RESTRICT | Preserved |
| Assistant workflow drafts | `AiWorkflowDraft.userId -> User.id` | CASCADE on delete | Preserved because deletion is unavailable |
| Activity history | `ActivityLog.userEmail` snapshot, no User FK | Independent | Preserved and remains readable after deactivation |

No discovered `createdBy`, `updatedBy`, or `assignedBy` field references User beyond
the attribution relationships above. Driver assignment itself references Driver,
not User.

## Authorization and PIN design

Primary authentication still uses NextAuth credentials and a database-backed
DeviceSession. Every protected request reloads the current User role and status;
INACTIVE users and revoked/expired sessions fail authorization.

User and session administration requires all of the following on the server:

1. a valid authenticated DeviceSession;
2. the current database role `ADMIN`;
3. current user status `ACTIVE`; and
4. `DeviceSession.settingsUnlockedUntil` later than the current time.

Each ADMIN stores its own bcrypt `settingsPinHash`. Initial setup requires that
ADMIN's current account password plus a 6-8 digit PIN. A correct PIN grants an
absolute ten-minute unlock to the current session only. Five failed checks persist
a five-minute lockout. A new session starts locked. Explicit lock, logout, session
revocation, and the admin's own password change clear or invalidate the unlock.
Expiry comparisons are server-trusted; the browser cannot grant itself access.

PINs, password values, hashes, cookies, and plaintext or derived session tokens are
excluded from responses and ActivityLog metadata.

## Lifecycle guarantees

- Create validates normalized unique email, name, and password; hashes the password
  with bcrypt; and always writes `role=USER`, `status=ACTIVE`.
- Worker password change locks and updates the existing User row inside a
  transaction, revokes all active target sessions, and records one audit event.
- Deactivation changes only `User.status`, revokes active sessions, and records an
  audit event. Credential login and subsequent protected requests then fail.
- Reactivation changes that same row back to ACTIVE and records an audit event.
- The current ADMIN cannot deactivate itself. The last active ADMIN cannot be
  deactivated. The worker-password action refuses ADMIN targets.
- Repeated requests that already match the requested status do not create duplicate
  mutation audits.

ActivityLog event metadata records safe actor/target IDs, email, outcome, and revoked
session counts as applicable. It does not include credentials or authentication
secrets.

## Migration

`20260913120000_add_admin_user_lifecycle` is additive. It creates `UserStatus`, adds
ACTIVE status and nullable PIN/lock fields to User, adds a nullable per-session
unlock timestamp to DeviceSession, and adds a nonnegative bounded failure-count
check. It contains no DROP, DELETE, TRUNCATE, User replacement, email rewrite, or
relationship rewrite.

The migration was tested against a disposable PostgreSQL database created from the
pre-change Prisma schema. A pre-existing User and Reservation were seeded, only the
new SQL migration was applied, and the same IDs and relationship were read back with
the User defaulting to ACTIVE. The full lifecycle test then proved that password
change, deactivation, and reactivation retained the same User ID and all seeded
Reservation, Reminder, ActivityLog, subscription-payment attribution,
AiPendingAction, AiWorkflowDraft, and ended DeviceSession rows.

## Read-only production verification

After backup, migration review, and migration deployment, run only a read-only query
such as the following from an approved database console. It selects no PIN hashes,
password hashes, tokens, or customer history:

```sql
SELECT role, status, COUNT(*) AS users,
       COUNT(*) FILTER (WHERE "settingsPinHash" IS NULL AND role = 'ADMIN') AS admins_without_pin
FROM "User"
GROUP BY role, status
ORDER BY role, status;
```

Existing accounts should be ACTIVE immediately after migration. Each existing ADMIN
will appear without a PIN until it completes the current-password setup flow in
Settings. Do not initialize PINs through SQL.

## Validation and rollout

The focused static suite checks removal of registration, additive schema design,
separated role/status/session/PIN checks, bcrypt/lockout policy, API gates, and
responsive lifecycle controls. The disposable database suite covers PIN setup and
lockout, new-session isolation, duplicate account rejection, in-place password
change, session revocation, history preservation, deactivation/reactivation, current
admin safety, and secret-free audits. Browser QA covers locked deep links, USER and
anonymous denials, all lifecycle actions, and horizontal overflow at 360, 390, 430,
and 1280 pixels.

Production prerequisites are: reviewed backup; confirmed target and migration
history; successful Prisma validate/generate; `npm run migrate:deploy` before the new
application starts; the read-only role/status check above; one synthetic staging
smoke pass; and an existing ADMIN able to authenticate with its current password and
configure its PIN. This report does not authorize a production migration or deploy.

The primary credential login remains dependent on deployment/network abuse controls;
only the secondary PIN currently has an application-level lockout. PIN replacement
after loss requires a separately reviewed recovery procedure because no bypass or
database-admin UI was added.
