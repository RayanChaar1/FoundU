# Reference module

## Purpose

Reference data of the user's organization: campuses, buildings, categories, drop-off points.

## Interface

HTTP routes, mounted by `src/app.js` under `/api`:

| Method | Path | Who |
| --- | --- | --- |
| GET | `/api/reference` | signed in |

## Dependencies

- Other modules: none (other modules reach it through events).
- Shared code: `src/db/pool.js`, `src/middleware/auth.js`.
- Packages: `express`.
- Tables: `campuses`, `categories`, `dropoff_points`, `locations`.

## Files

- `routes.js`: HTTP routes and input validation (zod)
