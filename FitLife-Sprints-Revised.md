# FitLife — Remaining Sprints (revised 7 Sep 2026)

*Supersedes the Sprint 5–9 section of `FitLife-Redesign-Sprints.md`. Sprints 0, 3, 4, 4.1
and 5a are shipped. This revision folds in `FitLife_Premium_Product_Upgrade_Spec.md` where it
fits the product; the review that decided what fits is in the chat of 7 Sep.*

**Shipped so far:** design tokens + primitives (0) · Today with sheets (3) · AI thread and
composer on the page (4) · day tiles as a grid (4.1) · Progress with weight hero, window,
journey and 30-day grid (5a). Gate: 1,967 assertions.

**Delivery contract:** every sprint ships as a **delta zip** — only files new or changed since
the previous delivery, in repo folder structure under `Fitness--main/`, drag-dropped onto
GitHub. New files flagged. Full gate (real Postgres, client build, jsdom, real Chrome at
320/360/390 px) green before every zip. Nothing renamed or deleted.

**Standing decisions**
- Protocol dots stay — they are the coaching method — but live inside Today's Plan, not as
  their own card.
- Palette stays. Gold only for brand, primary action and an important result; not on every
  active state.
- Nav becomes **Today · Plan · Progress · Profile** with the ✨ orb in the middle; Settings
  moves inside Profile (Account section + gear icon at the top).
- Type floor is 11 px; 9 / 10 / 11.5 px retire as screens are touched.
- Readiness / recovery scores render **only** for members with tracker data. Never
  fabricated; the hero never depends on them.
- Streak and milestones stay; their footprint shrinks.

---

## Sprint 5b — Today v2 *(in progress)*

Goal: Today answers "how am I doing, what matters, what do I do" in five seconds.

- Compact header: greeting, then "Monday, 7 September · Week 6" (weeks since joining,
  from `/members/me.created_at`). Streak as a small line, not a card.
- **Today's read** as Observation → Meaning → Action: the sentence, plus one action button
  that opens the thing to do (log food, tick protocol, add water, start workout).
- **Today's Plan** — one section, three rows, replaces the coach card, the four tiles, the
  deficit chip and the dots card:
  - **Move** — program day and exercise count, or the logged session (sets, kcal), or rest
    day. Action: *Start workout →* / *Logged ✓*.
  - **Eat** — kcal and protein against target, pending meal plans, the deficit/surplus as a
    sub-line, nutrients met. Actions: *Log food →*, *View meal plan →*, *Nutrition →*.
  - **Recover** — water, sleep, and the protocol dots with "n of m". Each tappable.
- "Logged today" as a plain section (hairline dividers, no box). Notes collapsed to
  *Add a note* row. Fasting bar only when fasting is on.
- Tests: Today jsdom suite rewritten for the new structure; real-Chrome check at three widths.

## Sprint 6 — Plan screen + navigation

Goal: "What am I supposed to follow?" on one screen.

- New `pages/Plan.jsx`: **Today** (workout, meals, water, supplements, sleep target) ·
  **This week** (Mon–Sun program days from `workout_programs`, rest days marked) ·
  **Nutrition** (kcal, protein, meal plan) · **Recovery** (sleep target, water target, rest
  days). Reads existing data; no schema change.
- Nav: Today · Plan · Progress · Profile. Settings route stays; the tab goes.
- Legacy: `/settings` still resolves; a gear on Profile links to it.
- Tests: Plan jsdom suite; nav contract updated; route smoke.

## Sprint 7 — My Health (Profile), Onboarding, Login

- Profile reframed as **My Health**: identity → **Goal** (large: "Lose 8 kg · 6.4 remaining",
  start → now → target) → **My plan** (calories, protein, water, training) → **Health
  insights** (sleep trend, weight trend, recovery when available, important lab changes)
  → **Devices & data sources** → **Account** (Settings, notifications, security, sign out).
  BMI, BMR/TDEE and full lab tables move behind *Details*.
- Onboarding by goal: *What are you working toward?* (uses the existing `goal` field) →
  activity level → what FitLife should help with → *Your plan is ready* with the AI's first
  message ready to send. Avatar picker moves to Profile.
- Login: larger phone field, PIN as four boxes, remembered-member card. Coach form unchanged.
- Emoji section icons on these screens replaced by the Icon set.

## Sprint 8 — Coach home: "Needs attention"

- Top: **Today** — N members · on track · need attention · high priority.
- **Needs attention** rows: name, a combined reason ("No food log + sleep down 1.2 h +
  missed workout"), a **suggested action**, and the AI-drafted nudge the coach can
  approve / edit / send (WhatsApp-first, as today).
- Roster below: compact rows, 7-dot week, last logged.
- Coach composer docked (same component, routed to coach-parse).
- Server: `GET /members/triage` (read-only, declared before `/:id`) composing gaps, digests
  and nudge tracking. Real-Postgres suite with seeded members in every bucket.

## Sprint 9 — Coach member page

- AI brief (3 lines) at the top; tabs as a sticky segmented control; sections collapsible
  with a one-line summary; the member's own timeline, read-only; Notes + WhatsApp + push in
  one action sheet. `GET /members/:id/brief`.
- Admin: tokens only; Morning messages card keeps its place.

## Sprint 10 — Daily intelligence + weekly review

- `ai_reads` table (additive, `CREATE TABLE IF NOT EXISTS`): one row per member per day per
  kind (morning / evening / weekly). Written by the existing 06:30 and 20:30 crons and on
  Sunday. Today, WhatsApp and push read the same row — one wording everywhere.
- Morning read shaped as **Your day at a glance**: nutrition / movement / recovery lines and
  *one thing to focus on*. Recovery line only with tracker data.
- Weekly review as **Wins · Opportunities · Pattern · Next week**, replacing the current
  weekly report render; a *View detailed analytics →* action keeps every chart reachable.
- Member questions know about programs (`todayDay` in the snapshot).
- Golden-file tests on three reads so tone drift is caught.

## Sprint 11 — The P1 set

- **Smart meal suggestion**: from remaining macros, the food DB and prior meals — "You still
  need ~42 g protein · best fit for lunch" with *Add meal*.
- **Workout companion**: previous load and reps per exercise (exercise history API exists),
  suggested load, rest timer, spoken confirmations in hands-free mode, *Workout complete*
  summary with volume and a recovery line.
- **Health markers**: latest value with "↓ from 5.8" against the previous test, "2 markers
  improved since your last test", full table behind *View all*.
- **Recovery** section on Today / My Health for members with tracker data: sleep, HRV,
  resting HR, steps and one insight. Provider names live under *Data sources*.
- **Settings restructure**: Account · Preferences · Integrations · Notifications ·
  Privacy & data · Support.
- Coach house-standard circuits preferred by the coach parser.
- L1–L3 learning sprints continue underneath (eval set, nudge outcomes, verification queue).

## Sprint 12 — Architecture and polish

- Split the remaining large components with clear ownership: `AIChatLog`, `Monitor`,
  `AdminDashboard`, `FoodLog`, `DeviceConnect`.
- Retire the last arbitrary greys and hairline strengths; type floor enforced by the token
  contract.
- Count-ups, milestone moments (smaller), skeletons and designed empty states on every
  screen; install prompt after the first successful log.

---

## Not doing (agreed)
Social feed, followers, likes, leaderboards, points, badge economy, quote feed, meditation or
video libraries, challenge systems, a new palette, a 12 px type floor, removing the protocol.

## Open items carried
- `android/.gitignore` — confirm it exists on GitHub (the TWA contract test reads it).
- Rotated VAPID key and Telegram token — confirm.
- Marketing deck WhatsApp number; guide video.
