# Settings PIN deployment verification

Use this checklist after deploying the Settings PIN provenance fix. It does not require a PIN reset, role change, or database edit.

1. Run `vercel inspect <production-deployment-url> --logs` and confirm the clone line contains the intended commit hash.
2. Confirm the build route list contains both `/settings` and `/api/admin/security-gate`.
3. Open the production `/settings` page in a fresh browser load and confirm its Settings JavaScript request is tied to the current deployment ID. Search that response for `X-Taxi-Security-Request` and `security-v1`.
4. On the iPhone, fully close the Home Screen app once, reopen it, and navigate to Settings. A custom service worker is not installed, so deleting and reinstalling the app is unnecessary.
5. Submit the PIN setup once. In Vercel Runtime Logs, find `SECURITY_REQUEST_PROVENANCE` for `admin-security-gate` and record only: outcome, branch, host, requestOrigin, configuredAuthOrigin, Origin/Referer presence and sanitized origins, Sec-Fetch-Site, marker presence/validity, method, and content type.
6. Confirm the accepted request is followed by `SECURITY_GATE_STAGE` values `jwt-admin-accepted` and `setup-input-accepted`. This proves provenance passed and the request reached the ADMIN/DeviceSession/password/PIN handling path.
7. Confirm no log line contains a request body, cookie, authorization value, password, PIN, session token, JWT, or hash.
8. Repeat from desktop and confirm the provenance outcome is `accepted`.
9. After physical-device verification, reduce the temporary accepted-request and stage logs to rejection-only logging.
