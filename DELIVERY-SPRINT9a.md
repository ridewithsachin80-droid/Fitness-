# Sprint 9a delivery — Coach member page: the brief and the tabs

Sprint 9 ships in two halves. **9a**: the AI brief at the top of the member page and the tabs
as a segmented control. **9b** (next): collapsible sections with one-line summaries, the
member's own timeline read-only, and Notes + WhatsApp + push in one action sheet.

Gate: **2,149 assertions green** (Sprint 8: 2,133). `test-twa-contract` still red
(`android/.gitignore`).

## This zip is a DELTA — only files changed since Sprint 8
```
Fitness--main/
├── DELIVERY-SPRINT9a.md                           (new)
├── client/src/
│   ├── pages/Monitor.jsx                          (changed: brief mounted, Segmented tabs)
│   └── components/coach/MemberBrief.jsx           (NEW)
└── server/
    ├── routes/patients.js                         (changed: collectTriage(), GET /members/:id/brief)
    ├── services/triage.js                         (changed: composeBrief)
    └── scripts/
        ├── smoke-routes.js                        (changed)
        ├── test-coach-triage.js                   (changed: +7 brief assertions)
        ├── test-layout-contracts.js               (changed)
        └── ui-tests.mjs                           (changed)
```
No schema change. The new route is read-only and access-checked (another coach gets 403).

## What you see on a member's page

Under the header, before the tabs, a **Brief** with a coloured priority bar and three lines:

```
Brief                                                         Needs attention
⏱ Today: weight 82.4 kg · 2 meals · 666 kcal · 37 g protein · water 1.5 L · protocol 3 ticked.
↗ Weight down 1.1 kg over 2 weeks · slept 1.4 h less than usual last night · 8-day logging streak.
✦ Needs attention: sleep down 1.4 h.
```

Line 1 is today (or "Nothing logged for 5 days — last log 3 Sep"). Line 2 is the trend. Line 3
is the call: the reasons, or the wins ("Going well: 8-day streak, down 1.1 kg / 2 wk"), or
"All on track". It re-reads every time you save something on the page.

The tabs — Today · Nutrition · Training · Labs — are now the same sliding gold segmented
control the member screens use; the emoji are gone. Still sticky.

## Verified
- Real Postgres (+7): the star's brief reads today → trend → going well with the right
  numbers; the quiet member's opens with the silence and the last log date; Daya's carries the
  sleep drop and both reasons; another coach is refused.
- jsdom (+5): three lines and the priority label; today → trend → call order; a failed brief
  renders nothing and the page keeps working; a reload re-reads it; the four tabs switch.
- Contracts: brief above tabs, no emoji tabs, re-read on reload, route access-checked and
  sharing `collectTriage` with the feed.
