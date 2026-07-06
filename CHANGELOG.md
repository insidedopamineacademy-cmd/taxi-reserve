# Changelog

Notable project changes are recorded here in reverse chronological order.

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
