# Security and performance checks (issue #13)

**Date:** 18 November 2026.  **Version checked:** main with every module merged (FR-1 to FR-18, QR tags and the usability fixes), 104 API routes.  **Automated tests:** `server/tests/nfr-security.test.js` (18 tests, named after the Phase III test cases), run with the rest of the suite by `npm test`.  **Performance scripts:** `server/perf/` (see the README).

## Results

| Requirement | How it was checked | Result | Status |
| --- | --- | --- | --- |
| NFR-9 HTTPS, TLS 1.2 or later | API started with `TLS_CERT` and `TLS_KEY`; `openssl s_client` with each TLS version | TLS 1.0 and 1.1 refused during the handshake (alert 70, "protocol version"); TLS 1.2 and 1.3 accepted; plain HTTP not answered; `Strict-Transport-Security` sent on every response | Pass (the laptop demo runs on HTTP, see below) |
| NFR-10.1 Verification answers encrypted | Test reads the database column | AES-256-GCM: no clear text in the column, a new random IV each time (two equal answers give different values), decrypts to the answer | Pass |
| NFR-10.2 Codes stored as salted hashes | Test reads the database columns | Sign-in and handover codes stored as argon2id hashes with their own salt; the code never appears in the hash | Pass, with finding 1 |
| NFR-10.3 Encryption at rest | Storage settings | The laptop disk is encrypted by FileVault (XTS-AES-128 with a 256-bit key), which covers the database and the photos.  On a server, the database and photo storage of the hosting provider are encrypted with AES-256 | Pass for the demo |
| NFR-11.1 No critical or high OWASP Top 10 vulnerability | `npm audit`, OWASP ZAP 2.17.0 (20 November, below), the OWASP Top 10 review below, automated tests | `npm audit --omit=dev`: 0 vulnerabilities in what runs in production.  ZAP: no confirmed high or medium finding (one high alert verified as a false positive, finding 8).  SQL injection and script text stored and returned as plain text.  Security headers and cookie flags tested | Pass, with findings 4, 5, 7 to 9 |
| NFR-11.2 100 requests per minute per user | Test on a copy of the app with the real limit | 100 requests in a minute answered; the 101st gets 429 "Too many requests.  Try again in a minute."; another user is not affected | Pass |
| NFR-12.1 Every action authorized on the server | Test reads every route from the application | The 96 routes that need a session answer 401 without one; each of the 43 staff, administrator and platform routes answers 403 to every role it does not allow (128 calls); every page-level read answers 200 to a role it allows; forged, unsigned and tampered tokens get 401, and a role written into a valid token is ignored (403) | Pass |
| NFR-12.2 No data across organizations | Test as John (Acme) on LAU records | 14 kinds of LAU records (post, photo, claims, matches, history, contacts, conversation, profile, map…) answer 404 to John, reading and writing; a forged `organizationId` is ignored; a LAU category cannot be used from Acme; Sara (LAU) reads the same records | Pass |
| NFR-12.3 Audit log kept one year | Test with entries 11 and 13 months old | The new daily job deletes the 13-month entry and keeps the 11-month one; no entry can be deleted through the API (405) | Pass (finding 2, fixed) |
| NFR-13.1 No email or phone shown to other users | Test reads every page that shows users, as three users | No email address but the reader's own in 19 kinds of responses (feed, post, claims, conversations, profiles, leaderboard, notifications…).  FoundU stores no phone number at all | Pass |
| NFR-1 200 users, p95 within 2 s | `perf/load.js`, 200 users for 15 minutes; 600 users; overload | 119,297 requests, p95 31 ms, no error; 600 users: p95 32 ms, no error; when overloaded, extra requests get 503 "Try again" at once, the server keeps running and recovers | Pass (finding 6, fixed) |
| NFR-2 Search on 50,000 posts within 2 s | `perf/search.js`, 500 varied searches | Slowest search 54 ms; p95 10 ms | Pass |
| NFR-3 Smart Match within 10 s, 10,000 open posts | `perf/match.js`, 50 posts one after another; worst case; `perf/burst.js`, 200 posts in one minute | Slowest job 37 ms (611 ms in the worst case); during the burst every job ran and pages answered with p95 40 ms | Pass |

**About the demo and HTTPS.**  The demo runs on the laptop at `http://localhost`, where the browser and the server are on the same machine and nothing travels over a network.  HTTPS needs a certificate for a real domain, which comes with deployment; the server already serves HTTPS with TLS 1.2 or later as soon as the two settings are given.

## Findings

| # | Finding | Severity | What was done |
| --- | --- | --- | --- |
| 1 | **Handover codes are also kept encrypted.**  Besides the argon2id hash, each code is kept encrypted (AES-256-GCM) so that the claimant can see it again on the claim page (FR-9.3); the encrypted copy is deleted when the handover is completed or cancelled.  NFR-10.2 says "only as salted hashes". | Low | Kept, because FR-9.3 needs the code to be shown again.  Proposed for the Phase III revision (#15), NFR-10.2 reworded as: "Handover codes are compared only against salted hashes; the copy shown to the claimant is encrypted and deleted after the handover." |
| 2 | **Audit entries were never deleted** (NFR-12.3). | Medium | Fixed: daily job `purge-audit-log` in the retention module. |
| 3 | **A search longer than 100 characters got a technical message** ("Too big: expected string…"). | Low | Fixed: "Search with at most 100 characters.", and the search box stops at 100 characters. |
| 4 | **Testing an organization's single sign-on makes the server open the address the administrator typed** (FR-18.8).  An administrator could point it at an internal service. | Low | Only the administrator of an organization verified by the platform administrator can do it, HTTPS only in production, and the server never shows what it received.  Before a real deployment, refuse addresses that resolve to private networks. |
| 5 | **41 alerts in development tools** (Jest and Vite: picomatch and similar). | Low | None reaches production (`npm audit --omit=dev` finds 0).  Their fixes need major versions of Jest and Vite; to update after the submission. |
| 6 | **No answer to overload** (TC-NFR-1-D): past its capacity the server would have queued requests until they timed out. | Medium | Fixed: beyond 500 requests in progress at once (`MAX_IN_FLIGHT`), extra requests get 503 "FoundU is very busy.  Try again in a few seconds." with `Retry-After` at once. |
| 7 | **Text with a NUL character gave a server error** (found by the ZAP scan): PostgreSQL refuses `\u0000`, so a search or message containing it answered 500 "Something went wrong" (no internal details were shown). | Low | Fixed: the error handler answers 400 "Text cannot contain a null character."; test TC-NFR-11.1-D. |
| 8 | **ZAP reported a SQL injection in the search** (`q`, high risk, medium confidence) because `wallet%` returned the same post as `wallet` while `walletXYZABCDEFGHIJ` returned none. | None (false positive) | Verified by hand: the query is a parameter (`$n`); full-text search (`websearch_to_tsquery`) ignores punctuation, so `wallet%` is the word `wallet`, and the `ILIKE` part escapes `%`.  `wallet' OR '1'='1` returns the one wallet, not the 11 posts, and `%` alone returns nothing. |
| 9 | **Script text is returned as written in JSON** (ZAP: "Cross Site Scripting Weakness, persistent in JSON response", low): a `<script>` contact message comes back unchanged in My data. | Low | Kept: FoundU stores what users type and React escapes it when shown; JSON is served as `application/json` with `nosniff`, so a browser never runs it. |

## OWASP ZAP scan (20 November 2026)

OWASP ZAP 2.17.0 (cross-platform package, checksum checked) scanned the API of `main` with the fix of finding 7, through its Automation Framework, on a separate instance with its own database (demonstration data) so that the attacks never touched the demo.  The rate limit of that instance was raised so that the scan was not cut off at 100 requests a minute; NFR-11.2 is tested on its own.

- **Scope:** every GET route of the API (45, with identifiers of the demonstration data), the search with all its filters, and four JSON requests with a body (claim, contact, report, sign-in code), sent as the organization administrator, plus the routes that need no session.  Sign-out, account deletion, suspension and role changes were left out so that the scan could not end its own session.
- **Scan:** passive scan of every response, then the active scan at strength High and threshold Low (SQL injection, cross-site scripting, path traversal, command injection, server-side include and the other default rules).
- **Result:** 1 high alert, verified as a false positive (finding 8); 1 low (finding 9); 2 informational (the session cookie seen on responses; the user-agent fuzzer found no difference).  No medium alert.  A first scan at the default strength found no high or medium alert, and the NUL-character error of finding 7 in the server log.
- **Reports:** [zap/zap-2026-11-20.html](zap/zap-2026-11-20.html) and [zap/zap-2026-11-20.json](zap/zap-2026-11-20.json), kept with the release (post-condition of TC-NFR-11.1-V).

## OWASP Top 10 (2021) review

| Risk | How FoundU handles it | Checked by |
| --- | --- | --- |
| A01 Broken access control | Every route has its check on the server (`requireAuth`, `requireRole`); every query is limited to the user's organization; owners only for their own posts, claims and tags | NFR-12.1 and NFR-12.2 tests: every route, every role |
| A02 Cryptographic failures | AES-256-GCM for answers and SSO secrets; argon2id for codes; TLS 1.2 or later; secrets only in `.env`, which git ignores | NFR-9 check, NFR-10 tests |
| A03 Injection | Every SQL value is a parameter (`$1`); the only text joined into SQL is column names from fixed lists in the code and whole numbers checked by zod; React escapes every text; no `innerHTML`, `dangerouslySetInnerHTML` or `eval` | Code review of every SQL string; NFR-11.1 test |
| A04 Insecure design | Limits on every guessable code: sign-in codes 5 tries each and 5 codes per 10 minutes; handover codes 5 tries, then blocked; QR messages 5 per hour per device; 128-bit QR tokens | FR-1, FR-9.7 and FR-12.9 tests |
| A05 Security misconfiguration | helmet headers (content security policy, `nosniff`, frame protection, HSTS, no referrer); no `X-Powered-By`; errors never show internal details; requests over 100 kB refused | NFR-11.1 test |
| A06 Vulnerable components | `npm audit`: 0 in production | Finding 5 |
| A07 Identification and authentication failures | One-time codes by email (no passwords); session in an HTTP-only, SameSite cookie, Secure in production; ends after 30 minutes of inactivity; suspended users signed out at their next request | FR-1 tests, NFR-11.1 cookie test |
| A08 Software and data integrity failures | Session tokens signed (HS256) and checked on every request; unsigned (`alg: none`) and tampered tokens refused; `package-lock.json` pins every library | NFR-12.1 test |
| A09 Logging and monitoring failures | Every administrator and moderator action is written to the audit log, kept one year, read-only | FR-15.7, FR-16 and NFR-12.3 tests |
| A10 Server-side request forgery | One outgoing request chosen by a user: the SSO test of FR-18.8 | Finding 4 |

**Cross-site request forgery.**  The session cookie is `SameSite=Lax`, so the browser never sends it with a request started by another site's form or script; the API also reads only JSON bodies (and photo uploads), which a plain HTML form on another site cannot produce together with the cookie.

## Performance

**Machine:** MacBook with an Apple M1 (8 cores, 8 GB), macOS 26.6, Node.js 24.22, PostgreSQL 18.7; the load script ran on the same laptop as the API and the database, so the numbers include its own load.  **Data:** `perf/seed.sql`, 50,000 posts at LAU (14,000 open, 10,000 of them on the Beirut campus; the others claimed, returned or closed over the past year), 207 users.

**NFR-2, search.**  500 searches of one, two and three words (items, colours, places), each by one of the 200 users:

| Searches | Median | p95 | Slowest | Over 2 s |
| --- | --- | --- | --- | --- |
| 500 | 9 ms | 10 ms | 54 ms | 0 |

Heavy queries: "the" 8 ms, "a" 9 ms, "%" 8 ms, "black" (in thousands of posts) 8 ms, page 500 of the feed 16 ms; a 200-character query gets the message "Search with at most 100 characters." at once.  A one-word search returned only posts containing the word.

**NFR-3, Smart Match.**  50 lost posts published one after another on the Beirut campus, with 10,000 open posts there; each job compares the post with the open found posts of the same category (339 on average):

| Jobs | Median | p95 | Slowest |
| --- | --- | --- | --- |
| 50 | 20 ms | 33 ms | 37 ms |

**Worst case:** every one of the 10,000 open posts on the campus made a found post of the same category, so each job compares about 10,000 posts: 10 jobs, median 533 ms, slowest 611 ms, still far below 10 seconds.

**Burst (TC-NFR-3-D):** 200 lost posts published through the API within one minute (on the worst-case data) while 200 users browsed.  Every post was published (median 3 ms, slowest 16 ms) and all 200 match jobs ran; the pages kept answering with p95 40 ms and no error.

**NFR-1, 200 users at once.**  200 users, each with their own account, browse for 15 minutes: the feed (30 % of pages), searches (25 %), post pages (25 %), the campus map (10 %) and the notification count of the top bar (10 %), with one to two seconds of reading between pages (about 40 pages a minute per user, under the limit of 100).

| Page | Requests | Median | p95 | p99 | Slowest |
| --- | --- | --- | --- | --- | --- |
| Feed | 35,654 | 6 ms | 10 ms | 19 ms | 356 ms |
| Search | 29,634 | 9 ms | 14 ms | 23 ms | 342 ms |
| Post page | 30,124 | 3 ms | 7 ms | 13 ms | 348 ms |
| Campus map | 11,984 | 31 ms | 42 ms | 72 ms | 363 ms |
| Top bar | 11,901 | 2 ms | 4 ms | 10 ms | 135 ms |
| **All** | **119,297** (133 a second) | **6 ms** | **31 ms** | **41 ms** | **363 ms** |

No request failed (0 %, the limit is 1 %), and the p95 stayed between 30 and 35 ms in every one of the 15 minutes.

**600 users (TC-NFR-1-D)** for two minutes: 47,581 requests (397 a second), p95 32 ms, no error; 600 users are not yet an overload for this laptop.  **Overload:** to see the protection work, the API was started with `MAX_IN_FLIGHT=20` and 600 users sent requests without any reading time for 20 seconds: 51,883 requests answered (p95 14 ms), 55,459 got the 503 message at once, 1,039 got 429 (users over 100 requests a minute); the server kept running, no data was lost, and once the users went back to normal browsing every request was answered again (p95 29 ms, no error).

**Not covered on the laptop.**  NFR-1 asks for the optimal configuration of Appendix A, and NFR-14 for 20 organizations and several servers; both need the hosted environment.  These results, on one laptop that also ran the load, are a lower bound of what that environment gives.
