# FitLife — Fixes-2k: missing is not zero, every value says where it came from, and an evidence-backed enrichment pilot (18 Oct 2026)

Test branch only. Production is unchanged and needs Sachin's explicit approval.
Backlog **B12**, and Sachin's 2k brief.

**No enrichment has been applied to any live database.** The pilot is a proposal for review. Apply is admin-only, needs a typed confirmation, and is capped at 20 foods.

## 1. Missing is stored as missing (B12)
- **Storage:** a nutrient nobody recorded is stored as **null**, never 0 (`server/services/nutrients.js`).
  - Calories, protein, carbs and fat stay numbers: every calorie total depends on them.
  - Nothing is ever NaN or undefined.
- **Sachin's rule:** other filled vitamins or minerals no longer prove a zero is genuine.
  - The 2i "group" guess is gone from the member and coach screens.
  - The same guess (`isProfiled`) is gone from the coach's adaptive engine.
  - A 0 is real only when its status says it was recorded or referenced.
  - The engine keeps one physical exception: refined oil, ghee and sugar carry no minerals.
- **Existing records are not rewritten.**
  - An old 0 with no status stays stored as 0, and every screen reads it as **not known** (uncertain).
  - An old positive value reads by the record's origin: an AI estimate if the food was AI-created and never checked, otherwise recorded.
- **Member logs are never rewritten.** A logged item keeps the snapshot it was logged with. Enrichment never calls the opt-in history push (`foodPropagate`).
- **Write paths changed:**
  - AI chat food learning, AI food identify/confirm, coach-chat meal plans and diet-plan items: the AI's values are **AI estimates**, and an AI "0" is not kept as a value.
  - The prompt now asks for null when the AI doesn't know. It also states each nutrient's unit: the old line said "milligrams" for everything, but B12, folate, vitamin A, K and selenium are stored in micrograms and vitamin D in IU.
  - **Barcode (Open Food Facts):** only what the label declares. A declared 0 is a recorded 0; anything the label leaves out is null.
    - **Unit bug fixed:** vitamin D was stored in grams, not IU.
  - **Admin/coach food form:**
    - typed values are "recorded", with who and when;
    - an edit marks only what it changed;
    - blank boxes stay blank (null) instead of 0.
  - The cooking-fat split for fried dishes is marked as an estimate.

## 2. Per-nutrient provenance
| Status | Meaning | Counts as |
|---|---|---|
| **Reference value** | matched to IFCT 2017, USDA SR28 (FoodData Central "SR Legacy") or an exact label record | confirmed |
| **Recorded** | typed by a coach or admin, a member's label, a barcode label, a seeded database row | confirmed |
| **Recipe estimate** | calculated from ingredients, cooked yield and retention factors | estimate |
| **AI estimate** | from the AI | estimate |
| **Unknown** | nothing recorded, or an old uncertain 0 | — |

- **Where it lives:**
  - `foods.nutrient_meta` (NEW column): the source record and link, raw/cooked basis, assumptions, recipe working, date, reviewer and review status, and the batch.
  - `per_100g._status`: a compact copy that travels with every copy of the food (logged items, saved meals, plans).
- **Consistent everywhere:**
  - **Member sheet, Today link and quick badge:**
    - "~" marks a total that includes an estimate;
    - a target reached only with estimates shows **"Estimate"**, never "met";
    - counts read "6/31 met · 3 estimated · 22 not known";
    - estimates and unknowns are never red.
  - **Coach day view:** the same rows from the same function.
  - **Coach AI food answer:** "2.9mg (IFCT 2017)", "~4mg (AI estimate)", "not known".
  - **Admin food form:** each value shows its status.
  - **Coach meal-plan builder:** "≥" and "~", not a red 0.
  - **Coach adaptive insight:** gaps are claimed only on confirmed figures.
  - **Exports:** none print micronutrients (checked: printed coach report, plan PDF, weekly report, digests).

## 3. Enrichment (reversible, source-backed)
- **Targets:** unchecked AI-created foods only.
  - Protected: verified foods, foods a coach checked, seeded IFCT/USDA rows, barcode labels and coach/admin entries.
- **Fills only** an empty value or an uncertain old 0.
  - Never a value above 0, and never a value that has a status: a valid 0 stays.
- **Every proposal is checked:**
  - **Units are converted:** g / mg / mcg, and vitamin D mcg → IU. Vitamin A in IU is refused, because the conversion depends on the form.
  - **Basis:** per serving is converted to per 100 g.
  - **Raw or cooked must match the food.**
  - **A reference needs** a dataset and a record id.
    - An IFCT 0 is refused: the open copy writes 0 for both "none" and "not analysed".
    - A USDA SR28 0 is a value (SR28 leaves "not analysed" blank).
  - **A recipe value is recomputed** from its own ingredients, yield and retention factors, and refused if it disagrees.
  - **An AI estimate can't claim a reference dataset.** Two models agreeing is not verification.
- **Batches** (`nutrient_enrichment_batches` and `_changes`, NEW tables):
  - **propose:** changes no food;
  - **apply:** admin, typed "apply batch N"; it re-checks each value and skips any that changed since it was proposed;
  - **roll back:** restores each before-value and status, and leaves alone any value edited after the batch.
- **Routes:** NEW `server/routes/nutrientEnrichment.js` at `/api/nutrient-enrichment`.
  - inventory: coach or admin, read-only;
  - batches, apply and rollback: admin only.

## 4. Found while building: admin food edit wiped nutrients (fixed)
- The admin food list sends only calories.
- Editing a food from the list opened the form without the food's nutrients. Saving without changing anything wrote the form's defaults over every vitamin and mineral: all 0 before today, and calories too unless retyped.
- **Fix:** the form now loads the full food first.
- **Proven in the browser:** open from the list, save unchanged; iron 1.8 (recipe), calories 140 and vitamin C 12 are all kept.
- **Older than 2k.** Foods edited this way before today may have lost values. The inventory shows foods whose micronutrients are all 0, but it can't tell this cause apart from others.

## 5. The live inventory
- New robot check **R13b** reads `/api/nutrient-enrichment/inventory`, read-only, with the robot coach's own session.
- It publishes the inventory with the robot report on the commit: eligible foods, per-nutrient empty / uncertain 0 / old value / with-status counts, and the 40 most-logged eligible foods with their exact records.

## Results (local)
- Gate: all suites pass, 5,994 assertions (nutrient-provenance 46, day-lib 307, adaptive 55, nutrition-contract 83, ui-tests 952).
- Robot (local): 51 passed cleanly (with the new R13b), 0 retries, 0 failed.
- 2k screens at 360 px, both themes: all checks pass (member sheet, Today link, coach Key Nutrients, admin form, save-unchanged keeps values).

## Tests (none weakened; changes stated)
- **NEW `server/scripts/test-nutrient-provenance.js`** (real Postgres, real HTTP, 46 checks): storage, reads, server/client agreement, every enrichment rule, a full propose / apply / skip / roll back / rollback-conflict cycle, a member's earlier log untouched, permissions, the inventory changing nothing, and member/coach consistency.
- **`test-day-lib.js` [3c], NEW, 8 checks:** statuses, estimate vs met, a recipe value below target, sodium over the limit only by an estimate, supplements, old logs read but never rewritten.
- **`ui-tests.mjs`:**
  - a 2k panel with mixed provenance: met with "~", "Estimate", "Not known", the note, and a count matching Today;
  - the admin form keeps blanks null, shows statuses, and loads the full food before editing;
  - the coach chat card never shows the status map as a nutrient.
- **Changed tests, each to Sachin's rule:**
  - `test-adaptive.js`: 3 checks changed and 1 added.
    - B12 missing on rice and dal is no longer a true zero;
    - mixed-day B12 coverage 60 → 0;
    - `hasFigure(rice, B12)` true → false;
    - NEW: a B12 zero from a reference is still reported as 0%.
  - `test-nutrition-contract.js`:
    - "an empty food is all zeroes" → the core figures are 0 and every other nutrient null;
    - "junk becomes 0" → junk iron is null;
    - "no NaN reaching the database" now skips the status map, which isn't a nutrient;
    - "curd is not a fried dish — untouched" and "a trace of fat is not worth splitting" expect null (never recorded) instead of 0;
    - 2 checks added. The no-NaN, no-undefined guarantee is unchanged.
  - `test-diet-plan.js`: "a food with no nutrition at all yields zeroes, not undefined" now expects calories 0 and every other nutrient null, never undefined.
  - `test-member-foods.js`: "every nutrient field present" now expects B12 nobody recorded to be null (it was 0); every field is still present.
  - `test-nutrient-unknown.js` (from 2i):
    - the AI-created "Greens" answer now reads "~3mg (AI estimate)", and its vitamin C 0 and fibre 0 are "not known" (no group guess);
    - NEW check: the same food recorded by a coach shows the numbers and real zeros.
  - Four sandbox tests (`test-mixed-request-answer`, `test-sleep-clarification`, `test-draft-food-edits`, `test-food-clarifications`): `../services/nutrientStatus` is added to their list of pure modules, as 2j did for `targetOrigin`. No assertion changed.
  - `test-day-lib.js` [3b]:
    - "a 0 inside a group the record fills is measured" now expects the opposite;
    - a check added that a 0 with a status is real;
    - the Dal fixture's B12 0 is marked "reference" so its measured-zero checks keep their meaning;
    - [3] gains the new `estimate: 0` field. The counts are unchanged.
- **Mutation:**
  - enrichment allowed to fill an existing value → 4 checks fail;
  - rollback ignoring a later edit → 1 fails;
  - estimates counted as confirmed → 5 fail.
  - Restored → all pass.

## Files
- **NEW:**
  - `DELIVERY-FIXES-2k.md`
  - `server/services/nutrientStatus.js`, `server/services/nutrientEnrichment.js`
  - `server/routes/nutrientEnrichment.js`
  - `server/scripts/test-nutrient-provenance.js`
  - `client/src/lib/day/nutrientStatus.js`
- **Changed (server):**
  - `server/db/schema.sql` (`foods.nutrient_meta`, two batch tables, all `IF NOT EXISTS`)
  - `server/index.js` (mount)
  - `server/services/nutrients.js`, `adaptiveEngine.js`, `dietPlan.js`
  - `server/routes/foods.js`, `aiChat.js`, `aiFoods.js`
  - `server/scripts/test-local.sh`, `test-adaptive.js`, `test-nutrition-contract.js`, `test-day-lib.js`, `test-diet-plan.js`, `test-member-foods.js`, `test-nutrient-unknown.js`, `ui-tests.mjs`, `robot-phone-run.mjs`
  - `server/scripts/test-mixed-request-answer.js`, `test-sleep-clarification.js`, `test-draft-food-edits.js`, `test-food-clarifications.js` (pure-module list)
  - `.github/workflows/phone-robot.yml` (publishes the inventory)
- **Changed (client):**
  - `client/src/lib/day/macros.js`, `index.js`
  - `client/src/components/today/DayWidgets.jsx`, `DayStrip.jsx`
  - `client/src/components/sheets/NutritionSheet.jsx`
  - `client/src/components/coach/DayDetail.jsx`
  - `client/src/components/admin/EditMemberModal.jsx`
  - `client/src/components/AIFoodSearch.jsx`, `CoachAIChat.jsx`
  - `client/src/pages/AdminFoods.jsx`, `Today.jsx`
  - `client/dist/` (rebuilt app)
- Nothing renamed or deleted.
