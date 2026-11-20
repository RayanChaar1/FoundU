# Admin module

## Purpose

Administration (FR-16): users, reference data, drop-off points, parameters and the posts report.  Every function works inside the administrator's own organization (NFR-12.2), and every change is written to the audit log with its author (FR-15.7).

Requirements: FR-1, FR-5.8, FR-14, FR-14.2, FR-15.7, FR-16, FR-16.1, FR-16.2, FR-16.3, FR-16.4, FR-16.5, FR-16.6, FR-16.7, FR-16.8, FR-16.9, NFR-12.2.

## Interface

HTTP routes, mounted by `src/app.js` under `/api`:

| Method | Path | Who |
| --- | --- | --- |
| GET | `/api/users` | organization administrator |
| GET | `/api/users/:id/activity` | organization administrator |
| PATCH | `/api/users/:id/role` | organization administrator |
| POST | `/api/users/:id/suspend` | organization administrator |
| POST | `/api/users/:id/reinstate` | organization administrator |
| GET | `/api/admin/places` | organization administrator |
| POST | `/api/categories` | organization administrator |
| PATCH | `/api/categories/:id` | organization administrator |
| DELETE | `/api/categories/:id` | organization administrator |
| POST | `/api/campuses` | organization administrator |
| PATCH | `/api/campuses/:id` | organization administrator |
| DELETE | `/api/campuses/:id` | organization administrator |
| POST | `/api/buildings` | organization administrator |
| PATCH | `/api/buildings/:id` | organization administrator |
| DELETE | `/api/buildings/:id` | organization administrator |
| PATCH | `/api/dropoffs/:id` | organization administrator |
| DELETE | `/api/dropoffs/:id` | organization administrator |
| GET | `/api/admin/settings` | organization administrator |
| PUT | `/api/admin/settings` | organization administrator |
| GET | `/api/admin/report.csv` | organization administrator |

Functions exported to other modules and jobs: `ORG_ROLES`, `searchUsers`, `activity`, `setRole`, `suspend`, `reinstate`, `places`, `createCategory`, `updateCategory`, `deleteCategory`, `createCampus`, `updateCampus`, `deleteCampus`, `createBuilding`, `updateBuilding`, `deleteBuilding`, `updateDropoff`, `removeDropoff`, `settings`, `updateSettings`, `report`, `csvField`.

## Dependencies

- Other modules: none (other modules reach it through events).
- Shared code: `src/db/pool.js`, `src/lib/errors.js`, `src/middleware/auth.js`.
- Packages: `express`, `zod`.
- Tables: `audit_log`, `campuses`, `categories`, `claims`, `dropoff_points`, `locations`, `messages`, `organizations`, `posts`, `qr_tags`, `reports`, `users`.

## Files

- `routes.js`: HTTP routes and input validation (zod)
- `service.js`: business rules
