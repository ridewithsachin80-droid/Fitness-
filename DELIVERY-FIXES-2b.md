# Delivery — Fixes 2b: green brand, both themes, a simpler Today (16 Oct 2026)

Pushed to the **test** branch on top of Fixes 2a. Sachin's decisions:
- **green** brand;
- **dark and light** themes, light refined;
- the **coach line open** on Today;
- **AI on past days** (in 2a);
- **Plan as a tab** (the call was left to me: yes).

## Brand: green everywhere, both themes
- **Gold is gone from the app code.** A new check fails the build's tests if it comes back.
- **Charts** use the live theme colour: the Progress weight chart, the coach's weight and compliance charts, strength progress and the compliance ring.
- **Logo and icons** were re-drawn in green from the original artwork (sage mark on a green-black tile). They are overwritten in place:
  - `client/public/logo-full.png`, `client/public/logo-mark.png`;
  - `client/public/icons/*`;
  - `client/make_icons.py` (colours only).
- **Status bar:** the Android splash and status bar use `#315D47` (`vite.config.js`, `android/.../colors.xml`). The PDFs and the printed lab report use green accents.
- **Theme:**
  - Follows the phone's dark/light setting until the member picks one.
  - Settings → Appearance: **Match phone / Light / Dark**.
  - On iPhone the status bar follows the theme.
- **Light mode fixed:**
  - Connected Devices header and cards (were black on white);
  - Settings switches (the white knob vanished);
  - photo "Saving…" text;
  - the faintest text raised to ≥ 4.5:1 contrast;
  - reminder editor and admin colours now follow the theme.

## Today: simpler, with production's features back
- One-line header: the greeting with the streak (🔥 21) and no big "Your day." title, so Weight and Sleep sit above the logging bar.
- Protein / carbs / fat **against the coach's targets** ("29 / 90 g" with a bar each), as on production; grams alone when no target is set.
- **Weight change** ("↓ 0.1 vs yesterday"), **program day** ("Push · 6 ex"), **"Rest day"**, "Slept well / Short sleep".
- Short empty labels ("Log move", "Log sleep", "Log weight"), and "See meals ›" under the ring (the ring opens the food sheet).
- **Coach line open on Today:** unread coach messages, or else today's read.
- **"Next up" meal** from the coach's meal plan, open on Today (it was hidden in a closed section).
- **Today's read:** one number in a warm voice: "780 of 1,500 kcal so far — 720 left for dinner. Next up: …". It no longer says "941 under".
- **"Plan & tools":** names the next habits ("Next: …") instead of "0 of 16"; the nutrients link shows "x/31 met".
- **Logging bar:** slims to one row once you scroll (still tappable).
- **"What's new":** a one-time card for existing members with a "Got it" button. It is not a pop-up.
- **Recap prompt:** "Want your evening recap?" moved below the day's numbers.

## Elsewhere
- **Tabs:** Today · **Plan** · Progress · More.
- **More:** 7 rows in two groups (Every day / Account), titled "More".
- **Connected Devices:** working trackers first; the rest under "Coming soon".
- **Food sheet:**
  - the day's totals on one line, with the macro bars under "Macros & nutrients";
  - brand colours only;
  - "238 kcal", not "238k";
  - "Nutrition source not recorded" is no longer printed on every older item.
- **Profile:** says "Coach Sachin", not "Coach Coach Sachin".
- **Camera:** a photo picked after switching day and back can never be sent. The day-change check now starts when the app loads, so a quick away-and-back is never missed (that test passed or failed on timing).

## Tests
- **New:** ui-tests block [38] (Today with the restored features, coach line, next habits, what's new) and brand checks in test-layout-contracts.
- **Changed on purpose** (the design changed by decision):
  - nav = 4 tabs; More = 7 rows;
  - "Log weight" label;
  - macros shown against targets;
  - food-sheet bars under "Macros & nutrients";
  - chart colours read the theme;
  - manifest colour green;
  - the timeline test centres a row before tapping.
- **Full gate green locally:** 5,545 assertions (real Postgres, client build, headless Chrome at phone widths in both themes).
- **Visual regression:** I screenshotted every member, coach and admin screen at 390 px in dark and light against a production-mode copy of this build.

## Files
- **New (all added; nothing renamed or deleted):**
  - `client/src/utils/themeColor.js`
  - `client/src/hooks/useScrolledPast.js`
  - `client/src/components/member/WhatsNew.jsx`
  - `DELIVERY-FIXES-2b.md`
- **Overwritten images:** the logo and icon PNGs listed above.
