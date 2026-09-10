# Sprint 11c delivery — Settings regrouped, and Recovery for tracker members

Gate: **2,308 assertions green** (11b: 2,282). `test-twa-contract` still red (`android/.gitignore`).

## This zip is a DELTA — only files changed since Sprint 11b
```
Fitness--main/
├── DELIVERY-SPRINT11c.md                          (new)
├── client/src/
│   ├── pages/Settings.jsx                         (changed: regrouped; one guard)
│   ├── pages/Today.jsx                            (changed: mounts the recovery card)
│   ├── lib/day/recovery.js                        (NEW)
│   ├── lib/day/index.js                           (changed)
│   └── components/today/RecoveryCard.jsx          (NEW)
└── server/scripts/
    ├── test-day-lib.js                            (changed: +11)
    ├── test-layout-contracts.js                   (changed: +6)
    └── ui-tests.mjs                               (changed: +9, run() gains a pre-eval hook)
```
No schema, route or server-runtime change.

## 1. Settings, regrouped

Twelve cards in the order they were written became five groups in the order a member looks
for things:

**Account** (details, change PIN / password) · **Preferences** (appearance, mode, avatar, meal
slots, voice logging) · **Integrations** (connected devices) · **Notifications** (how your coach
reaches you, push, reminder schedule) · **Safety** (safety contacts) · Sign out.

Every card that existed still exists — only the order and the headings changed. A comment
that labelled the notifications block "Appearance" is fixed.

Not built: *Privacy & data* and *Support* groups. There is nothing behind them yet (no data
export, no support contact) and an empty group would be a promise. They come when they have
content.

## 2. Recovery — only for members whose tracker has synced

Below Today's Plan, **for members with a ring or watch connected**: Sleep · HRV · Resting HR ·
Steps · Recovery score, each against the week's average ("↑ 7 bpm vs week"), the provider
named in the corner, and **one insight** — the most important thing the numbers say:

> ✦ Recovery is low (30). A lighter day and an early night will do more than a hard session.

The rules, in priority: low recovery → resting HR well above the week → HRV well below →
under six hours of sleep → a much better night → high recovery → few steps by now → resting HR
well below the week.

**A member with no tracker sees no card.** Nothing is estimated; a missing metric is null, not
zero. Data older than yesterday is ignored as stale. The hero and Today's Plan do not read it.
Every provider's metric tree (Fitbit, Whoop, Garmin, Oura …) is flattened into the same six
numbers by `lib/day/recovery.js`.

## Fixed on the way
- Settings crashed if the push-subscriptions endpoint returned anything but an array
  (`subs.map is not a function`). Guarded.

## Not in 11c
Coach house-standard circuits (the coach parser preferring your own circuits over the AI's
generic split). It is a change to the coach AI prompt, which I want to test against real
parses rather than fit into this delta — it is the last Sprint 11 item.

## Verified
- lib/day (+11): Fitbit and Whoop shapes normalise correctly; unknown metrics stay null; no
  data → null; stale data → null; each insight rule fires on the right day; averages exclude
  today; yesterday counts as current and is flagged.
- jsdom (+9): the five Settings groups in order with every card under the right one; a member
  with no tracker gets no card; with a synced tracker the card shows the device's numbers with
  the provider named, the week deltas, and the low-recovery insight; hero and plan unaffected.
- Contracts (+6): group order; subscriptions guard; no `?? 0` in the normaliser; null without
  current data; provider named; mounted only for today and never read by the model.
