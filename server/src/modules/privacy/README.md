# Privacy module

## Purpose

Privacy notice (NFR-22.1, NFR-23.1): the data FoundU keeps, why and for how long, the user's rights, and the rules of use.  Public, so it can be read before signing in.

Requirements: NFR-22.1, NFR-23.1.

## Interface

HTTP routes, mounted by `src/app.js` under `/api`:

| Method | Path | Who |
| --- | --- | --- |
| GET | `/api/privacy` | anyone |

`tests/nfr-privacy.test.js` fails when a column of the database is missing from `inventory.js`; add the new column to the entry it belongs to, with its purpose.

## Dependencies

- Other modules: none.
- Shared code: none.
- Packages: `express`.

## Files

- `inventory.js`: the data inventory: every column of every table with its purpose and retention, the user's rights, the rules of use
- `routes.js`: the public notice
