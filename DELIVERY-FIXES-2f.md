# FitLife — Fixes-2f (18 Oct 2026)

Test branch only. Production is unchanged and needs Sachin's go.
Source: Sachin's phone check on 18 Oct (15 screenshots, dark theme).

## 1. Amber only for warnings
The rule is now: amber is for warnings only, and only through the theme's `warn` token. Everything decorative uses the green accent, blue (info), a neutral tone, or the new carb and fat colours.

**What you will see change:**

| Where | Before | Now |
|---|---|---|
| Workout sheet → Calories burned | orange number | green accent |
| Progress → Your Journey | streak card orange; "% of the way" and "Every day counts" amber | all green tints (the compliance card stays blue) |
| Progress → day history | ACV and supplement chips amber; sleep stars amber; food kcal orange | accent |
| Today → plan meals | "⏰ Now" meal amber; kcal orange; carb and fat amber | accent; carb and fat in their own colours |
| Today → nutrients | "★ custom targets" amber | accent |
| Macro bars (members without targets) | carbs amber, fat amber-500 | carb colour, fat colour |
| Training summary | kcal orange; PB bar and label amber | kcal accent; PB blue |
| Profile | Calories tile orange; Carbs tile amber; kcal in orange | Calories accent; Carbs carb colour |
| Coach → day detail, history, diet editor | kcal orange; carb and fat amber | accent; carb and fat colours |
| Burn chip on checklist items | orange | accent |
| Devices | sports-watch card, battery and "Syncing" in raw amber | sky blue, neutral, blue |

**Bugs fixed by the sweep:**
- **Admin foods:** the "⚠ These numbers disagree" heading used `amber-800`, dark brown on the dark theme, so it was nearly invisible. It is now the warning colour.
- **Offline banner and the pending-sync buttons:** they used raw Tailwind amber. In the light theme that put near-white text on bright amber (about 1.9:1). They now use the theme's warning colour with the page colour as text: 10:1 in dark, 5.6:1 in light.
- **Raw gold codes:** hand-written `#f59e0b` and `#fbbf24` (Devices, coach Monitor dots, admin rings, food-search confidence chip, reminders) now use the theme's warning colour where they meant a warning, and a non-warm colour where they did not.

**New colour tokens:**

| Token | Dark | Light |
|---|---|---|
| `carb` | #E88C5C | #AA4A1A |
| `fat` | #E48CB6 | #A03068 |

Both read at 4.5:1 or better on page and card in each theme, and neither is in the gold hue band (37–52°).

**Real warnings keep the warning colour.** These are unchanged on screen, renamed from `amber-300/400` and `orange-300/400` to `warn` (189 places):
- unsynced items;
- voice errors;
- out-of-range labs;
- compliance between 50% and 80%;
- missing PIN;
- "needs attention";
- check-in answers that need a look;
- calorie surplus;
- over-target macros;
- the weight warning.

Those classes already drew `--fit-warn`, so nothing changes visually; the rename is what lets a test ban raw amber outright.

## 2. Copy and layout
- **Plan → Eat without targets:** it no longer says "Eat to your targets". It now says "No meal plan yet. Log what you eat; your coach will set your targets." Members with targets still see the old sentence.
- **Food sheet, top line:** "Tap the mic…" pointed at a mic that only appears after "+ Add food item". It now reads "Each food you add says whether to weigh it raw or cooked."
- **Progress chart:**
  - The x-axis always labels the first and the latest weigh-in, plus up to two in between. Before, it labelled every Nth point and could skip today.
  - The "Goal" label moved to the left end of the line, away from the latest point that covered it.
- **Progress title:** the member's name wraps instead of being cut ("Ragavendra's j…").
- **Your Journey:** a member who qualified for none of the cards saw a heading over nothing. A sixth card now shows only in that case: "Keep logging. Your milestones show up here…".
- **Workout sheet:**
  - the search placeholder is now "Search exercises" (it was cut);
  - the AI example is shorter and wraps instead of being cut.

## 3. Why the checks missed it, and what checks it now
- The code check only read hex colour codes and allowed every Tailwind amber and orange class as a "warning".
- The robot's screen scan ignores tints under 25% opacity (the Journey cards were 8%) and treats the warning colour as allowed.
- The robot's member qualified for none of the Journey cards.

**New gate checks** (`test-layout-contracts` [brand-2f], 10 checks):
- no Tailwind amber, yellow or orange classes anywhere in the app;
- no hand-written amber hex codes (only the printed coach report keeps its warning badge);
- the workout calories number is the accent;
- the Journey cards carry no warning or danger tint;
- no calorie number is painted the warning colour unless a condition chose it;
- the carb and fat tokens exist in both themes, pass 4.5:1 and are not gold;
- the Plan copy, food-sheet line, chart ticks, goal-label position and title wrap.

They were mutation-tested: putting the old orange kcal back, or an amber Journey card, makes them fail.

**New robot check:** `S-light-journey` / `S-dark-journey` read the Journey cards' real background colour on the live site. They fail on any amber hue. If no card is on screen, the result is a warning ("nothing was checked"), never a pass.

## 4. Robot: the tested screen is brought to the front
- **What happened:** in the local run, R16 (sign out on a shared phone) failed twice: "login page not found".
- **Cause:** member A's page was a background tab, because member B's was opened later. Background tabs get no animation frames, so the login page never finished fading in. By hand, the same sign-out shows the login form within 0.5 s.
- **Fix:** each check now brings its page to the front first (one person, one phone).
- R16 then passed. Nothing was loosened: the same assertions run.

## 5. Tests changed (none weakened)
- `ui-tests.mjs`, two checks that looked for the word "amber" in a class name to mean "shown in the warning colour":
  - "the check-in answers, a worrying one marked…";
  - "good moves are gold, bad moves amber…".
- They now look for the `warn` token: the same colour, the same assertion. The lab one also checks that a good move is not the warning colour.
- `test-layout-contracts.js`: [brand-2f] added. Existing checks untouched.
- `robot-phone-run.mjs`:
  - Journey checks added;
  - `bringToFront` added;
  - a "nothing to check" result is reported as a warning, not a pass.

## 6. Results (local, build index-B6MuxyP6.js)
- **Gate:** all suites pass, 5,789 assertions (layout contracts 170, day-lib 282, ui-tests 894).
- **Local robot:** 49 passed cleanly, 0 after retry, 0 failed, 0 warnings.
- **Dialog checks:** phone and desktop 299/299; short window and 200% zoom 200/200. Both themes.
- **2f screens at 360 px, both themes:** 12/12. Covered:
  - title not cut;
  - chart ends on today;
  - Journey cards green;
  - workout kcal equals the accent;
  - food line;
  - no-targets Plan copy.

## 7. Unfinished / not tested
- **Raw/cooked stored on food records:** not built. Nothing stores or fills it; the name still decides. Needs Sachin's OK.
- **Real phone:** microphone, camera, keyboard over inputs, installing the app. Required before production approval.
- "Decorative or warning?" is a judgement call. The gate guards the known spots, but a new decorative use of the `warn` token would not be caught automatically.

## Files
- **NEW:** `DELIVERY-FIXES-2f.md`
- **Changed:**
  - client source (the colour sweep: 54 files, listed in the ZIP);
  - `client/src/index.css` and `client/tailwind.config.js` (carb and fat tokens);
  - `client/src/pages/Plan.jsx`, `pages/Progress.jsx`, `components/sheets/FoodSheet.jsx`, `components/WorkoutLog.jsx`;
  - `server/scripts/test-layout-contracts.js`, `ui-tests.mjs`, `robot-phone-run.mjs`;
  - `client/dist/` (rebuilt app).
- Nothing renamed or deleted.
