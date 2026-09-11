# Sprint 12b delivery — Monitor split, and a lint the bundler never gave you

Gate: **2,346 assertions green**, plus a new step: **lint-undef ✓**. `test-twa-contract` still
red (`android/.gitignore`).

## This zip is a DELTA — only files changed since Sprint 12a
Upload order: 11b → 11c → 11d → 12a → 12b.
```
Fitness--main/
├── DELIVERY-SPRINT12b.md                          (new)
├── client/src/
│   ├── pages/Monitor.jsx                          (changed: 1,900 → 1,348 lines)
│   ├── components/coach/DayDetail.jsx             (NEW — the day's full log, moved out)
│   ├── components/coach/MemberCharts.jsx          (NEW — weight trend + compliance, moved out)
│   └── lib/coach/dayMath.jsx                      (NEW — the per-day maths, moved out)
└── server/
    ├── package.json                               (changed: two npm aliases, no new dependency)
    └── scripts/
        ├── lint-undef.mjs                         (NEW)
        ├── lib/eslint.undef.config.mjs            (NEW)
        ├── test-local.sh                          (changed: lint step)
        └── test-layout-contracts.js               (changed)
```
No schema, route or server-runtime change. **No new dependency in the repo** — ESLint is
installed on demand (`npm run lint:install`), exactly like the browser tooling.

## 1. Monitor.jsx, split

The member page's 1,900 lines had two blocks that were whole screens on their own:
- **DayDetail** — the day's full log as the coach sees it (every tick, macro, workout
  session, note): a 260-line function inside the render, now `components/coach/DayDetail.jsx`
  behind the *Full log* collapsible.
- **MemberCharts** — the weight trend and the 30-day compliance chart, now
  `components/coach/MemberCharts.jsx`; tapping a bar still opens that day.

The four per-day helpers they and Monitor share (`calcN`, `calcMicrosFromItems`,
`rowCompliance`, `WeightTooltip`) moved to `lib/coach/dayMath.jsx` — one definition for all
three, moved not copied. The dead `AddNoteModal` (replaced by the action sheet in 9b) is
removed. Every existing member-page test — brief, tabs, timeline, Full log, action sheet,
charts — passes unchanged.

## 2. lint-undef — the rule the bundler doesn't enforce

Vite and esbuild will happily bundle a file that references a name that was never defined or
imported. It fails at runtime, on the phone, on the one screen that uses it. Every component
split in Sprint 12 was checked for this by hand with ESLint's `no-undef`; now the gate runs it
on all of `client/src` every time. Optional like the browser check — prints NOT RUN when
ESLint is absent — and fails the gate when it finds a problem.

Baseline across the whole client: **zero** undefined identifiers.

## Verified
- The extraction was guided by the lint: each drafted component was linted, every free
  identifier it reported became a prop or an import, and the lint went to zero before the
  build was even attempted.
- UI suite unchanged at 361 (the member-page flows exercise both new components).
- Contracts (+5): components exist and are rendered; maths shared from `lib/coach`; dead modal
  gone; Monitor under 1,400 lines; the gate runs the lint. Two 9b.1 chart contracts repointed.

## Still in Sprint 12
`AdminDashboard.jsx` (2,100) and `FoodLog.jsx` (750), and skeletons / empty states on the
older screens — **12c**.
