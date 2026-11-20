# Map module

## Purpose

Interactive campus map (FR-11): buildings with open posts, filters, and the hotspot view.

Requirements: FR-11, FR-11.1, FR-11.2, FR-11.4, FR-11.5, FR-11.6, FR-15.3, FR-18.4.

## Interface

HTTP routes, mounted by `src/app.js` under `/api`:

| Method | Path | Who |
| --- | --- | --- |
| GET | `/api/campuses/:id/map` | signed in |
| GET | `/api/campuses/:id/hotspots` | signed in |

Functions exported to other modules and jobs: `markers`, `hotspots`, `HOTSPOT_DAYS`.

## Dependencies

- Other modules: none (other modules reach it through events).
- Shared code: `src/db/pool.js`, `src/lib/errors.js`, `src/middleware/auth.js`.
- Packages: `express`, `zod`.
- Tables: `campuses`, `categories`, `locations`, `posts`.

## Files

- `routes.js`: HTTP routes and input validation (zod)
- `service.js`: business rules
