# FitLife — Fixes-2h: raw or cooked, stored end to end (18 Oct 2026)

Test branch only. Production is unchanged and needs Sachin's explicit approval.
Backlog item **B1** (audit P1, "Store raw or cooked preparation basis").

## What it does
Whether a food's nutrition numbers are for the **raw** or the **cooked** food is now stored, instead of guessed from the name.

| Where | What is stored | Who sets it |
|---|---|---|
| Shared food row (`foods.preparation`, plus `preparation_by` and `preparation_at`) | raw / cooked / not specified | a coach (review queue) or an admin (food form); who and when are kept |
| Member's own label (`member_foods.preparation`) | raw / cooked / not specified | the member, in the "Edit macros" editor ("These numbers are for: Raw · Cooked · Not sure") |
| Logged item, saved meal, meal-plan item (JSON) | a copy, taken when the food is chosen | carried automatically; history keeps what it was logged as |

**Existing foods stay "not specified".** Nothing is back-filled from names. A test checks that no row carries a value nobody set, and that the schema has no back-fill statement.

**The name is still a fallback, and now says so.** The weighing hint reads the stored value first:
- **Stored:** "These numbers are for the cooked food — weigh it cooked, as you eat it."
- **Name only:** "The name says cooked, so these numbers are **probably** for the cooked food — weigh it cooked…"
- **Stored value and name disagree:** the existing "check which the numbers are for" message stays.

## The data path (every place a food moves)
- **Food search, food by id, the admin list, the review queue:** each returns `preparation`.
- **Coach:** new `PATCH /api/foods/:id/preparation` (coach or admin; 403 for members; 400 for anything but raw / cooked / not specified; `null` clears it, along with who and when).
- **Admin create and edit:** accept it.
  - An edit that doesn't mention it leaves it alone.
  - `""` (the form's "Not specified") clears it.
- **AI logging (`enrichFromDB`):**
  - A matched food carries the stored value, overriding anything the model said.
  - An unmatched food is **not specified**: the model's own raw/cooked claim is never passed on as if it were checked.
  - The member's own label carries their answer, for them only.
  - The "as eaten" tie-break now reads a stored "cooked" or "raw" as well as the word in the name. With two "Prepdal" rows tied, the cooked-marked one (110 kcal per 100 g) is chosen, not the raw one (340). The guard was mutation-tested: removing those two ranking lines makes the test fail.
- **AI apply (`memberLogApply`) and saving the day:** keep raw/cooked and drop anything else.
- **Recent foods:** return it.
- **Saved meals:** keep raw/cooked, and drop anything else, such as "fried".
- **Meal plans:** an item takes raw/cooked only from a matched food row. The model's claim on an unmatched item is cleared. Logging from the plan, and an approved swap, carry it.
- **Plate photo:** planned rows keep the plan's value; extras never take the model's.
- **Client, everywhere a food is picked:** food search, barcode lookup, recent foods, the member's labels, logging a plan meal, the AI review's "Edit macros", the plate-photo editor.

## Screens
- **Food sheet:** the weighing hint, stored versus name-only (two screenshots per theme).
- **Edit macros:** "These numbers are for: Raw · Cooked · Not sure", with a one-line how-to-weigh note. It starts at "Not sure" unless the food already says.
- **Admin → Foods → review queue:** "Numbers are for: Raw · Cooked · Not specified". It saves on tap, recording who and when.
- **Admin → Foods → edit form:** a "Numbers are for" select.

## Tests (none weakened)
- **NEW `server/scripts/test-food-preparation.js`** (real Postgres over real HTTP, 36 checks):
  - columns and constraints;
  - "not specified" by default, with no back-fill;
  - coach set and clear, member 403, bad value 400, unknown food 404;
  - every read returns it;
  - admin create and edit (set, keep, change, clear, coach 403);
  - AI matching (stored value wins, model claim dropped, tie-break by mark, then without marks);
  - member labels (set, refuse, list, coach view, AI uses them for that member only);
  - saved meals;
  - day save, AI apply, recent foods;
  - meal plans and plate photos.
  - Added to the gate's database suites in `server/scripts/test-local.sh`.
- **`ui-tests.mjs`:**
  - the weighing hint states stored versus name-only;
  - the food search renders the real FoodLog: stored hint, Add carries "cooked", and a typed food is not specified;
  - the Edit macros editor offers Raw · Cooked · Not sure, and Cooked reaches both the saved label and the logged item, while "Not sure" leaves `null`.
- **`test-member-plan.js`:** plan logging and swaps carry raw/cooked.
- **Kept, not changed:** `test-member-foods` asserts that no `ALTER TABLE foods` follows the member-labels table in `schema.sql`. The new foods columns sit with the other foods columns (after `default_grams`), and only the member-label column follows its table. Both schemas were applied twice to real Postgres.
- **`FoodLog.jsx` stays under its 800-line limit (799).** The limit was not raised.

## Results (local, build index-DZZ3VMjX.js)
- **Gate:** all suites pass, 5,840 assertions (food-preparation 36, member-foods 59, layout contracts 170, ui-tests 907).
- **Robot (local):** 49 passed cleanly, 0 retries, 0 failed.
- **2h screens at 360 px, both themes:** 12/12. These include the database check that a coach/admin tap stores raw with who and when.

## Live database check (added after the first push)
New robot check **R11d** opens the food sheet on the live test site, searches "rice" and reads the server's reply. It passes only if the reply is 200 and every food carries a raw/cooked field (raw, cooked or not specified). A missing column would make the search fail, so this proves the test database was migrated.

## Not done here
- **Pre-marking existing foods:** that is a coach task, done in the review queue or the food form. The code doesn't guess.
- **Raw/cooked on the coach's diet-plan editor rows:** not shown. They take it from the matched food.
- **Real-phone checks:** still open (REAL-PHONE-CHECKS.md).

## Files
- **NEW:**
  - `DELIVERY-FIXES-2h.md`
  - `server/services/foodPreparation.js`
  - `server/scripts/test-food-preparation.js`
- **Changed (server):**
  - `server/db/schema.sql`
  - `server/routes/foods.js`, `aiChat.js`, `logs.js`, `platePhotos.js`, `dietPlans.js`
  - `server/services/memberFoods.js`, `memberLogApply.js`, `dietPlan.js`, `platePhoto.js`
  - `server/scripts/test-local.sh`, `ui-tests.mjs`, `test-member-plan.js`
- **Changed (client):**
  - `components/FoodLog.jsx`
  - `components/food/MacroEditor.jsx`, `WeighingHint.jsx`, `useMemberLabels.js`, `PrescribedMeals.jsx`
  - `components/chat/ChatFoodMacros.jsx`, `AIFoodReview.jsx`
  - `components/AIChatLog.jsx`
  - `components/sheets/PlatePhotoSheet.jsx`
  - `hooks/useTodayModel.js`
  - `lib/day/planMeals.js`
  - `utils/foodProvenance.js`
  - `pages/AdminFoods.jsx`
  - `client/dist/` (rebuilt app)
- Nothing renamed or deleted.
