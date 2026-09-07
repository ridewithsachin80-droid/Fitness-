# Sprint 5b.3 — the composer is summoned, not permanent (from your screenshot, 7 Sep 16:09)

**What changed:**
- The chat bar is **no longer always on screen**. Tap the ✨ orb and it slides up above the
  nav with the cursor ready; tap the orb again, the ⌄ on the bar, or press Escape on an empty
  box, and it goes away. The orb shows as pressed while the bar is up.
- The FitLife AI card on the page keeps a small gold **Tell me** button while the bar is away,
  so the composer is one tap from the conversation too. Today's read, the timeline's
  "Log with AI" and the sheets' banners still summon it.
- With the bar away there is no dead space above the nav; the page reserves room only while
  the bar is up.
- From Progress / Profile / Settings the orb still goes to Today with the bar already up.

Gate: **2,015 assertions green**. `test-twa-contract` still red (`android/.gitignore`).

## This zip is a DELTA — only files changed since Sprint 5b.2
```
Fitness--main/
├── DELIVERY-SPRINT5b.3.md                         (new)
├── client/src/
│   ├── components/AIChatLog.jsx                   (changed: composerOpen, Close, "Tell me")
│   ├── components/UI.jsx                          (changed: orb toggles; aria-pressed)
│   └── pages/Today.jsx                            (changed: bottom padding only while up)
└── server/scripts/
    ├── test-layout-contracts.js                   (changed)
    └── ui-tests.mjs                               (changed)
```

## Verified
- jsdom: bar absent at rest; "Tell me" visible; orb summons it (portaled, fixed); orb again
  hides it; "Tell me" summons it; ⌄ hides it; Escape on an empty box hides it, on a draft it
  only steps away; × still clears; Enter → parse → Apply unchanged.
- Real Chrome at 320/360/390 px: after tapping the orb the bar is docked above the nav, grows
  with a long dictated day, the nav steps aside while typing, and the page bottom is reachable.
