# Retention module

## Purpose

FR-17.5: the personal data of a post is removed once it has been closed for the retention period of its organization (12 months by default, FR-16.8).  What stays is what statistics need: type, category, building, dates and status.  Open, claimed and returned posts are never touched.  NFR-12.3: audit entries are deleted once they are one year old.

Requirements: FR-16.8, FR-17.5, FR-17.7, NFR-12.3.

## Interface

Functions exported to other modules and jobs: `anonymizeExpired`, `anonymizePost`, `purgeAuditLog`, `REMOVED`, `AUDIT_MONTHS`.

Background jobs (`jobs.js`, started by `src/server.js`): `anonymize-expired`, `purge-audit-log`.

## Dependencies

- Other modules: none (other modules reach it through events).
- Shared code: `src/db/pool.js`, `src/lib/storage.js`.
- Packages: none.
- Tables: `audit_log`, `claims`, `messages`, `organizations`, `photos`, `post_contacts`, `post_history`, `posts`.

## Files

- `jobs.js`: background jobs
- `service.js`: business rules
