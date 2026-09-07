# Sprint 5b.1 — the composer (from your screenshot, 7 Sep 14:46)

**What was wrong:** the composer was a single-line box with three tool icons crammed inside it,
so a dictated day scrolled sideways and only the tail was visible ("ɔ 100g whey protein 1 scope").

**What changed:**
- The text field is now a **multi-line box that grows as you type or dictate**, up to five
  lines (then scrolls inside). The whole message is readable before you send it.
- The tools (lab report · camera · mic) and the send button sit on **their own row underneath**,
  with a small character count when there is text.
- **Enter sends; Shift+Enter makes a new line.**
- While the composer has focus, the **bottom nav slides away**, so the keyboard, the composer
  and the conversation share the screen instead of stacking.

Gate: **1,998 assertions green**. `test-twa-contract` still red (`android/.gitignore`).

## This zip is a DELTA — only files changed since Sprint 5b
```
Fitness--main/
├── DELIVERY-SPRINT5b.1.md                         (new)
├── client/src/
│   ├── components/AIChatLog.jsx                   (changed: two-row composer, textarea, focus flag)
│   ├── components/UI.jsx                          (changed: nav hides while composing)
│   └── pages/Today.jsx                            (changed: bottom padding for the taller bar)
└── server/scripts/
    ├── test-layout-contracts.js                   (changed)
    └── ui-tests.mjs                               (changed)
```

## Verified
- jsdom: the input is a textarea; focusing it hides the nav and blurring brings it back;
  Enter still sends and the parse → Apply flow is unchanged.
- Real Chrome at 320/360/390 px: a 142-character day typed in grows the box to 4–5 lines
  with no clipped text (at 320 px it hits the 5-line cap and scrolls inside); the nav is
  off-screen while typing; the page bottom is still reachable behind the taller bar.
  Screenshot `today-360-composing.png` checked by eye.
