# Sprint 12c delivery — AdminDashboard and FoodLog split

Gate: **2,351 assertions green**, lint-undef ✓. `test-twa-contract` still red (`android/.gitignore`).

## This zip is a DELTA — only files changed since Sprint 12b
Upload order: 11b → 11c → 11d → 12a → 12b → 12c.
```
Fitness--main/
├── DELIVERY-SPRINT12c.md                          (new)
├── client/src/
│   ├── pages/AdminDashboard.jsx                   (changed: 2,163 → 751 lines)
│   ├── components/FoodLog.jsx                     (changed: 1,041 → 739 lines)
│   ├── components/admin/                          (NEW folder, 7 files)
│   │   AdminAtoms.jsx · AddMemberModal.jsx · EditMemberModal.jsx · PushModal.jsx
│   │   AddCoachModal.jsx · AssignModal.jsx · DeleteMemberModal.jsx
│   └── components/food/                           (NEW folder, 5 files)
│       portions.jsx · macros.js · TrafficBadge.jsx · BarcodeScanner.jsx · PrescribedMeals.jsx
└── server/scripts/test-layout-contracts.js        (changed)
```
No schema, route or server-runtime change. Both new folders are packed with their files.

## What changed

**AdminDashboard.jsx** was 2,163 lines, 1,400 of them modals — Add Member, Edit Member (with
its meal-plan tab), Push, Add Coach, Assign, Delete — that closed over nothing on the page.
Each is now a file under `components/admin/`, with the three shared atoms (StatCard, Modal,
Field) and the coach-list helper in `AdminAtoms.jsx`. The page imports what it renders.

**FoodLog.jsx** was 1,041 lines. The pieces that sat above the main component — typical gram
amounts and the portion picker, the per-item macro maths, the over/under badge, the barcode
scanner, the coach's prescribed meals — are five files under `components/food/`.

Every move is verbatim: no logic changed, no copy left behind. `hasBarcodeDetector` had been
declared under the macro helper by accident of position; it now lives with the scanner.

## How it was kept safe
The same method as 12b, now with the lint in the gate: each new file was linted for undefined
identifiers before the first build; the three names it flagged (`hasBarcodeDetector`,
`useEffect`, `api`) became imports; then zero, then build, then the full suite. The UI suite —
which mounts AdminDashboard and opens the real FoodLog inside the food sheet — passes
unchanged at 361. The hygiene contracts (no hex, no legacy palette, no white-on-gold, no
squeezable buttons) now also scan `components/admin`, `food`, `coach` and `chat`.

## Sprint 12 status
Done: colours (12a), AIChatLog (12a), Monitor (12b), lint-undef (12b), AdminDashboard and
FoodLog (12c). Every file in the client is now under 1,450 lines, most under 800.

Not done, and I'd rather say so than pad: the "skeletons and designed empty states on the
older screens" polish item. The new screens (Today, Plan, My Health, Progress, coach home,
member page) have them; the admin tabs and the reminders admin still show plain text while
loading. It is a small visual pass with no logic risk — the natural first item of whatever
comes next.
