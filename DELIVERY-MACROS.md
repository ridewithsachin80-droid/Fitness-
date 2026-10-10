# Delivery — macros eaten for every member, and "Edit macros" (10 Oct 2026)

Sachin's ask: *"need the calories macros to be shown in whats consumed for no plan for plan. build with edit option of macros calories should adjust accordingly"* — after a member's oats showed 13.2 g protein while the pack in their hand said 24 g.

## What members see

**Macros eaten, with or without a plan**
- Today → Today's plan → **Eat**: calories, then **Protein · Carbs · Fat** eaten.
  - With coach targets: `37 / 120 g` with a thin bar for each macro.
  - Without targets: just `37 g`. No target is made up.
  - Before this change, the row showed protein only, and only when a target was set.
- Today → **Logged today**: each meal now has a line under its foods, e.g. `P 10 g · C 52 g · F 4 g`.
- Food sheet:
  - With targets: the macro bars, as before.
  - Without targets: a new **Eaten today** card (kcal, protein, carbs, fat) saying the coach hasn't set targets yet.
- Food log, simple view: every food shows `kcal · P · C · F`.
  - Before, a member with no calorie target saw no numbers at all on each food.
  - Each meal header also shows P, C and F now (before, it showed calories only).

**Edit macros**
- Where it appears:
  - **Edit macros** on every logged food (food sheet).
  - **Edit macros** on every food in the AI chat preview, before Apply.
- How it works:
  - The member types protein, carbs and fat, either **per 100 g as printed on the pack** or **for the grams being logged**. A toggle switches between the two and converts the numbers.
  - Calories are worked out live: **4 × protein + 4 × carbs + 9 × fat**.
- "Use these every time I log <food>" is on by default and saves the numbers as **the member's own label**. That label is then used:
  - in the AI chat and the plate photo the next time that member logs the food (matched by name; "Oats (rolled)" also matches "Oats");
  - first in the food search, marked *your label*;
  - by "Quick re-add".
- Untick it to change just this one entry.
- "Stop using my label for <food>" removes the label. Food already logged keeps its numbers.

## What the coach sees
- Member page → **Nutrition** tab: a new card, **"<Name>'s own food labels"**. It lists each food, its P / C / F per 100 g, its kcal, and the date.
- The coach can see labels but not edit them. They are the member's reading of their own pack.
- **Full log** for a day: foods logged with the member's own numbers are tagged *member's own label*.

## What did NOT change
- The shared food table is never written. Plain oats stay 13.2 g protein for every other member.
- The food-learning step skips labels.
- Fibre, vitamins and minerals are kept from the food the label replaces, because packs rarely list them.

## Things to know
- **Calories can differ from the pack by a few kcal.** The 4/4/9 rule ignores fibre (about 2 kcal/g) and rounding. The app says so under the number.
- **Matching is by name.** If the AI names the food differently next time (e.g. "Rolled oats" when the label is "Oats"), the label is not used. The member can edit that entry and save, which creates a second label.
- **Offline edits:** if the phone was offline and the same day was changed elsewhere meanwhile, the server's copy of that food wins. This is the existing offline rule from 5 Oct.
  - An *online* save from an out-of-date screen does keep the macro edit. This is new: the merge now tracks macros as well as grams.

## Files

### New (10) — all added, nothing renamed
| Destination | What |
|---|---|
| `server/services/memberFoods.js` | Label rules (4/4/9, validation), save / find / list / forget |
| `server/routes/memberFoods.js` | `/api/member-foods` routes (member: GET / PUT / DELETE; coach: GET `/member/:id`) |
| `server/scripts/test-member-foods.js` | New DB suite, 59 checks |
| `client/src/api/memberFoods.js` | API calls |
| `client/src/components/food/MacroEditor.jsx` | The editor |
| `client/src/components/food/useMemberLabels.js` | The member's labels for the food log |
| `client/src/components/chat/ChatFoodMacros.jsx` | Macros and "Edit macros" on a chat preview row |
| `client/src/components/today/EatenMacros.jsx` | Protein / carbs / fat eaten (cells, plus the no-target card) |
| `client/src/components/coach/MemberLabelsCard.jsx` | The coach's list |
| `DELIVERY-MACROS.md` | This note |

### Changed
- `server/db/schema.sql`: new table `member_foods` (CREATE TABLE IF NOT EXISTS; runs on boot).
- `server/index.js`: mounts `/api/member-foods`.
- `server/routes/aiChat.js`:
  - the chat and the photo use the member's label;
  - food learning skips labels.
- `server/services/dayMerge.js`: a macro edit survives a merge.
- `server/scripts/test-local.sh`: runs the new suite.
- `server/scripts/test-day-lib.js`, `server/scripts/ui-tests.mjs`: new tests.
- `client/src/lib/day/macros.js`: 4/4/9 maths, `labelFromEntry`, `withLabel`, `macroLine`.
- `client/src/hooks/useTodayModel.js`: `eaten`, `macroTargets`.
- `client/src/utils/logSync.js`:
  - the day save keeps the label mark (it was being dropped);
  - the base now carries the macros.
- `client/src/components/today/TodaysPlan.jsx`, `client/src/components/today/Timeline.jsx`, `client/src/components/sheets/FoodSheet.jsx`, `client/src/components/food/TrafficBadge.jsx`, `client/src/components/FoodLog.jsx`, `client/src/components/AIChatLog.jsx`, `client/src/components/coach/DayDetail.jsx`, `client/src/pages/Monitor.jsx`

## QA
- The full gate is green: **3,874 assertions** (up from 3,721). That covers the client build, the logic suites, 46 DB suites on a real Postgres, lint, and 804 UI checks in jsdom plus headless Chrome at 320, 360 and 390 px, with no sideways scroll.
- Mutation-checked, so each test fails when the code it guards is broken:
  - 14 of 14 server mutations caught;
  - 16 of 16 UI mutations caught.
- The UI test caught one real bug before delivery: the day save dropped the label mark.
