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

- ## In the demo

1. Search for "wallet", then filter by category and campus; an end date before the start date shows the date message.
2. Open the map: each pin is an open item, on the Beirut and Byblos campuses, placed at its building.
3. Open *Drop-off points*: the Security Office in Nicol Hall holds the wallet, the charger and the ID card, with its opening hours.
4. Open Sara's QR tags: the sticker of her MacBook opens a public page where a finder writes to her without seeing her name or email.
Refs #6, #7, #12
