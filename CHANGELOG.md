# Changelog

Notable project changes are recorded here in reverse chronological order.

## 2026-07-02

### Changed

- Hardened native date, time, and `datetime-local` controls globally for reliable iOS Safari height, alignment, value rendering, and picker visibility.
- Added conservative production security headers for frame denial, MIME sniffing prevention, referrer control, and unused device permissions.

### Documentation

- Added `PROJECT_AUDIT.md` with architecture, routes, data flow, operations, risks, protected areas, and QA guidance.

### Safety

- No Prisma schema, migration, or database changes.
- No reservation CRUD or timezone conversion logic changes.
