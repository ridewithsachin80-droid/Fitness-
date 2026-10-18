# Nutrient enrichment pilot (Fixes-2k, 18 Oct 2026)

**Proposed only. Nothing here has been applied to the live test database or production.**

| File | What it is |
|---|---|
| `pilot-review.md` | The review table for Sachin: every eligible food, the decision, the source, the matching assumptions, discrepancies, the proposed values and how each will be labelled. |
| `pilot-review.csv` | The same, one row per food and nutrient (for a spreadsheet). |
| `pilot-proposals.json` | The batch payload: 240 values for 12 foods, each with its source record, basis, unit and (for recipes) the working. Ready for `POST /api/nutrient-enrichment/batches`. |
| `pilot-mapping.json` | The matching decisions: which record or recipe each food was matched to, and why. |
| `live-inventory-8a16b38.jsonl` | The exact live records (read-only inventory, published by robot check R13b on commit 8a16b38). |
| `pilot-dry-run.log` | The local dry run on a copy of those records: propose, apply, member and coach screens, rollback, exact restore. |
| `tools/` | The scripts that made all of the above (developer tools; not part of the app or the gate). |

## Sources
- **USDA SR28:** National Nutrient Database for Standard Reference, Release 28, the data FoodData Central publishes as "SR Legacy". File `ABBREV.txt` from npm `fda-nutrient-database` 1.0.2. A blank means "not analysed" and is not used; a 0 is a value.
- **IFCT 2017:** Indian Food Composition Tables 2017, ICMR–National Institute of Nutrition. Open transcription from npm `ifct2017` 2.1.2 (AGPL-3.0). It is used for lookup only; the package is not shipped in the app.
  - This copy writes 0 for both "none" and "not analysed", so no IFCT 0 is used.
  - Some rows are broken (the oils at 0 kcal; one chicken row at twice its macros), so a row is used only when its stated energy matches its own macros.
  - Plant vitamin D2 is not used (see the review table, item 6).
- **Retention factors:** IFCT 2017, by cooking method.
- **Not used:** live USDA FoodData Central lookups. They need a permission for each web request in this workspace; SR28 is the same data offline.

## Rules applied (also enforced by `server/services/nutrientEnrichment.js`)
- **Targets:** AI-created foods that nobody verified or checked only.
- **What is filled:** only empty values and uncertain old zeros. Existing values, including the AI's, are never overwritten.
- **Each value carries:** its dataset, record id and name, raw/cooked basis, assumptions, the date and a review status ("pending").
- **Recipe values are recomputed by the server**, and refused if they disagree with their own working.
- **No AI estimates are proposed.** Unsupported values stay unknown.

## After approval (Sachin's decision; not done)
1. An admin creates the batch from `pilot-proposals.json`. That only proposes, and the server re-checks every value.
2. They review the batch rows, then apply with the typed confirmation "apply batch N".
3. If anything looks wrong: `POST /api/nutrient-enrichment/batches/N/rollback` restores every value. A value edited after the batch is left alone.

## Reproduce
```
mkdir -p /tmp/pilot-data/ifctpkg/x /tmp/pilot-data/sr28/x && cd /tmp/pilot-data
(cd ifctpkg && npm pack ifct2017@2.1.2 && tar -xzf ifct2017-2.1.2.tgz -C x)
(cd sr28 && npm pack fda-nutrient-database@1.0.2 && tar -xzf fda-nutrient-database-1.0.2.tgz -C x)
cd <repo>/qa/nutrient-pilot-2k/tools
PILOT_DATA=/tmp/pilot-data node pilot.mjs ../live-inventory-8a16b38.jsonl ../pilot-mapping.json /tmp/pilot-out
PILOT_DATA=/tmp/pilot-data node review-md.mjs /tmp/pilot-out/pilot-rows.json /tmp/pilot-out/pilot-review.md
```
