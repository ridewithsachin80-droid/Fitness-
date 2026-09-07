# Sprint 5b.2 — leaving the composer without sending (from your screenshot, 7 Sep 15:21)

**What was wrong:** once there was text in the box, Send was the only way out.

**What changed:**
- A **×** appears on the box as soon as there is text: it discards the draft, collapses the box
  and drops the keyboard. Nothing is sent.
- **Escape** (desktop) steps away from the box and keeps the draft.
- The box now re-measures on every text change, so it shrinks as text is deleted and can never
  sit taller than its content (your screenshot shows a 5-line box holding two lines).

Gate: **2,004 assertions green**. `test-twa-contract` still red (`android/.gitignore`).

## This zip is a DELTA — only files changed since Sprint 5b.1
```
Fitness--main/
├── DELIVERY-SPRINT5b.2.md                         (new)
├── client/src/components/AIChatLog.jsx            (changed)
└── server/scripts/
    ├── test-layout-contracts.js                   (changed)
    └── ui-tests.mjs                               (changed)
```

## Verified
- jsdom: no × while empty; typing shows it; Escape blurs and keeps the draft; × empties the
  box, hides itself, and no request is sent; the normal Enter → parse → Apply flow unchanged.
- Real Chrome at 320/360/390 px: composer still grows to fit, nav still steps aside while typing.
