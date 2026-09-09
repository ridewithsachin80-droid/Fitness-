# Sprint 7b delivery — My Health (Profile) and Login

Gate: **2,098 assertions green** (7a: 2,072). `test-twa-contract` still red (`android/.gitignore`).

## This zip is a DELTA — only files changed since Sprint 7a
```
Fitness--main/
├── DELIVERY-SPRINT7b.md                           (new)
├── client/src/
│   ├── pages/Profile.jsx                          (changed — restructured as My Health)
│   ├── pages/Login.jsx                            (changed — polish)
│   ├── components/UI.jsx                          (changed: re-export)
│   └── components/primitives/
│       ├── Collapsible.jsx                        (NEW)
│       └── index.js                               (changed)
└── server/scripts/
    ├── test-layout-contracts.js                   (changed)
    └── ui-tests.mjs                               (changed)
```
No schema, route or server-runtime change.

## My Health (Profile)

Top to bottom:
- **Identity** — the member's avatar (the one they picked), name, "Week 7 · Coach Sachin ·
  41 yrs", a gear icon → Settings. *Edit details* (height, birth date, sex) is unchanged.
- **Goal** — the main goal as a headline from the goals list and the weights: **"Lose 10 kg ·
  4.4 kg to go"**, the other goals as chips (Sleep better · More energy), the start → now → goal
  line. When no goal is set, it says who sets one.
- **At a glance** — current weight, lost so far, to reach goal, total logs, 30-day compliance.
- **My plan** — macro targets, water target, fasting window, diet instructions (all as before).
- **Health insights** — TDEE, BMI, conditions, lab results, metabolism, portion sizes as
  **one line each** (e.g. "32.2 · Obese", "1 noted", "1,850 kcal a day at rest + activity");
  tap to open the full card. Every card that existed still exists.
- **Devices & data sources** — the connected-devices row.
- **Account** — Settings, Connected devices, Sign out.

## Login
- Phone and PIN fields are 56 px tall with larger, spaced digits; PIN is centred.
- **Welcome back** is a card with the member's avatar, first name, and the number already in.
- PIN is one field, **not** four boxes: the server accepts PINs of "at least 4" characters and
  some members have six. Boxes would have locked them out.

## Fixed on the way
- Profile's **Sign out** called `logout()` without ever taking it from the auth store — it
  would have thrown on tap. Now wired and asserted.

## Verified
- jsdom: avatar/name/Week 7/coach line; goal headline "Lose 10 kg · 4.4 kg to go"; secondary
  goal chips; 56% journey; section order; My plan values; six insight rows closed with the
  right summaries (BMI 32.2 for 82.4 kg / 160 cm; "1 noted"); opening BMI shows the full card;
  gear and Account row both reach /settings; Sign out calls logout. Login: remembered card
  with avatar + first name + prefilled phone; large spaced fields; Log In disabled until a
  PIN; a six-digit PIN is accepted.
- Contracts: section order; goals from the same `GOAL_OPTIONS` as onboarding; logout wired;
  ≥ 6 Collapsibles; PIN stays one input; avatar from the settings store.
- Real Chrome: Profile and Login still mount and do not overflow at 320/360/390 px.
