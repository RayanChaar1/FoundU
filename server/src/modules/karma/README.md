# Karma module

## Purpose

Karma points and badges (FR-13, Table 13).  Points are only ever awarded by the system in reaction to events of the other modules; no function moves points between users or turns them into anything else (FR-13.6).

Requirements: FR-13, FR-13.1, FR-13.3, FR-13.4, FR-13.5, FR-13.6, FR-15.5, FR-16.8, FR-18.6.

## Interface

HTTP routes, mounted by `src/app.js` under `/api`:

| Method | Path | Who |
| --- | --- | --- |
| GET | `/api/leaderboard` | signed in |
| GET | `/api/me/karma` | signed in |
| PATCH | `/api/users/:id/settings` | signed in |

Functions exported to other modules and jobs: `award`, `leaderboard`, `mine`, `semesterStart`, `POINTS`.

Events handled: `content.removed`, `dropoff.received`, `handover.completed`, `report.upheld`.

## Dependencies

- Other modules: `notifications`.
- Shared code: `src/db/pool.js`, `src/lib/errors.js`, `src/lib/events.js`, `src/middleware/auth.js`.
- Packages: `express`, `zod`.
- Tables: `badges`, `karma_events`, `organizations`, `posts`, `user_badges`, `users`.

## Files

- `routes.js`: HTTP routes and input validation (zod)
- `service.js`: business rules
