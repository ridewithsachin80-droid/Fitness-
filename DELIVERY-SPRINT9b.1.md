# Sprint 9b.1 — "On track" at 19%, mistyped weigh-ins, and the coach's charts

From your screenshots of Mrs. Padmini's page (9 Sep, 20:51).

Gate: **2,222 assertions green** (Sprint 10: 2,205). `test-twa-contract` still red
(`android/.gitignore`).

## This zip is a DELTA — only files changed since Sprint 10
```
Fitness--main/
├── DELIVERY-SPRINT9b.1.md                         (new)
├── client/src/
│   ├── pages/Monitor.jsx                          (changed: gold charts, shared outlier rule)
│   └── lib/day/fromServerLog.js                   (changed: previousWeight)
└── server/
    ├── services/triage.js                         (changed: two rules)
    └── scripts/
        ├── test-coach-triage.js                   (changed: +7)
        ├── test-day-lib.js                        (changed: +5)
        ├── test-layout-contracts.js               (changed: +5)
        └── ui-tests.mjs                           (changed)
```
No schema, route or server-runtime change.

## 1. "On track" at 19% compliance

The Brief called Mrs. Padmini **On track** on a day with 3 of 17 protocol items ticked. The
rules only looked at gaps (nothing logged, no food, water behind, protocol untouched), silence,
weight, sleep, missed workouts and unread messages — she had logged food, water and three
items, so nothing tripped.

Now: **from 18:00 IST, protocol under 50% on a logged day is a reason** — "Protocol 19% by
evening" — *attention* under 25%, *watch* otherwise, with **Check in** as the action. Before
18:00 nothing is said; the day isn't over. 80% at 8 pm still reads as on track.

## 2. A mistyped weigh-in no longer becomes a 5 kg swing

Her timeline said **↓ 5.1 vs yesterday** because 8 Sept reads 89.8 kg among a month of 84.7s.
The same row would have driven "weight up 5.1 kg / 2 wk" on your Needs-attention feed.

Now, in both places: **a weigh-in that disagrees with its two nearest readings by more than
3 kg is ignored.** A genuine steady climb (+3 kg over the fortnight) is still reported. Please
still correct 8 Sept in *Full log* — this stops one bad row misleading you, it doesn't fix the
data.

*Found by the tests, not by me:* my first version exempted the first and last readings, which
is exactly where a typo does the most damage — the latest row drives the whole two-week delta.
The assertion caught it and the rule now compares against the two nearest readings on either
side.

## 3. The coach's charts speak the app's language

Weight Trend was a green line with a red dashed start line; the compliance bars were green.
Now: **gold line and dots**, gold-deep dashed start/goal lines, and compliance bars **tinted by
value** (solid gold at 75%+, softer below). Tapping a bar still opens that day. Green and red
are kept for status, not for "this is your weight".

## Verified
- Real Postgres (+7): 19% at 8 pm is not on track and gets Check in; the same 19% at 10 am is
  not nagged; 80% stays on track; a mistyped mid-window reading is ignored; a mistyped **latest**
  reading is ignored; a genuine +3 kg fortnight is still reported; the day's compliance is
  exposed. Both rules mutation-checked.
- lib/day (+5): `previousWeight` skips a typo for the last believable reading, uses an ordinary
  previous day as-is, keeps a real 4 kg change, returns null with no history, and trusts a lone
  previous reading.
- Contracts (+5): gold chart, tinted bars still tappable, the member page uses the shared rule,
  triage's nearest-two comparison, the evening-only compliance rule.
