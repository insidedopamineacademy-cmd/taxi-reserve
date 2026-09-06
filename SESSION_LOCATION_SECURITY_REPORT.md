# Device sessions and mandatory location — implementation record

## 2026-09-06 iOS Home Screen production incident

### Root cause and observed failure

The reported text “Location access could not be checked. Try again.” existed only
in the rejection path of the preliminary `DELETE /api/security/location` call.
That request ran before the secure-context check, Permissions API query or
`navigator.geolocation.getCurrentPosition`. The endpoint required an exact
`Origin` header as its sole CSRF proof. An iOS Home Screen WebKit request that
omitted Origin was therefore rejected and every Retry repeated the same
pre-geolocation failure.

The exact browser Geolocation error in the reported failure was **none**:
`getCurrentPosition` was never called. The exact local reproduction is HTTP 403
`INVALID_LOCATION_REQUEST` after intentionally removing the new request marker,
with a verified geolocation call count of zero. The original production build did
not retain response status/code diagnostics, so its on-device HTTP status cannot
be recovered after the fact; the source path and repeated symptom identify the
failed operation, while the missing/opaque iOS Origin behavior remains the
request-header explanation to confirm with Web Inspector on hardware.

Server coordinate parsing and persistence did not contribute to the reported loop
because no coordinates reached the server. Automated coverage separately proves
that a browser-success/server-save failure now shows “Location could not be saved”
instead of a browser-permission error.

### Compatibility and security fix

Location POST/DELETE now require `X-Taxi-Location-Request: location-v1`, a
non-safelisted application marker. A present Origin must still exactly match the
canonical application origin, and present Fetch Metadata must be `same-origin`
or `none`. A request with a foreign Origin, cross-site Fetch Metadata, or no
marker fails with 403. A cross-origin page cannot add the custom header without a
CORS preflight, and the endpoint exposes no permissive CORS policy. This retains
CSRF protection while allowing a same-origin Home Screen request with no Origin.
Authentication, registered-session ownership, freshness and coordinate validation
remain unchanged.

Permissions API results are advisory. Initial `granted` may start verification
automatically; other/unsupported/thrown results wait for a user gesture. Every
Allow location or Try again action calls Geolocation directly, even if a cached
`PermissionStatus` says denied. WebKit itself documents that its geolocation
permission query may report `prompt` until Geolocation has been used since page
load ([WebKit change 295237](https://results.webkit.org/commit?id=295237%40main&repository_id=webkit)).
The actual Geolocation success/error callback is authoritative.

Each attempt requests a current value with `maximumAge: 0`, high accuracy and an
18-second timeout. Only `POSITION_UNAVAILABLE` or `TIMEOUT` triggers one
18-second normal-accuracy fallback; `PERMISSION_DENIED` does not. Each Retry
constructs a new request sequence and clears the transient UI state. The success
path now chooses either bootstrap route replacement or an in-place refresh, fixing
a race that could navigate to the default Reservations page.

### Diagnostics and error states

Development builds record a bounded on-screen/console diagnostic containing:
Geolocation availability, secure-context status, visibility, both standalone
signals, protocol, coarse browser/platform class, permission-query outcome,
server status/safe error code and sanitized Geolocation `code`/`message`.
Codes map to `PERMISSION_DENIED` (1), `POSITION_UNAVAILABLE` (2), and
`TIMEOUT` (3). Production builds do not expose these diagnostics. Neither path
logs coordinates, raw user agent, session ID, cookies, tokens, passwords or secrets.

Browser permission failures, insecure/unsupported contexts, session preparation
failures and coordinate-save failures have separate concise UI states. Permission
guidance follows Apple's documented path under Settings → Privacy & Security →
Location Services and the app entry that requested access
([Apple Location Services guidance](https://support.apple.com/en-ie/102647)).
The exact Home Screen entry must still be recorded during physical release QA.

### iOS standalone findings and test limit

Safari 26 opens sites added to the Home Screen as web apps by default unless the
user turns off “Open as Web App”; a manifest or service worker is not required for
that launch mode ([WebKit Safari 26 notes](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)).
Standalone detection therefore applies to Taxi Reserve, but it changes diagnostics
and guidance only. WebKit documents that a foreground Home Screen web app can be
inspected from Safari's Develop menu
([Apple inspection guide](https://developer.apple.com/documentation/safari-developer-tools/inspecting-ios)).

The browser suite passed Chromium emulations for normal iOS Safari UA, normal iOS
Chrome UA and `navigator.standalone`/standalone-display mode. All stayed blocked
before location, persisted a valid latest position, cleared the gate afterward and
kept one LOGIN event. The installed Playwright WebKit runtime launched but stalled
before completing a page; it was stopped after bounded waits. No physical iPhone
was available, so no native Safari or Home Screen permission result is claimed.

The incident operator reports that migration
`20260906090000_device_sessions_location` is already applied in production.
This fix changes no Prisma schema or migration. It has not been committed, pushed
or deployed from this checkout.

## Audit before implementation

The repository was clean at the start of this task. Authentication is NextAuth
4.24.15 Credentials with `bcryptjs`, Prisma User records and encrypted JWT
cookies; there is no adapter or persisted session model. NextAuth's default
30-day lifetime and HttpOnly/SameSite=Lax cookies apply, with Secure cookies on
HTTPS. Login normalizes email and checks the password hash. The JWT contains the
user ID/email/name and a role copied at login. Logout clears the cookie and writes
best-effort ActivityLog entries. Password changes currently update only the hash.

Consequently, individual device revocation is currently impossible: a copied
cryptographically valid JWT remains authorized until expiry. Role changes and
password changes do not invalidate these tokens. Middleware uses `withAuth` on
selected page prefixes, not the APIs or homepage. APIs, server actions and pages
use `getServerSession(authOptions)` directly or via the shared driver, email and
assistant helpers. Existing handlers were audited to require session user identity;
driver/admin operations require ADMIN. Assistant authorization already re-reads
the current user role. ActivityLog is persisted, but the generic logger is
best-effort; security mutations will use transactional audit writes.

The app has a persistent root provider/navbar and feature-flagged assistant shell.
There is no manifest, service worker or offline data cache. iPhone home-screen use
must still handle page lifecycle events and browser-specific permissions; this
task does not introduce a service worker. Existing SessionProvider disables focus
refetch; ordinary views do not poll repeatedly. A once-per-minute foreground
session check with five-minute lastSeen write throttling is therefore appropriate.

`next.config.ts` currently sends `geolocation=()` in Permissions-Policy, which
blocks the desired capability even if browser permission is granted. This must
become `geolocation=(self)`, preserving camera/microphone denial. No configured
reverse-geocoding service was found. Vercel deployment is evidenced by `vercel.json`
and the documented Neon/Vercel deployment. Proxy metadata will be trusted only
when running on Vercel, using its controlled headers; local/unconfigured proxy
deployments will record network location/IP as unavailable.

## Proposed additive schema — recorded before schema changes

```prisma
model DeviceSession {
  id                   String   @id @default(uuid())
  userId               String
  createdAt            DateTime @default(now())
  lastSeenAt           DateTime @default(now())
  expiresAt            DateTime
  revokedAt            DateTime?
  revokedByUserId      String?
  revokeReason         String?  @db.VarChar(40)
  userAgent            String?  @db.VarChar(512)
  device               String   @db.VarChar(40)
  browser              String   @db.VarChar(40)
  os                   String   @db.VarChar(40)
  ipAddress            String?  @db.VarChar(45)
  networkCity          String?  @db.VarChar(80)
  networkRegion        String?  @db.VarChar(80)
  networkCountry       String?  @db.VarChar(80)
  latitude             Float?
  longitude            Float?
  accuracy             Float?
  locationCapturedAt   DateTime?
  locationVerifiedAt   DateTime?

  user      User  @relation("DeviceSessionOwner", fields: [userId], references: [id], onDelete: Restrict)
  revokedBy User? @relation("DeviceSessionRevoker", fields: [revokedByUserId], references: [id], onDelete: SetNull)

  @@index([userId, revokedAt, expiresAt])
  @@index([expiresAt])
  @@index([revokedAt])
}
```

User receives the inverse relations. The random session ID is an opaque identifier
inside the existing authenticated/encrypted JWT, not a standalone bearer secret.
No plaintext cookie/token is stored. Every decode checks ownership, expiry and
revocation against this registry and resolves the current database role. The
server lifetime is an absolute 30 days from login, even when NextAuth refreshes a
JWT cookie. Legacy cookies without an ID fail closed and require one-time login.

Normal server sessions also require location verification no older than 30 minutes.
Identity-only authentication is restricted to auth/bootstrap/logout/location
endpoints. Node.js middleware (stable in the installed Next 15.5 release) applies
the same checks to protected pages/APIs; normal server session callbacks provide
a second boundary for APIs/actions. Browser bootstrap remains a full-screen gate
until a fresh position is accepted. Resume after five minutes away and back/forward
cache restoration recheck availability. No watchPosition or movement history.

Location is a browser-reported position, not attested GPS or proof of physical
presence. Only the latest coordinates (rounded to four decimals), browser accuracy,
capture time and server verification time are retained. They are cleared at
revocation/logout, and expired-session network/location data are scrubbed by a
daily cron. Ended session metadata is retained for 30 days then deleted; security
audit entries retain action/actor/session ID. The one LOGIN event also retains the
trusted IP/network and parsed device snapshot available at authentication; it never
contains GPS, full user agent, cookie/token, password or secret.
Daily maintenance will share the existing CRON_SECRET trust pattern.

Implementation, validation, migration status and the final 25-point report follow
below. No production migration/data mutation, commit, push or deployment was
performed.

## Final implementation report

### 1. Existing authentication/session architecture

NextAuth 4.24.15 Credentials, bcrypt password verification, encrypted stateless
JWT cookies, Prisma User and ActivityLog, no NextAuth adapter/session table. The
original role was copied at login, expiry rolled with the cookie, middleware
covered selected pages and password changes updated only the hash. The audit and
schema proposal above were recorded before implementation.

### 2. Why individual revocation was previously impossible

There was no server record to invalidate for one cookie. Clearing a browser cookie
could not reject a retained copy on another request. The new registry makes that
server decision authoritative without replacing the Credentials provider.

### 3. New session architecture

Each successful login gets an independent UUID DeviceSession. Shared token decoding
checks ownership, revocation and absolute expiry in PostgreSQL and reloads the
current User role/email/name. Normal server sessions additionally require fresh
location; identity-only sessions are restricted to auth and location bootstrap.
The registry survives application restarts. A foreground client check runs every
60 seconds and reacts immediately to a protected API returning 401 or 428.

### 4. Prisma/schema changes

DeviceSession stores owner/revoker relations; created, last-active, expiry and
revocation times; bounded device/browser/OS/user-agent and network fields; and the
latest browser coordinates, accuracy and capture/verification times. It adds three
indexes for per-user active queries and cleanup. Owner deletion is RESTRICT;
revoker deletion sets its reference null. SQL constraints require expiry after
creation and an entirely null or complete valid location group. Existing finance,
reservation and subscription schema semantics are unchanged.

### 5. Migration created and exercised

`prisma/migrations/20260906090000_device_sessions_location/migration.sql` is
additive. It was applied with ordinary `prisma migrate deploy` to a clone of the
existing disposable PostgreSQL upgrade fixture, after its 12 prior migrations.
The clone preserves the pre-existing fixture schema/data; no production database
was accessed. Prisma format/generate and the production build succeeded.

The repository's older baseline migration still cannot bootstrap an empty database
because historical Reservation creation is missing. This pre-existing issue was
not rewritten; use an established valid baseline for this migration and schedule
historical migration repair separately. No reset, schema push or destructive
production Prisma command was run.

### 6. Token and security design

The random session ID lives inside NextAuth's encrypted JWT; it is not sufficient
to authenticate by itself. No plaintext token/cookie is stored in PostgreSQL or
application logs. Existing HttpOnly, SameSite=Lax and HTTPS Secure cookie behavior
is retained. The server expiry is 30 days from login even if the JWT cookie rolls.
Legacy/malformed/expired/revoked/foreign-owner tokens fail closed. Login locks the
User row and rechecks the verified password hash, preventing a concurrent password
change from admitting the old password. Admin/password mutations require exact
Origin. Location mutations require the non-safelisted application marker and
strictly validate Origin/Fetch Metadata when present. New JSON endpoints enforce
bounded bodies and strict permitted fields.

### 7. Device information captured

Best-effort device type, browser and OS come from a bounded, control-stripped user
agent. Labels do not claim a specific phone model or hardware identity. Each login
is a separate session, so one physical browser can have multiple historical rows.
Details include login, last activity, expiry, revocation actor and location times.
No fingerprinting, hardware serials or third-party device classifier is used.

### 8. IP handling

Only deployments explicitly running on Vercel trust `x-vercel-forwarded-for` and
Vercel city/region/country headers. The IP must be a single valid IPv4/IPv6 address;
client-supplied generic forwarding headers are ignored. Other environments display
unavailable until a separately configured trusted proxy integration exists.
Network labels say “IP estimate” and remain separate from browser coordinates.
No external or paid geocoder was introduced. See [Vercel request headers](https://vercel.com/docs/headers/request-headers).

### 9. Location flow

An authenticated root boundary begins in a blocking state with normal navigation
and assistant unmounted. It clears previous verification with the location request
marker, checks secure context and Geolocation support, reads permission only as an
advisory hint, and requests one fresh position. The server derives session identity
from the cookie, validates and
rounds the input, writes the current session only, and timestamps verification.
Only then does the normal application mount. Server failures remain blocked with
Retry and Sign out. Permission withdrawal also clears server verification,
including withdrawal racing with a successful location save.

### 10. Exact permission/error behavior

| State | Behavior |
| --- | --- |
| Granted | Obtain one fresh position automatically; enter only after server acceptance. |
| Prompt | Explain purpose and wait for the Allow location button/user gesture. |
| Denied request | Remain blocked, explain permission is required and offer retry/settings guidance. |
| Browser reports denied/blocked | Show settings instructions; a user Retry makes a fresh authoritative Geolocation request. |
| Permissions API absent/throws | Treat status as unknown; use the same user-initiated Geolocation request. |
| Timeout | Try normal accuracy once, then show the timeout state, keep the gate and allow a fresh retry. |
| Unavailable/OS services off | Try normal accuracy once, then explain GPS/network recovery and keep the gate. |
| Geolocation unsupported | Explain browser support requirement; never expose normal UI. |
| Insecure context | Require HTTPS; never attempt to bypass browser restrictions. |

JavaScript cannot distinguish every browser's temporary versus permanent denial,
open arbitrary browser privacy settings, or prove OS permission state. The UI does
not claim it can. Same-origin geolocation is enabled with `geolocation=(self)`;
camera/microphone remain denied. See [MDN Geolocation](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/getCurrentPosition)
and [MDN Permissions Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy/geolocation).

### 11. Location freshness policy

Fresh at each authenticated document bootstrap; refresh after at least five minutes
backgrounded, on back/forward-cache restoration, and when the server's 30-minute
verification expires. Requests use maximumAge 0, high accuracy and an 18-second
timeout. Timeout/unavailable gets one normal-accuracy attempt with the same bounds.
Accepted capture times must be within five minutes past/one minute
future; bounds reject impossible coordinates, non-finite numbers and excessive
accuracy values. No watchPosition, movement stream or background polling.
lastSeen writes are conditionally throttled to at most once per five minutes.

### 12. Server-side anti-bypass enforcement

Node.js middleware checks registered identity on private pages and APIs, enforces
location (428 JSON or `/location` redirect), and current ADMIN role on admin paths.
The same decoder and location-aware NextAuth callback protect existing server
handlers/actions that require `session.user`. A database outage fails closed.
Auth/location bootstrap is explicitly scoped; machine cron endpoints retain their
own constant-time Bearer-secret authorization. Calling a protected URL directly
or fabricating a sessionId in a location payload does not bypass the boundary.
Node middleware is supported by the installed Next 15.5 release; see [Next 15.5](https://nextjs.org/blog/next-15-5).

### 13. Admin device/session UI

`/admin/sessions`, linked from Admin and the ADMIN account menu, provides account
search by name/email (50 results, refine-search hint), active counts, all active
sessions and up to 50 ended sessions from the last 30 days. Responsive cards show
device/browser/OS, activity, approximate network location and browser accuracy.
Expandable details show timestamps, IP and rounded coordinates. Missing values
are honest and ended private details are suppressed even before daily cleanup.
Long account names and emails wrap. Existing navy/gold design tokens were reused.

### 14. Individual logout

A native modal names the account and device, browser/OS, available location context
and activity time. Cancel receives initial focus; Escape cancels; focus restores
after closing. Confirm conditionally revokes the active target, records actor and
reason, clears private data and writes its audit in one transaction. Repeating the
request is idempotent. The old cookie fails on its next protected request; the
foreground client navigates to login when it observes 401.

### 15. Logout all other devices

The modal displays the exact number of active target sessions. The request sends
the confirmed IDs; the transaction locks the account and checks the set again.
A changed set returns 409 and requires refresh/reconfirmation. Concurrent duplicate
requests produce one actual bulk revocation/audit. For another user's account the
button accurately says “Log out all devices”; for the current account it says
“Log out all other devices”. Unrelated accounts are unaffected.

### 16. Current-device protection

The active caller's ID is marked THIS DEVICE. It has no admin revoke button and
the server rejects direct self-revocation with 409. Bulk logout excludes this ID.
Normal Sign out intentionally revokes the caller and clears its cookie. Password
changes likewise preserve the current session while revoking the account's others.

### 17. Audit logging

Transactional ActivityLog events cover one LOGIN per successful authentication,
first location
verification per session, individual/bulk revocation, normal logout and password
change. Security mutations roll back if their required audit fails. Repeated
location refreshes do not append a coordinate history; duplicate revocations do
not create misleading repeated action logs. Metadata records actor/target IDs,
counts and device labels where useful. The LOGIN event includes its safe session ID,
user, timestamp, parsed device and trusted IP/network snapshot. It excludes GPS,
full user agent, cookies/tokens, credentials and secrets. Other security events do
not add IP. Login remains after logout, revocation and DeviceSession cleanup.

Existing code had no failed-login ActivityLog event. This remains documented rather
than expanded: the public Credentials callback does not have a bounded, dedicated
abuse-event store and durable failed-attempt writes would permit attackers to fill
the operational ActivityLog with attempted emails/IPs. No password or credential
detail is logged. A future failed-login design should add rate limits, retention and
access policy together, with a separate `LOGIN_FAILED` action.
Generic existing application logging remains unchanged.

### 18. Privacy and retention

Only the latest browser location is retained, rounded to four decimal places with
the browser's reported accuracy. No historical track, external reverse geocoding,
map service or assistant disclosure is added. Logout/revocation clears location,
IP/network and full user agent immediately. Expired rows are hidden from admin
private DTOs immediately and scrubbed by daily cron (up to the next scheduled run).
Ended DeviceSession metadata is deleted after 30 days; ActivityLog currently has
no automatic retention/deletion job, so the immutable LOGIN snapshot—including a
trusted IP/network value when available—remains until an administrator applies a
future explicit ActivityLog retention policy. Cleanup also handles network-only
DeviceSession rows. This persistence is documented because it differs from the
short-lived session-location data; GPS is never copied into ActivityLog.

### 19. Existing users must sign in again

Yes. Existing stateless JWTs lack the required registry ID and fail closed after
rollout. User accounts, passwords, reservations and financial records remain intact.
Communicate this one-time login and the new mandatory location requirement before
releasing the new application build.

### 20. Tests and results

The iOS incident regression pass added and passed 12 focused unit tests through
`npm run test:session-security`: Permissions API absent/throw/unexpected behavior, exact error mapping,
fresh retry calls, high-to-normal fallback, standalone diagnostics, safe diagnostic
sanitization and location CSRF-marker rules. The disposable PostgreSQL session
suite passed all LOGIN/session/location/revocation/retention assertions.

The repeatable Chrome browser suite passed with no uncaught page errors. It covered
the original 403 before Geolocation, marker omission/foreign Origin rejection,
successful missing-Origin requests, normal iOS Safari and Chrome UA paths, Home
Screen standalone signals, permission denied, timeout, unavailable, retry success,
refresh, five-minute resume, cached-page restoration, persistence failure,
permission/save race, logout and genuine relogin. Each failure/retry/resume retained
exactly one LOGIN for its session; relogin created one new independent LOGIN.
Playwright WebKit launched but stalled before page completion and was terminated
after bounded waits, so it is an environment limitation rather than a pass.

- 267 tests across 21 non-database suites passed, covering session policy, dates,
  reservation/assistant authorization and actions, driver finance, imports,
  subscription input, alphabetical order, balance/pending reports and PDF sharing.
- Device-session PostgreSQL integration passed: independent login/ownership,
  expiry/legacy denial, throttling, location binding, ADMIN/self rules, idempotency,
  concurrent bulk actions, stale confirmations, audit rollback, password/logout
  invalidation, privacy scrubbing and retention.
- Existing monthly driver-subscription and subscription-payment PostgreSQL
  integration suites passed against the migrated disposable fixture.
- Production Chrome browser QA exercised real Credentials login and real cookie
  rejection, direct API/page enforcement, ADMIN/USER separation, strict origin/input
  rejection, confirmations, permission/error states and responsive layouts.
- The final repeatable Chrome suite passed without uncaught page errors, including
  Android emulation, permission withdrawal/recovery, five-minute resume, cached-page
  restoration, stale-location rejection/recovery, the permission/save race and real
  sign-out. The same real cookie remained valid across a server restart and required
  fresh browser bootstrap location; a retained cookie was rejected after logout.
  Cleanup rejected an ordinary authenticated cookie and accepted its explicit cron
  secret. WebKit was attempted twice with bounded probes but its temporary runtime
  stalled creating a page/reading context cookies; no WebKit pass is claimed.
- `npm run typecheck`, `npm run lint` and `npm run build` passed. Final diff review
  check (`git diff --check`) also passed. No live email, AI-provider or
  production-data test was run.

### 21. Responsive QA

Screenshots and no-horizontal-overflow assertions cover 360, 390, 430 and 1280 CSS
pixels: login, admin listing, expanded device details, single/bulk confirmation,
location prompt, denied, blocked, timeout, unavailable, unsupported, insecure and
Permissions API fallback. Chrome's native mocked position exercises granted access;
error/permission states use explicit API mocks, not claims about real OS dialogs.
Keyboard Cancel/Escape/focus behavior was verified. Physical iPhone Safari,
Add to Home Screen and Android OS permission/Location Services remain unverified.
The downloaded macOS-14 WebKit build is frozen and could not complete a page probe.
The incident regression additionally captured new preparation/save and exact
permission error screens at 360, 390, 430 and 1280 CSS pixels with no horizontal
overflow.

### 22. Documentation updated

README, CHANGELOG, PROJECT_AUDIT, ASSISTANT_RELEASE_RUNBOOK,
ASSISTANT_MOBILE_QA, this report and blank auth/database fields in `.env.example`.
The old assertion that all home-screen testing is inapplicable has been corrected:
there is no manifest/service worker, but iOS 26 can still open a Home Screen site
as a web app and its permission/resume flow needs physical-device verification.
Repeatable browser-test configuration is in README.

### 23. Deployment/migration steps required (not executed)

The incident operator confirms the DeviceSession migration is already applied in
production. This fix adds no migration, so do not run another Prisma migration for
it.

1. Review this diff and validate physical Safari/Home Screen/Android permission
   flows in a non-production environment. Notify users of location and one-time login.
2. Confirm backup/recovery readiness and the existing migration state. Configure
   DATABASE_URL, stable NEXTAUTH_SECRET, canonical HTTPS NEXTAUTH_URL and CRON_SECRET.
3. In a separately authorized release process, deploy the reviewed application
   build without a migration step. Do not use reset, schema push or migration
   development commands against production.
4. Confirm Permissions-Policy permits self geolocation and Vercel proxy metadata
   behaves as expected. Schedule session cleanup at 04:10 UTC; retain the existing
   monthly subscription cron. Monitor cleanup failure, session-check availability
   and authentication/database latency without logging personal location payloads.
5. Smoke-test two dedicated sessions, location refusal/grant, direct-route denial,
   individual/bulk revoke, current-device preservation, password change and logout.
   Keep assistant disabled until its own release gates are satisfied.
6. Do not drop the session table for application rollback. Reverting to the old
   stateless auth build would remove the revocation/location guarantees; prefer
   a maintenance window and reviewed forward fix if this security boundary fails.

### 24. Remaining limitations

Browser coordinates and user agents can be spoofed by an authenticated client;
this feature cannot attest physical presence. Same-cookie tabs share one session
and its verification state. A server cannot observe a browser permission change
until the client reports it or freshness expires, and revocation cannot erase data
already delivered or cancel every request already in progress. Next protected
requests are rejected; idle foreground UI checks within 60 seconds and background
pages check on resume. Offline operation stays blocked.

Vercel header handling is unit-verified, not exercised on production. Other reverse
proxies are intentionally unconfigured. No physical iOS/Safari/Home Screen or
Android hardware testing was available; WebKit runtime failure limits Safari
coverage to explicit permission fallbacks, WebKit-informed design and iOS
UA/standalone browser emulation. Existing empty-database
migration-history repair remains separate. This work does not add fingerprinting,
MFA, geolocation attestation, a PWA service worker or a paid geocoding service.

### 25. git diff --stat

The statistics below preserve the original session/location implementation record.
They do not describe the later iOS incident fix. Use the current `git diff --stat`
for the reviewable incident patch; no commit or staging action was requested.

```text
.env.example                              |  3 ++
 ASSISTANT_MOBILE_QA.md                    | 16 +++++--
 ASSISTANT_RELEASE_RUNBOOK.md              | 10 ++++-
 CHANGELOG.md                              |  9 ++++
 PROJECT_AUDIT.md                          | 44 +++++++++++++------
 README.md                                 | 58 +++++++++++++++++++++++--
 next.config.ts                            |  2 +-
 package.json                              |  3 ++
 prisma/schema.prisma                      | 33 ++++++++++++++
 src/app/(auth)/login/page.tsx             |  2 +-
 src/app/activity-log/page.tsx             | 23 ++++++++--
 src/app/admin/page.tsx                    |  2 +
 src/app/api/auth/[...nextauth]/route.ts   |  4 +-
 src/app/api/user/change-password/route.ts | 11 +++--
 src/app/layout.tsx                        |  5 ++-
 src/app/settings/page.tsx                 |  2 +-
 src/components/NavbarClient.tsx           |  4 +-
 src/components/Providers.tsx              | 22 +++++-----
 src/components/UserMenu.tsx               |  3 +-
 src/lib/auth.ts                           | 64 ++++++++++++++-------------
 src/middleware.ts                         | 72 ++++++++++++++++++-------------
 src/types/next-auth.d.ts                  |  9 ++++
 vercel.json                               |  4 ++
 23 files changed, 299 insertions(+), 106 deletions(-)
```

New files (excluded by ordinary `git diff --stat` until tracked):

- `SESSION_LOCATION_SECURITY_REPORT.md`
- `prisma/migrations/20260906090000_device_sessions_location/migration.sql`
- `scripts/test-device-sessions.mjs`
- `scripts/test-session-browser.mjs`
- `scripts/test-session-security.mts`
- `src/app/admin/sessions/page.tsx`
- `src/app/api/admin/sessions/[id]/revoke/route.ts`
- `src/app/api/admin/sessions/cleanup/route.ts`
- `src/app/api/admin/sessions/revoke-others/route.ts`
- `src/app/api/admin/sessions/route.ts`
- `src/app/api/security/location/route.ts`
- `src/app/api/security/session/route.ts`
- `src/app/location/page.tsx`
- `src/components/security/LocationBoundary.tsx`
- `src/components/security/SessionManager.tsx`
- `src/lib/security/deviceMetadata.ts`
- `src/lib/security/geolocationClient.ts`
- `src/lib/security/http.ts`
- `src/lib/security/loginActivity.ts`
- `src/lib/security/policy.ts`
- `src/lib/security/sessionCore.ts`
- `src/lib/security/token.ts`

Validation artifacts include `/private/tmp/taxi-session-qa/logs/` and final Chrome
screenshots under `/var/folders/km/hzq8ktxj667fjqbn9wq04tqw0000gn/T/taxi-session-browser-jcqK5z/`.
These contain synthetic test data only; local cookie snapshots are temporary and
are not part of the repository. Physical-device verification remains outstanding.
