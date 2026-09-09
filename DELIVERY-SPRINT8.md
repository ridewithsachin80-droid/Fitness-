# Sprint 8 delivery — Coach home: "Needs attention"

Your first visible change. Gate: **2,133 assertions green** (7b: 2,098). `test-twa-contract`
still red (`android/.gitignore`).

## This zip is a DELTA — only files changed since Sprint 7b
```
Fitness--main/
├── DELIVERY-SPRINT8.md                            (new)
├── client/src/
│   ├── pages/PatientList.jsx                      (changed: mounts the feed first)
│   └── components/coach/TriageFeed.jsx            (NEW)
└── server/
    ├── routes/patients.js                         (changed: GET /members/triage, read-only)
    ├── services/triage.js                         (NEW — pure composition)
    └── scripts/
        ├── test-coach-triage.js                   (NEW — real Postgres, 17 assertions)
        ├── test-local.sh                          (changed: suite added to the gate)
        ├── smoke-routes.js                        (changed: /triage exists, ordered before /:id)
        ├── test-layout-contracts.js               (changed)
        └── ui-tests.mjs                           (changed)
```
No schema change. The new route is read-only and declared before every `/:id` route.

## What you see when you open the app

At the top of the members list, one section — **Needs attention**:

```
Needs attention          12 members · 6 on track · 4 need attention · 2 high
● Never Logged   Never logged                                   Help them start ›
● Quiet Five     Quiet 5 days                                   Send a nudge ›
● Daya Sleepy    Sleep down 3 h + 1 unread message              Reply ›
● Vishwas Gain   Weight up 1.8 kg / 2 wk                        Review meals ›
● Bujju Blank    Nothing logged today                           Check in ›
  6 on track · tap to see
```

One line per member, worst first, a 7-dot week strip next to the name, and **one action**.
Members with nothing wrong are folded under "on track · tap to see" with their wins
("8-day streak · Down 1.1 kg / 2 wk") and a *Send praise* action.

**Actions:** *Send a nudge*, *Send praise*, *Help them start* and *Check in* open WhatsApp
with a short draft naming the member and the reason — you edit and send from your own
WhatsApp; the app sends nothing. *Reply*, *Review meals* and *Open* go to the member page.

Everything below (Needs a nudge, the roster with its pending/logged groups, the coach AI
chat) is unchanged.

## How the line is composed (server, `services/triage.js`)
- **Today's gaps** from the same `detectGaps` the morning digest and `/members/gaps` use — with
  its time gates, so nobody is nagged about lunch at 9 a.m.
- **Quiet N days / Never logged**, from the last log date.
- **Weight over two weeks** (first weigh-in in the window → latest): up 1 kg or more is a reason;
  down 0.5 kg or more is a win.
- **Sleep last night** against the 7-day average: down 1 h or more is a reason.
- **Missed workout**: a program day scheduled today, not logged, after 18:00 IST.
- **Unread member messages**.
Priority is the worst of those (high → attention → watch → ok). The action is the first that
applies: help them start → send a nudge → reply → check in → review meals → ask about sleep →
nudge workout → send praise → open.

## Verified
- **Real Postgres** (17 assertions): six members seeded into six situations land in the right
  bucket with the right line and action; header counts add up; order is worst first; the week
  strip, streak, latest weight and days-since are right; the pure composer handles a planned-
  but-missed workout, a logged one, and a 9 a.m. day with nothing nagged. Mutation-checked
  (breaking the weight rule turns two assertions red).
- **jsdom** (11 assertions): the feed loads from one request, sits above "Needs a nudge",
  counts render, three rows worst-first with the on-track member folded away, the combined
  reason line, 7 dots per row, *Send a nudge* opens `wa.me/91…` with a draft naming the quiet
  days, *Send praise* drafts the win, *Reply* opens `/coach/2`.
- **Smoke routes**: `/api/members/triage` mounted and not shadowed by `/:id`.
- **Real Chrome**: the coach home still mounts and does not overflow at 320/360/390 px —
  including with an empty or malformed payload (found and fixed: a `{}` reply used to blank
  the whole page).
