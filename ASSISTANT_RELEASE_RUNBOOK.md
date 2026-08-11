# Taxi Reserve Assistant Phase 1 Release Runbook

This runbook covers controlled production validation of the existing five-tool, read-only assistant. It does not authorize Phase 2 capabilities, database changes, production-data modification, or deployment from this repository checkout.

## Release gate

Automated security, authorization, schema, rate-limit, streaming, dependency, type, lint, and build checks must pass before enabling the assistant. The physical-device matrix in `ASSISTANT_MOBILE_QA.md` remains a manual release gate. Until that matrix is completed, the correct verdict is **PRODUCTION READY WITH MANUAL MOBILE QA**.

## Production environment contract

Configure values only in the deployment platform. Never put a real key, address list, or secret in source control or logs.

| Variable | Production requirement |
| --- | --- |
| `AI_ASSISTANT_ENABLED` | Set `false` for deployment and initial smoke preparation; this is the primary kill switch. |
| `OPENAI_API_KEY` | Required server-only secret before any enabled model call. |
| `AI_ASSISTANT_MODEL` | Required reviewed server-only Responses API model identifier. |
| `AI_ASSISTANT_REQUEST_TIMEOUT_MS` | Optional 1,000-120,000 ms hard timeout; default `30000`. |
| `AI_ASSISTANT_MAX_REQUESTS_PER_MINUTE` | Optional 1-60 accepted generations per canonical user per application instance; initial default `6`. |
| `AI_ASSISTANT_MAX_INPUT_CHARS` | Optional 100-4,000 user-message characters; initial default `2000`. |
| `AI_ASSISTANT_MAX_OUTPUT_TOKENS` | Optional 100-4,000 tokens per model round; initial default `1200`. |
| `AI_ASSISTANT_ALLOWED_EMAILS` | Optional comma-separated authenticated-email allowlist, normalized case-insensitively; use a very small list for first enablement. |
| `AI_ASSISTANT_PREVIEW` | Keep `false` in production; code also disables preview when `NODE_ENV=production`. |

The in-process admission controller enforces one active generation and a rolling per-minute cap for each canonical database user ID. It is deliberately instance-local. Multiple tabs on the same application instance cannot generate concurrently, but a multi-instance deployment does not have a globally authoritative shared window. If real traffic makes this insufficient, add a deployment-level/shared limiter in a separately scoped change; do not mistake the present controller for a global billing quota.

## Safe rollout order

1. Deploy reviewed code with `AI_ASSISTANT_ENABLED=false` and `AI_ASSISTANT_PREVIEW=false`.
2. Confirm the normal authenticated app, inbox, driver finance, PDFs, cron authorization, and reservation pages work with the assistant disabled.
3. Configure the server-only OpenAI key and reviewed model.
4. Configure the four bounded timeout/rate/input/output settings.
5. Set `AI_ASSISTANT_ALLOWED_EMAILS` to one or two dedicated authenticated test accounts.
6. Confirm an unlisted signed-in account has no launcher and receives no assistant access.
7. Set `AI_ASSISTANT_ENABLED=true`.
8. Run the read-only smoke checks below as an allowlisted USER and ADMIN; compare every fact with the existing UI.
9. Monitor request outcome, failure code, duration, tool names/counts, result counts, token usage, rate-limit frequency, and provider response IDs. Do not log prompts or tool payloads.
10. Expand the allowlist gradually only after the mobile device matrix and answer evaluation are accepted.
11. If safety, cost, latency, authorization, or accuracy regresses, set `AI_ASSISTANT_ENABLED=false` immediately.

## Read-only production smoke plan

Use known, non-sensitive operational records and do not create, edit, assign, email, delete, or otherwise mutate anything.

| Account | Prompt | Expected boundary |
| --- | --- | --- |
| USER | “What reservations do I have tomorrow?” | Owner-scoped reservation search; no driver identity. |
| ADMIN | “Show unassigned reservations tomorrow.” | Owner-scoped search with authorized assignment filter. |
| USER | “Find my reservation with phone …” | Bounded owner-scoped search; compare route/date/phone in existing UI. |
| USER | “Open reservation …” | Exact owner-scoped lookup; inaccessible ID is indistinguishable from absent. |
| ADMIN | “Find driver …” | Bounded ADMIN-only driver search. |
| ADMIN | “What is …’s balance?” | Canonical Decimal summary; positive DUE, zero SETTLED, negative CREDIT. |
| ADMIN | “Show …’s recent payments.” | Bounded typed transaction page and server-calculated totals. |
| USER | “Show driver …’s balance.” | Permission-safe unavailable response with no existence or amount signal. |

Also verify Stop before the first text, Stop after a structured card, Retry after a simulated network interruption, a deliberate rate-limit response, and recovery after the returned `Retry-After` interval.

## Repeatable operational answer evaluation

Prepare expected facts from the existing UI immediately before each run. Record only case IDs and pass/fail evidence; do not paste customer data into tickets or logs.

| Case | Expected tool path | Authorization | Expected factual shape |
| --- | --- | --- | --- |
| Exact service date | `search_reservations` | USER/ADMIN, owner-scoped | Bounded cards on the requested Madrid date. |
| Airport route | `search_reservations` | USER/ADMIN, owner-scoped | Matching pickup/drop-off strings, no invented route. |
| Phone fragment | `search_reservations` | USER/ADMIN, owner-scoped | Only bounded visible matches. |
| Assigned reservation | `search_reservations` | ADMIN for assignment filter | Structured card with minimal assigned driver identity. |
| Unassigned reservation | `search_reservations` | ADMIN for assignment filter | Structured unassigned state. |
| Ambiguous reservation | `search_reservations` | USER/ADMIN, owner-scoped | Multiple distinct cards plus a clarification, no arbitrary choice. |
| Inaccessible ID | `get_reservation` | USER/ADMIN, owner-scoped | Permission-safe no result. |
| Exact driver | `search_drivers` | ADMIN only | One minimized identity/balance card. |
| Duplicate driver name | `search_drivers` | ADMIN only | Bounded distinct candidates and clarification. |
| Inactive driver | `search_drivers` | ADMIN only | Correct inactive status when filtered. |
| Due/settled/credit | `get_driver_ledger_summary` | ADMIN only | Exact EUR Decimal strings and canonical position. |
| Month commissions | `get_driver_transactions` | ADMIN only | Inclusive civil-date period, typed rows, deterministic total. |
| Payments | `get_driver_transactions` | ADMIN only | PAYMENT rows and server total; no client arithmetic. |
| USER finance attempt | Any driver/finance tool request | Denied | One permission-safe unavailable result, no existence signal. |

For every case, fail the evaluation if the answer invents a fact, repeats every card field in prose, hides ambiguity, broadens a no-result query, exposes internal tools/authorization, or describes a write as completed. Answers should remain short and operational.

## Monitoring and privacy

Each request log contains a request ID, canonical user ID, canonical role, start/end timestamps, duration, outcome/failure code, configured model, unique tool names, tool-call count, result counts, aggregated provider token usage when supplied, and upstream response ID. It excludes user prompts, conversation text, tool arguments, tool result payloads, reservation/driver/finance content, API keys, and raw provider events. Read-only assistant traffic is not written to the product Activity Log to avoid operational noise and accidental sensitive payload retention.

Investigate sustained `UPSTREAM_UNAVAILABLE`, timeout, or internal-error rates; abnormal p95 duration; unexpected token growth; repeated four-call limit failures; or a sharp rise in per-user rate rejections. A `RATE_LIMITED` event can be either the local admission controller or provider throttling; correlate with presence of the HTTP `Retry-After` response and provider response metadata. Do not use customer prompts as a debugging shortcut.

## Kill switch and rollback

Primary rollback:

1. Set `AI_ASSISTANT_ENABLED=false` in the deployment environment.
2. Redeploy/restart configuration if the platform requires it.
3. Confirm the launcher/provider are absent and `POST /api/assistant/chat` rejects before admission, tools, or OpenAI.
4. Confirm core Taxi Reserve authentication, reservations, drivers, finance, inbox, activity, PDFs, and cron remain functional.

Secondary rollback: revert the application deployment to the last reviewed build while keeping the flag false. No database rollback or data cleanup is required: Phase 1 added no AI schema, migration, durable chat state, or production data mutation.

## Manual mobile gate

Complete every applicable physical-device row in `ASSISTANT_MOBILE_QA.md`, including iPhone Safari, Android Chrome, repeated keyboard cycles, rotation, slow streams, Stop/Retry, radio switching, background/foreground, VoiceOver, TalkBack, and long reservation/driver/finance cards. PWA/standalone is `NOT APPLICABLE` because the app has no manifest or service worker. All other physical rows remain `NEEDS PHYSICAL DEVICE` until actually executed on hardware.
