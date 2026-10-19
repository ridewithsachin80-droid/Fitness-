# FitLife — Fixes-2l: the 19 Oct review's eight corrections (19 Oct 2026)

Test branch only. Production (`main` 1ca6ae7) is unchanged and needs Sachin's explicit approval.
Backlog **B12** (reopened by the review) and **B14** (the pilot, still awaiting Sachin).

**No enrichment has been applied to any live database.** Nothing in this delivery writes a food value. The pilot is now candidates only: the server refuses every one of them until Sachin or a coach confirms the food.

## 1. Missing or malformed numbers are refused, never read as 0
- **The bug:** the enrichment validator ran `Number(value)` first. `Number(null)`, `Number("")`, `Number("  ")`, `Number(false)` and `Number([])` are all 0, so each was accepted as a reference value of 0. `recipePer100` did the same for an ingredient with no value.
- **Now:** every number must be a finite number, or a string in plain decimal form ("0.49"). Null, blank, whitespace, true/false, arrays, objects, Infinity, NaN, "1e3", "0x10" and absent values are refused with a message naming the field.
- **Covers:** nutrient values, ingredient grams and values, cooked yield, serving weight and retention factors.
  - An absent retention factor means the documented default (1, nothing lost).
  - A retention factor that is given but invalid is refused. It never becomes the default or 0.
- A genuine 0 is kept where the source supports it (USDA rice B12 0).
- `server/services/nutrientEnrichment.js` (`finiteNum`).

## 2. An estimated 0 stays an estimate
- **The bug:** estimates were detected with `estimated > 0`. A recipe-estimated sodium 0 showed as a confirmed "met" (within the limit), and a recipe-estimated iron 0 as a definite measured "zero".
- **Now:** whether estimates are involved is a fact about the foods (any estimated grams), not about their sum. Both cases now read "~0 · Estimate".
- **One rule everywhere:** the member's Nutrition sheet, the counts and quick badge, the Today tile and the coach's Key Nutrients all read `microStatus` (`client/src/lib/day/macros.js`).
- **Found in this pass, missed by the draft: the coach's meal-plan builder.** Its nutrient summary (`EditMemberModal.jsx`) still used `estimated > 0` and put "≥" in front of totals that included estimates. It now uses the same rule through a shared helper, `microCell`.
- **The coach's adaptive insight** (`server/services/adaptiveEngine.js`) now says what each nutrient gap rests on: confirmed figures, estimates, or both. A gap resting on estimates shows "~50% · Estimate", and the caption says it is not a confirmed shortfall.

## 3. "At least" rests on confirmed amounts only
- **The bug:** AI iron 10 mg plus a food with unknown iron showed "≥ 10 · At least". An AI estimate is not a guaranteed minimum.
- **Now:** three quantities are kept apart on every row: confirmed, estimated and unknown.
  - **Confirmed and unknown:** "≥ 2 · At least".
  - **Confirmed, estimated and unknown:** "≥ 2 +~10 · At least". The minimum is the confirmed 2; the AI's 10 is shown apart.
  - **Only estimated and unknown:** "~10 · Estimate", with no "≥".
  - **On a partly unknown row**, the bar shows only the confirmed part.
- The same in the coach's meal-plan summary, where the percentage comes from the confirmed amount only.

## 4. Sunlight is not vitamin D intake
- **The bug:** ticking "Sunlight Exposure" added 1000 IU of confirmed vitamin D and could mark the target met, even when the food's vitamin D was unknown.
- **Now:** sunlight stays on the activity checklist but no longer counts in any nutrient total or target, for member or coach. The footnote now says: "Includes food + supplements. Sunlight stays on your activity list — it isn't a measured vitamin D amount."
- **Supplements: unchanged, and it needs your decision (new backlog B17).** A ticked supplement still adds a fixed amount as confirmed (vitamin D3 60,000 IU weekly = 8,571 IU a day; the multivitamin's assumed label). The review asks that this reflect the actual product, dose and timing. See section 9.

## 5. Every pilot food is a candidate
- **All 14 matched foods** (12 with values, 2 held) carry `identity: "candidate"` and say what must be confirmed: Greens, yogurt, chia, dark chocolate, black sesame, rice, mudde, date paste, and the vegetables' raw or cooked state.
- **The server refuses** a reference or recipe value unless its food's identity is `"confirmed"` with `identity_confirmed_by`. Closeness to the old AI numbers is never confirmation.
- **Rice:** the "not fortified" assumption is gone. India runs a fortified-rice programme; whether this rice is fortified is one of the confirmations.
- **`pilot-proposals.json`:** `proposals` (ready) is empty; the 240 values sit under `candidates`.

## 6. Amounts are checked against pinned, checked source extracts
- **Pinned extracts (NEW `server/data/nutrient-ref-extracts.json`):** the 21 source records the pilot uses, with:
  - the dataset's exact release, file checksums, record id, unit and basis;
  - what each nutrient means in that dataset;
  - the retention-factor table.
- **A reference amount** is accepted only if it matches its pinned record. The reviewer's fabricated rice B12 of 999 mcg is now refused.
- **A recipe** is recomputed from the pinned ingredient records and pinned retention factors. Each ingredient keeps its record id and cooking method in the saved value, so anyone can reproduce it.
- **Added in this pass: the official check.** Pinning a record makes it verifiable; it does not make it correct, because the pinned file was written from the same open copies the pilot used. So each record now carries `official_check`.
  - It is null until someone has compared the record with the official source.
  - The server refuses any amount resting on an unchecked record, and any retention factor while the factor table is unchecked.
  - **USDA records:** rice 20445 is checked against FoodData Central's SR Legacy record (fdcId 169757): all 28 pinned values agree. The other 15 are not checked yet: FoodData Central's public demo key rate-limited the build workspace after two lookups (dates 09087 agreed on 26 of 28 values; the 2 others differ only as rounding in the read-back, so it is left unchecked). Each is one page to compare by hand.
  - **IFCT records (ragi, spinach, tomato, onion, paneer):** not checked. The official NIN PDF is online, but its readable text stops after chapter 1 (55,160 characters); the tables are not machine-readable from here. Sachin or the reviewer needs to compare the values listed in the README with the PDF.
- **Approval is recorded:** NEW route `POST /api/nutrient-enrichment/batches/N/approve`, typed "approve batch N", admin only.
  - The approver, the time and a hash of the approved revision are stored on the batch.
  - Apply refuses a batch with no approval, or whose content changed after approval. **Added in this pass:** the hash covers everything stored with each value (source, recipe working, assumptions, identity), not just the number.
  - An applied value says `review_status: "approved"`, with the approver and revision. It no longer copies "pending".
- **Schema:** three columns added to `nutrient_enrichment_batches` (`approved_by`, `approved_at`, `approved_revision`), added automatically on boot. No other table or column changes.

## 7. Sources and portability
- **IFCT 2017:** the official NIN PDF (https://www.nin.res.in/ebooks/IFCT2017_16122024.pdf) is named in the pinned file, the README and the review table. The 2k note that no online copy existed was wrong.
- **Ragi vitamin D2:** the figure is in the printed table, so it is not a transcription error. It stays unapplied and is never replaced with 0.
- **USDA:** named exactly as SR28 (September 2015). SR Legacy's final release is April 2018 and is not assumed to be identical. Rice 20445 agrees with SR Legacy exactly.
- **Tools:** `pilot.mjs`, `pilot-local.mjs`, `pin-refs.mjs` and `review-md.mjs` resolve paths from their own location. The reference packages go in `PILOT_DATA`, which defaults to the system temp folder. No `/home/claude` path is left.

## 8. Kept as they were
Existing-value protection, before-value snapshots, rollback with its conflict check, the 20-food cap, and no bulk writes.

## 9. Your decisions (nothing here is decided for you)
- **B14, the pilot:** confirm each food's identity (listed in `qa/nutrient-pilot-2k/pilot-review.md`), and have the IFCT values compared with the official PDF. Then the confirmed foods can be proposed, approved and applied, in that order.
- **B17, supplements (NEW):** how a ticked supplement should count. My recommendation:
  - count it as an **estimate**, not confirmed, until the coach records the member's actual product and dose;
  - then count that recorded dose as confirmed.
  - The cost: until coaches record products, a ticked D3 or B12 shows "Estimate" instead of "met".

## Results
- **Gate (local, real Postgres 16 from `schema.sql`):** all 96 suites pass, **6,078 assertions** (2k: 5,995). day-lib 331, nutrient-provenance 93, adaptive 59, ui-tests 961, lint clean.
  - The first full run had one failure, in `test-timeline-meal-entry` (a 390 px light focus check), while other work shared the machine. It passed 80/80 twice on its own, and the second full run passed everything. This is the same suite that flaked once in 2k; backlog D6.
- **Mutation checks (12):** each new rule was broken on purpose; every one turned a test red, and each file was restored.

  | Rule broken | Result |
  |---|---|
  | Estimates detected by sum, not grams | day-lib: 6 fail |
  | "At least" on the estimated subtotal | day-lib: 2 fail |
  | Sunlight back in vitamin D | day-lib: 4 fail |
  | Coach plan summary: estimates by sum | day-lib: 2 fail |
  | Coach plan summary: "≥" on the total | day-lib: 1 fail |
  | null read as 0 | provenance: 6 fail |
  | Official check skipped | provenance: 5 fail |
  | Revision ignores stored details | provenance: 1 fail |
  | Amount not compared with the pinned value | provenance: 2 fail |
  | Apply without approval | provenance: 1 fail |
  | Candidate identity accepted | provenance: 3 fail |
  | Coach gap basis always "confirmed" | adaptive: 3 fail |
- **Local dry run** (`qa/nutrient-pilot-2k/pilot-dry-run.log`): on a local copy of the 25 live records, with candidates marked "local dry run (not a real confirmation)".
  - The real batch check accepted only the 22 rice values and refused the other 218, every one because its record is not officially checked yet.
  - Apply before approval was refused. After approval, the 22 applied, and a logged copy kept its statuses.
  - Rollback restored all 25 records exactly. 10/10 checks pass.
- **Screens at 360 px, dark and light:** the member's Nutrition sheet (vitamins and minerals), the coach's nutrient gaps, and the coach's meal-plan summary. Real components and the real built CSS in Chromium; no horizontal overflow; no page errors.
  - **Two layout fixes came from looking:** the coach's gap rows lost alignment when an "Estimate" tag appeared, and long figures ("≥ 60 +~900") pushed the meal-plan labels onto a second line. Both are fixed and shown in the screenshots.
  - **Estimate-based coach gaps are neutral, not amber,** keeping amber for warnings (the 2f rule). NEW ui-test check.
- **Reproducible pilot files:** re-running `pin-refs.mjs`, `pilot.mjs` and `review-md.mjs` from the documented commands reproduces `pilot-proposals.json` and `pilot-review.csv` byte for byte, and keeps the recorded official check.

## Tests (none weakened; changes stated)
- **`test-day-lib.js`:** NEW [3d] (15 checks, one of them a 14-case mixture table) and NEW [3e] (9 checks: the coach meal-plan summary, plus a source check that `EditMemberModal` uses the shared rule). No existing check changed.
- **`test-nutrient-provenance.js`:** NEW [4b] (malformed numbers, pinned amounts, recipes recomputed from pinned records, retention factors, identity, the official check, the pilot file), plus new HTTP checks in [5] (approval, tampering after approval, malformed numbers, candidates, the fabricated 999, an unchecked record). **Changed, with the reason in the file:**
  - [4] unit and per-serving checks now pass a small test registry, because every reference amount must now match a pinned, checked record. Their assertions are unchanged.
  - [5] the applied recipe iron was the literal 1.2 (from an invented retention of 0.5). It is now computed from the pinned spinach record and the pinned IFCT boiling factor.
  - [5] "an applied value has `review_status: pending`" now expects `approved`, with the approver and revision. The review asked for exactly this change.
- **`test-adaptive.js`:** 4 checks added (gap basis: confirmed, estimate, mixed, old AI items). None changed.
- **`ui-tests.mjs`:** coach gaps "~50% · Estimate", neutral styling; the member panel with sunlight, "≥ 2 +~10", "~10 · Estimate", the confirmed-only bar and recipe sodium 0. One comment updated; no check changed.

## Files
Destination paths are relative to the repo root (`Fitness--test/`). **NEW** files are marked. Nothing is renamed or deleted.

| Path | |
|---|---|
| `client/src/lib/day/macros.js` | estimates by presence, confirmed-only lower bound, no sunlight; NEW `microCell` |
| `client/src/components/today/DayWidgets.jsx` | member rows: "≥ confirmed +~estimate", confirmed-only bar, footnote |
| `client/src/components/admin/EditMemberModal.jsx` | coach meal-plan summary on the shared rule; layout |
| `client/src/components/MetabolicInsight.jsx` | coach gaps: "~N% · Estimate", neutral, aligned |
| `client/src/components/coach/DayDetail.jsx` | comment only |
| `client/dist/…` | rebuilt app (committed build) |
| `server/services/nutrientEnrichment.js` | strict numbers, pinned + checked sources, identity, approval, revision |
| `server/routes/nutrientEnrichment.js` | NEW route `POST /batches/:id/approve` |
| `server/services/adaptiveEngine.js` | gap `basis` |
| `server/db/schema.sql` | 3 columns on `nutrient_enrichment_batches` (added on boot) |
| `server/data/nutrient-ref-extracts.json` | **NEW**: pinned source extracts with official-check status |
| `server/scripts/test-day-lib.js`, `test-nutrient-provenance.js`, `test-adaptive.js`, `ui-tests.mjs` | tests |
| `qa/nutrient-pilot-2k/tools/pin-refs.mjs` | **NEW**: writes the pinned file; keeps official checks |
| `qa/nutrient-pilot-2k/tools/pilot.mjs`, `pilot-local.mjs`, `ref.mjs`, `review-md.mjs` | portable; candidates; source-check lines |
| `qa/nutrient-pilot-2k/README.md`, `pilot-mapping.json`, `pilot-proposals.json`, `pilot-review.csv`, `pilot-review.md`, `pilot-dry-run.log` | the pilot, as candidates |
| `DELIVERY-FIXES-2l.md` | **NEW**: this note |
