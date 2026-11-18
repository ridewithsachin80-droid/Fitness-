# FitLife — Fixes-2i: "not known" is not zero (18 Oct 2026)

Test branch only. Production is unchanged and needs Sachin's explicit approval.
Backlog item **B2** (audit: "distinguish unknown nutrient values from zero").

## The problem
- Most foods in the database list calories and macros, but not every vitamin and mineral.
- The server stores each missing value as **0** (`normaliseNutrients`, `server/services/nutrients.js`).
- The app then added those zeros up as if they were real:
  - A member who ate only a curry with no mineral data saw "Iron 0 mg", a red bar and "below target".
  - **Sodium**, the one nutrient with an upper limit, showed **green "within limit"** when nothing about it was known.
  - The "N/31 targets met" count was always out of 31, even when most values were unknown.
  - The coach's day view did its own, different sum (it also counted the multivitamin differently).

## The rule now
A stored 0 can mean "none" or "not recorded". The app tells them apart by looking at the food's whole record:

| The food's record | What a 0 means |
|---|---|
| Fills **some** vitamins (any vitamin above 0) | A 0 in another vitamin is a real 0 |
| Fills **some** minerals | A 0 in another mineral is a real 0 |
| Fills **some** omega fats | A 0 in another omega fat is a real 0 |
| Fibre, lycopene, beta-glucan | Known if above 0, or the record fills vitamins or minerals |
| Fills nothing in the group | **Not known**, never 0 |
| An explicit `null` | Not known |

For each nutrient, the day's total is then:
- **Every gram eaten has a known value:** the total, as before (met / below / zero / over the limit).
- **Some of the day's food is unknown:**
  - the target is already reached → **met** (more food can only add);
  - for sodium, already over the limit → **over**;
  - otherwise → **"≥ value · At least"**, with a neutral bar. Never "below".
- **Nothing known:** "— · Not known".
- **Nothing logged:** unchanged ("no data yet").

## What the member and coach see
- **Today, the Nutrition link:** "Nutrition & micronutrients · 2/31 met · 29 not known".
- **Nutrition sheet:**
  - title: "2 of 31 targets met · 29 not known", or "Not known for these foods";
  - each row: a value, "≥ value" with "At least", or "—" with "Not known";
  - sodium: "≥ 119 / 2300 mg max · At least" instead of a green tick;
  - a note under the tabs: "Some foods you logged don't list every nutrient. Those totals show as “at least” or “not known”, never as zero.";
  - tab counts show "· N?" when some are unknown.
- **Count badges are neutral when anything is unknown.** Red and amber now mean a known shortfall only.
- **Coach → member → day → Key Nutrients** uses the same calculation, the same inputs (food, supplements, sunlight, the coach's targets) and the same rows as the member's sheet ("0/11 · 11 not known"). This also ends the coach/member mismatch on the multivitamin.
- **Coach AI "<food> nutrition" answer:** "fibre not known · Iron not known · calcium not known · vitamin C not known" for a food whose record has none of them, instead of "0 mg".

## Follow-up after the first push (9778124): two counts still disagreed
Reviewing the evidence screenshots, I found that my first push did not fully deliver "the coach sees what the member sees":
- **Coach Key Nutrients left out sunlight.** A member who ticked sunlight saw "Vitamin D 1000 / 800 IU · 125%"; the coach saw "Not known". The coach view now takes the member's active activities the same way Today does. The profile names the coach's choice `protocol_activities`, and the member's protocol calls it `activities`, so the view maps one to the other.
- **The Food sheet's nutrient badge left out the coach's adjusted targets.** For a member with adjusted targets, it could show a different count from the Nutrition sheet and the Today link. It now receives them.
- **Proof (local, same member and day, sunlight ticked):**
  - sunlight in the coach's plan: the coach's 11 rows are identical to the member's own sheet, with vitamin D at 125% met;
  - sunlight not in the plan: identical again, with vitamin D "Not known";
  - **on the 9778124 build** the same check fails: member "125% met", coach "Not known".
- **Gate check added (ui-tests):** every place that counts micronutrients passes sunlight, the active activities and the coach's targets, and the Food sheet passes the targets. It fails on 9778124 and passes now.

## Found while verifying: the start-up recovery screen (fixed here)
The local robot failed 11 checks with a gold "Reload app" button. The cause was not 2i: it was there before.
- **Stuck screen:** if the app takes more than 10 s to start (a slow phone or network), the watchdog shows "FitLife couldn't load". When the app arrived a moment later, **nothing took that screen down.** The member saw an error over a working app, and the only button wipes the cache and reloads, which is slower again. Locally, one slow reload after the theme switch left it over every light-theme screen.
  - **Fix:** `main.jsx` hides it as soon as the app starts.
- **Gold:** that screen (`client/index.html`) was still gold and dark-only. It is now green, in both themes.
  - The colour checks only read `client/src`, so they missed it. They now read `index.html` and `client/public` too.
- **Crash screen** (`ErrorBoundary.jsx`): its background followed the theme but its text was fixed near-white, so in light theme "Something went wrong" was almost invisible. It now uses the theme's text colours.

## Robot check R16: sturdier, not weaker
- **R16** (sign out on a shared phone; the next member sees only their own day) failed in 3 of 14 local runs with "Waiting for selector failed" after about 9 s, not at its 20 s limit.
- **Cause:** sign-out shows the login screen, then loads `/login` afresh (`authStore.js:100`). A wait that is running when that load lands is cut short. The member still ends up on a clean login page.
- **Change (`robot-phone-run.mjs`):** the wait for the login box keeps going through that page load, within the same 20 s. Every assertion is unchanged: an empty PIN box, then the second member sees none of the first member's note or weight.

## Limits (stated plainly)
- **A partly filled group can't be told apart.** If a food's record fills iron but leaves zinc at 0, the zinc 0 counts as real. That is what the data says, and nothing in it shows otherwise. Fixing it needs the food records to keep `null` for unrecorded values, at the source (a data change, not done here).
- **A food that really has none of a whole group counts as unknown** (sugar or oil: no vitamins or minerals at all). Its 0s show as "not known" until the record fills something in that group. This is the safer mistake: it never shows a false shortfall or a false "within limit".
- No database change. Stored values are untouched; only how they are read changed.

## Tests (none weakened)
- **`test-day-lib.js` [3], three expectations changed, with the reason in the file:**
  - the sample day: 19 → **18 met, 13 not known**. Sodium was "met" because the 130 g of that day with no sodium data counted as 0; it is now "≥ value, at least";
  - a day with no micronutrient data: `{met 0, total 31}` → `{met 0, unknown 31, known 0, total 31}`;
  - the RDA override case: 20 → 19, for the same sodium reason.
  - Added: a check that explains the sodium result, and a "nothing logged" check.
- **`test-day-lib.js` [3b], NEW, 14 rule checks:** group detection, explicit null, partial coverage, met with unknown, the upper limit, the coach/member agreement.
- **Mutation:** treating zero-filled records as known again → 5 checks fail. Restored → 298/298.
- **NEW `test-nutrient-unknown.js`** (real Postgres, 2 checks): the coach's food answer. Added to the gate's database suites in `test-local.sh`.
- **`ui-tests.mjs`:**
  - the real Nutrition sheet: B12 / iron / sodium statuses, the note, the header equal to the Today count, the neutral badge;
  - the coach day view and the Today tile use the shared calculation (static);
  - **slow start, both themes (10 checks):** the app's main file is held back 11.5 s under the production security policy. The recovery screen appears while the app is still loading, has no gold, has a green button and ≥ 4.5:1 text, and **goes away once the app starts**.
  - **Mutation:** with the old `index.html` and without the `main.jsx` fix, 6 of the 10 fail (gold, not green, the screen stays up). With the fixes, 10/10.
- **`test-layout-contracts.js`:** no gold in `index.html` or `client/public`; the recovery screen has a dark version; the crash screen uses theme colours. All three fail on the old files (mutation-checked).

## Files
- **NEW:**
  - `DELIVERY-FIXES-2i.md`
  - `server/scripts/test-nutrient-unknown.js`
- **Changed (client):**
  - `client/index.html`
  - `client/src/main.jsx`
  - `client/src/lib/day/macros.js`
  - `client/src/components/today/DayWidgets.jsx`, `DayStrip.jsx`, `TodaysPlan.jsx`
  - `client/src/components/sheets/NutritionSheet.jsx`, `FoodSheet.jsx`
  - `client/src/components/coach/DayDetail.jsx`
  - `client/src/components/ErrorBoundary.jsx`
  - `client/src/pages/Today.jsx`
  - `client/dist/` (rebuilt app)
- **Changed (server):**
  - `server/routes/aiChat.js`
  - `server/scripts/test-day-lib.js`, `test-layout-contracts.js`, `test-local.sh`, `ui-tests.mjs`, `robot-phone-run.mjs`
- Nothing renamed or deleted.
