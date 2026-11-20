# Matching module

## Purpose

Smart Match module (Table 7, FR-5): compares a newly published or edited post with the open posts of the opposite type, records matches, notifies the owner of the lost post, and lists possible matches.

Requirements: FR-2.9, FR-5, FR-5.1, FR-5.2, FR-5.3, FR-5.4, FR-5.5, FR-5.6, FR-5.7, FR-5.8, FR-5.9.

## Interface

HTTP routes, mounted by `src/app.js` under `/api`:

| Method | Path | Who |
| --- | --- | --- |
| GET | `/api/posts/:id/matches` | signed in |
| POST | `/api/matches/:id/dismiss` | signed in |
| GET | `/api/admin/matching` | organization administrator |
| PUT | `/api/admin/matching` | organization administrator |

Functions exported to other modules and jobs: `runFor`, `listFor`, `dismiss`, `getSettings`, `updateSettings`.

Events handled: `post.published`, `post.updated`.

## Dependencies

- Other modules: `notifications`.
- Shared code: `src/db/pool.js`, `src/lib/errors.js`, `src/lib/events.js`, `src/middleware/auth.js`.
- Packages: `express`, `zod`.
- Tables: `audit_log`, `campuses`, `locations`, `matches`, `organizations`, `photos`, `posts`.

## Files

- `routes.js`: HTTP routes and input validation (zod)
- `score.js`: match score of two posts
- `service.js`: business rules
