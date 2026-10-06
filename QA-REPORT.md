# QA REPORT — FitLife audit, 6 Oct 2026

## 1. Summary

20 confirmed issues fixed: 5 at P1, 11 at P2, 4 at P3. The two that matter most
to daily use: **coach notes could not be saved at all**, and **an app left open
could erase newer data** when it next saved.

This is not a claim that the app is bug-free. Section 6 lists what is still
open and section 7 what was not tested. Read both before relying on this.

## 2. What the application is (from the code)

- **Client:** React 18 + Vite PWA (`client/`), Tailwind, zustand stores, service worker via `vite-plugin-pwa` (injectManifest), offline queue in IndexedDB.
- **Server:** Node 20+/Express 5 + Socket.io (`server/`), 18 route files (~12,500 lines), 38 services. Entry point `server/startup.js` runs `db/schema.sql` on every boot, then `index.js`.
- **Database:** PostgreSQL (Railway), 39 tables, additive schema.
- **Auth:** JWT access token (15 min, in memory + httpOnly cookie) and refresh token (30 days, httpOnly cookie + localStorage fallback). Members: phone + PIN. Coach/admin: email + password. Voice shortcut: a separate write-only token.
- **Roles:** `patient` (member), `monitor` (coach), `admin`.
- **Storage:** Cloudflare R2 for plate and progress photos (signed links, 5 min).
- **External:** Gemini (text, vision), Groq (fallback, voice), Web Push (VAPID), WhatsApp links, OpenFoodFacts (barcode), tracker OAuth (Fitbit/Whoop/Polar).
- **Features found:** daily log (weight, food, water, protocol ticks, sleep, notes), member AI chat, voice and hands-free logging, plate photo vs plan, weekly progress photos, diet plans (versioned, PDF, grocery list, swaps), workout programs and logging, labs and lab insight, adaptive engine and macro trials, coach triage/gaps/nudges/morning messages, weekly check-in and coach brief, reminders, admin (members, coaches, foods, audit log, eval samples).
- **Not present** (so not tested): payments, memberships/renewals, bookings, multi-gym or organisation tenancy, self-registration, password-reset emails.
- **Dead or stray code noticed:** `server/server/` and `server/client/` (old Phase 1.3 copies dropped in the wrong folder, never loaded); `server/server-package.json`, `server/server_package.json`, `server/test-aichat.js`; the `usePush()` hook is defined but never mounted.

## 3. Environment and commands

Sandbox: Ubuntu 24, Node 22.22, PostgreSQL 16.15 on port 5433 rebuilt from `schema.sql`, synthetic users only. No production data, no real messages, no real AI calls (transport stubbed), no real R2.

```bash
cd server && npm install && cd ../client && npm install
cd server && npm test            # scripts/test-local.sh: schema load, 58 suites, lint, UI
cd client && npm run build
npm audit --omit=dev             # in server/ and client/
```

Beyond the existing suites I wrote throwaway probes that boot the real
`server/index.js` and (a) call ~75 routes as anonymous / another member /
another coach, (b) call 154 routes as their rightful user looking for 5xx,
(c) fire identical requests in pairs, (d) connect raw sockets. Everything they
found is now a permanent assertion in `server/scripts/test-audit.js`.

## 4. Results

| Check | Before fixes | After fixes |
|---|---|---|
| `schema.sql` on an empty database | loads, 39 tables | loads, 39 tables |
| Server suites | 57 suites, 2,699 assertions, all pass | 58 suites, **2,796** assertions, all pass |
| New audit suite | — | 97 assertions, all pass |
| Lint (undefined identifiers) | not run | pass |
| Client production build | pass | pass |
| UI suite | 428 pass (jsdom only) | PASS: 585 assertions, 0 failed, jsdom + real Chrome (visual, overflow at 320/360/390 px, security policy) |
| `npm audit` server (production deps) | 9 advisories (1 critical, 5 high) | 0 |
| `npm audit` client | 0 | 0 |

Total after fixes: **3,381** assertions (2,796 server + 585 UI). Baseline was 3,127 with the UI suite in jsdom-only mode.

Note on how the final run was made: this sandbox stops any single command at
five minutes, and the whole gate takes longer than that with real Chrome. The
final pass on the shipped code and lockfile was therefore run in pieces — every
server suite one after another on a database rebuilt from `schema.sql`, then
lint, then the client build, then the UI suite — rather than as one `npm test`.
The single-command `npm test` passed in full (3,224, jsdom UI) immediately
before the lockfile update. GitHub's "Test gate" action runs it in one piece.

Mutation checks: I put nine of the bugs back one at a time (notes SQL, open
socket rooms, no merge, no voice duplicate guard, token version ignored, blind
toggle, unguarded `hasContent`, no member lock, both note casts). Each made
`test-audit` fail; restoring made it pass.

## 5. Confirmed issues and fixes

Verification: **RT** = reproduced and re-verified at runtime against the real
server and real Postgres (now automated in `test-audit`). **LOGIC** = verified
on the real client code as a pure function, not in a browser. **STATIC** = by
reading the code only. **MOCK** = depends on the stubbed AI.

| ID | Sev | Issue | Root cause | Fix | Verified |
|---|---|---|---|---|---|
| A-01 | P1 | Coach note save returned 500 every time (Note tab; "keep a copy" after WhatsApp failed silently). | `INSERT … $6, CASE WHEN $6 IS NULL` — Postgres cannot type the bare parameter. No test called the route. | Explicit `::varchar` casts. | RT |
| A-02 | P1 | Anyone could connect a socket, ask for `monitor_<id>` and receive members' weights live. | Rooms joined on the client's say-so, no token check. | Token verified at connect; a socket joins only its own room; requested id ignored. | RT |
| A-03 | P1 | `GET /api/foods/ai-test` was public: paid AI calls per hit, first 8 characters of both API keys, raw provider errors. | Declared before the auth middleware on purpose. | Admin-only; reports ok/status/model only. | RT (MOCK) |
| A-04 | P1 | An app loaded earlier erased newer data (coach's weight correction, food logged elsewhere) on its next save. | Day is saved as a whole document, last write wins; merge existed only for offline replays; no refresh on return. | App sends what it loaded; server does a three-way merge when the day changed meanwhile; app refreshes on foreground. | RT + LOGIC |
| A-05 | P1 | "Sign out" on Profile and Admin did not end the session; the cookie restored it on next load. | Those buttons called only the store's `logout()`, which never called `/auth/logout`. | Store calls the server; a flag stops boot restoring if that call could not get through. | STATIC + source contract |
| A-06 | P2 | A day saved with `food_items` as text made `/admin/overview` and `/admin/stats` return 500 for good. Impossible dates reached Postgres. | No shape validation; `jsonb_array_length` on a non-array aborts the query. | 400 on bad shapes/dates; `hasContent` checks the JSON type first. | RT |
| A-07 | P2 | Disable was a blind flip: double tap re-enabled; the members route could disable the admin; unknown id → 500. | `SET active = NOT active`, no role filter. | App sends wanted state; role filter; cannot disable yourself; 404. | RT |
| A-08 | P2 | Two assigns at once left a member with two active coaches; a failure halfway left none. | Two statements, no transaction. | One transaction with the member row locked. | RT |
| A-09 | P2 | Double tap stored coach notes, member replies and coach-entered lab values twice. | Plain inserts, no idempotency. | Check-and-insert under a per-member lock; identical content within 30 s returns the first row. | RT |
| A-10 | P2 | A retried voice sentence was logged twice; two voice logs at once overwrote each other. | No duplicate guard; read-modify-write with no lock. | In-flight and 45-second duplicate guard; apply runs under the member lock. | RT (MOCK) |
| A-11 | P2 | Login rate limits were one bucket for everyone; ten wrong coach passwords by anyone locked all coaches out for 15 min. | `trust proxy` not set, so `req.ip` was the proxy's address. | `trust proxy = 1` in production (`TRUST_PROXY` overrides). | RT for the mechanism; Railway's hop count not verifiable here |
| A-12 | P2 | Changing or resetting a PIN/password left every existing session valid for up to 30 days. | Stateless refresh tokens, nothing to revoke. | `users.token_version` in the refresh token; bumped on every credential change. | RT |
| A-13 | P2 | Deleting a member left their photos in R2 with nothing left to find them. | Row cascade only. | Delete the objects first; refuse and delete nothing if that fails. | RT (storage stubbed) |
| A-14 | P2 | A tick made while a save was in flight disappeared; an answer for one day could land in another. | The save's response replaced the store unconditionally. | `resolveSave`: adopt the server copy only if nothing changed and the date matches. | LOGIC |
| A-15 | P2 | Live updates stopped after any network drop until reload. | Rooms are per connection and were joined once; client gave up after 5 retries. | Server joins on every connect; client retries indefinitely and re-authenticates. | RT (server side); client retry STATIC |
| A-16 | P2 | In production with no `ADMIN_PASSWORD`, every boot reset the admin to the default in the code. | Fallback default plus unconditional upsert. | Skip the upsert in that case and log loudly. | STATIC |
| A-17 | P3 | A coach could list another coach's members' devices and reminder schedules. | Two routes checked role but not assignment. | Assignment check added. | RT |
| A-18 | P3 | 9 dependency advisories in server packages (ws, engine.io, socket.io-parser, axios, proxy-addr and others). | Lockfile behind. | In-range updates via `npm audit fix`; `package.json` unchanged. | Gate rerun |
| A-19 | P3 | OTP used `Math.random`; OTP verify limited per IP only. | — | `crypto.randomInt`; per-phone limit. | STATIC |
| A-20 | P3 | App left open overnight kept showing yesterday as the working day. | Date set once on mount. | On foreground, move to today if the screen was following today and nothing is unsaved. | LOGIC (guard only) |

Decision I made on A-04, since it changes behaviour: for an **online** save from
an out-of-date app, what the member changed wins, what they did not touch keeps
the server's value, food merges by item, water adds up. **Offline** replays keep
the 5 Oct rule unchanged. Say so if you want the online rule different.

## 6. Remaining issues (known, not fixed)

| Sev | Issue |
|---|---|
| P2 | A-05, A-14, A-15 (client side) and A-20 have not been exercised in a real browser. They are covered by logic or source checks and a clean build. Do check 3 in CHANGELOG after deploying. |
| P2 | A signed-out phone keeps receiving that member's push notifications. Not fixed because `usePush()` is never mounted, so removing the subscription at sign-out would not come back at the next sign-in. Needs its own small change. |
| P2 | An access token stays valid for up to 15 minutes after a PIN reset, disable or delete. |
| P3 | Member lab upload (`POST /members/me/labs`) and nudge records can still duplicate on a double submit. |
| P3 | `POST /foods/lookup` answers 500 with the raw upstream message when OpenFoodFacts fails. Several older routes return `err.message` in 500 bodies. |
| P3 | An item added and then deleted while a save is in flight can reappear once (merge edge case). |
| P3 | If a member edits after midnight on a screen still showing yesterday, without leaving the app, the edit belongs to yesterday. |
| P3 | Stray `server/server/`, `server/client/` and three stray files. Harmless; drag-drop cannot delete them. |
| P3 | `getLogRange(from, to, memberId)` sends `memberId`, the server reads `patientId`. No caller passes it today. Fixing it tripped the rename contract test, so I left it. |
| Info | Rate limits are in memory and reset on restart. Fine at this scale. |

## 7. Blocked and not tested

| Area | Status | Why |
|---|---|---|
| Real Gemini/Groq behaviour (timeouts, truncated output, rate limits) | BLOCKED | No credentials; transport stubbed. |
| Real R2 upload/delete, signed links | BLOCKED | No credentials; existing suites use a local stand-in. |
| WhatsApp Business, SMS, real Web Push delivery | BLOCKED | No credentials; must not send real messages. |
| Tracker OAuth (Fitbit/Whoop/Polar), Health Connect, Bluetooth | NOT TESTED | Needs provider accounts and devices. OAuth callback not reviewed. |
| Inside of `server/routes/aiChat.js` (4,341 lines) beyond access control | NOT TESTED | Prompt-injection and output-validation review not done this round. |
| PWA install, service-worker update, offline in a real phone browser; TWA | NOT TESTED | Needs devices. |
| Two browser tabs, back/forward, keyboard and screen-reader use | NOT TESTED | Not automated here. |
| Performance with large rosters / years of logs | NOT TESTED | — |
| Whether Railway has exactly one proxy hop (A-11) | NOT TESTED | Only checkable on Railway. If rate limits still seem shared after deploy, tell me. |
| Clinical correctness of any workout or nutrition advice | OUT OF SCOPE | This audit is about software reliability only. |

## 8. Rerun

See "Rerun commands" in `CHANGELOG.md`. To confirm a test can fail, break the
line it guards and run `node scripts/test-audit.js`.
