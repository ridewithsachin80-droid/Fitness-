# Nutrient enrichment pilot (Fixes-2k, 18 Oct 2026; revised in Fixes-2l, 19 Oct 2026)

**Candidates only. Nothing is ready to apply. Nothing here has been applied to the live test database or production.**

## What changed in Fixes-2l (after the 19 Oct review)
- **Every food is a candidate.** Its identity (food, preparation, brand or variety, recipe basis) must be confirmed by Sachin or a coach before any value can be proposed. The server refuses candidates. Matching the old AI numbers is not confirmation.
- **The rice "not fortified" assumption is removed.** India runs a fortified-rice programme. Whether this food is fortified is one of the confirmations.
- **Pinned records must also be officially checked (added late in 2l).** The pinned file was written from the same open copies the pilot used, so pinning alone proves only that a proposal matches that copy. Each record carries `official_check` (null until someone compares it with the official source). The server refuses a value resting on an unchecked record, and any retention factor while the factor table is unchecked. Checked so far: USDA rice 20445, against FoodData Central SR Legacy (all 28 values agree). Not yet: the other 15 USDA records (FoodData Central rate-limited the build workspace) and all 5 IFCT records (the PDF's tables are not machine-readable from here).
- **Amounts are checked against pinned source extracts.** These live in `server/data/nutrient-ref-extracts.json`, written by `tools/pin-refs.mjs`. A reference amount that is not in that file, or does not match it, is refused. So is a recipe ingredient value, or a retention factor, that disagrees with it. A fabricated 999 mcg rice B12 now fails.
- **Recipes carry their ingredient record ids and retention methods**, so another reviewer can reproduce each value without this folder.
- **Approval is recorded.** A batch must be approved (`POST …/batches/N/approve`, typed "approve batch N") before apply. The approver and a hash of the approved revision are stored. Apply refuses a batch whose content changed after approval. Applied values carry `review_status: "approved"`, the approver and the revision.
- **The tools are portable.** Paths resolve from each script's own location. Only `PILOT_DATA` (the downloaded reference packages) and the local server and database settings come from the environment.

| File | What it is |
|---|---|
| `pilot-review.md` | The review table for Sachin: every eligible food, its candidate match, the confirmation it needs, the source, discrepancies, the candidate values and how each would be labelled. |
| `pilot-review.csv` | The same, one row per food and nutrient (for a spreadsheet). |
| `pilot-proposals.json` | `proposals`: ready to propose (confirmed identities). **Empty now.** `candidates`: 240 values for 12 foods, each with its source record, basis, unit and (for recipes) the working. |
| `pilot-mapping.json` | The matching decisions, each with `identity` (`candidate` / `confirmed`), `identity_confirmed_by` and `confirmation_needed`. |
| `live-inventory-8a16b38.jsonl` | The exact live records (read-only inventory, published by robot check R13b on commit 8a16b38). |
| `pilot-dry-run.log` | The local dry run on a copy of those records (re-run in 2l: only the 22 rice values pass the official-check gate; propose → approve → apply → roll back restores all 25 records exactly). |
| `tools/` | The scripts that made all of the above. Developer tools, not part of the app or the gate. `pin-refs.mjs` is NEW in 2l. |

## Moving a food from candidate to ready
1. Sachin or a coach confirms what the food is (see "Confirmations needed" in `pilot-review.md`). If the answer differs from the candidate match, change `code`, or the recipe, in `pilot-mapping.json`.
2. Set `"identity": "confirmed"` and `"identity_confirmed_by": "<who, date>"` on that mapping.
3. If the chosen record is new, run `pin-refs.mjs`, then check the new record against the official source before committing.
4. Re-run `pilot.mjs` and `review-md.mjs`. Confirmed foods appear under `proposals`.

## Sources
- **USDA SR28:** National Nutrient Database for Standard Reference, Release 28. Files `ABBREV.txt` and `FOOD_DES.txt` come from npm `fda-nutrient-database` 1.0.2. Its README cites "Version Current: September 2015"; the pinned file records each file's SHA-256.
  - This is **SR28**. FoodData Central's "SR Legacy" final release is April 2018, and individual records may differ from SR28. These values are not described as identical to SR Legacy.
  - A blank means "not analysed" and is not used; a 0 is a value.
- **IFCT 2017:** Indian Food Composition Tables 2017, ICMR–National Institute of Nutrition. Lookup uses the open transcription in npm `ifct2017` 2.1.2 (AGPL-3.0); the package is not shipped in the app.
  - **The official PDF is online:** https://www.nin.res.in/ebooks/IFCT2017_16122024.pdf. (The 2k note said no online copy could be found. That was wrong.)
  - **Official-PDF check: not yet done by the builder.** The build workspace cannot download the PDF (network allowlist), and the PDF's text layer has no table values. The reviewer checked some ragi entries and the table headers, and found that several pilot ingredient values match. Still to check against Tables 1, 2, 3 and 5 of the PDF:

    | Record | Values to check (per 100 g, as pinned) |
    |---|---|
    | A010 Ragi | calcium 364 mg, iron 4.62 mg, D2 41.5 mcg (not used) |
    | C033 Spinach | iron 2.95 mg, vitamin C 30.28 mg (used by the test suites) |
    | L003 Paneer, G017 Onion, D076 Tomato | all pinned values (the paneer curry is held). Paneer's pinned sugar, 11.57 g per 100 g, looks high for paneer: check it first. |

  - **To record a check:** in `server/data/nutrient-ref-extracts.json`, set the record's `official_check` to `{ "result": "match", "against": "<the official source, table and page>", "by": "<who>", "date": "<YYYY-MM-DD>" }`. If a value differs, correct the transcription instead and leave the check null. `pin-refs.mjs` keeps a check only while the record's values are unchanged.

  - This copy writes 0 for both "none" and "not analysed", so no IFCT 0 is pinned or used.
  - Rows whose stated energy does not match their own macros are not used.
  - **Ragi vitamin D2:** the reviewer found it in the official printed table, so it is not a transcription error. It stays unapplied pending clarification and is never replaced with a 0. Only D3 is taken from IFCT.
- **Retention factors:** IFCT 2017, by cooking method. Pinned as `<nutrient>|<method>`. A missing retention factor on an ingredient means the documented default of 1 (nothing lost). An invalid one is refused.
- **FoodData Central** (SR Legacy, final release April 2018) is used only to check pinned USDA records, never as a value source.

## Rules applied (enforced by `server/services/nutrientEnrichment.js`)
- **Targets:** AI-created foods that nobody verified or checked.
- **What is filled:** only empty values and uncertain old zeros. Existing values, including the AI's, are never overwritten.
- **Numbers must be explicit (2l).** null, blank, whitespace, true/false, arrays, objects and infinities are refused, never read as 0. This covers values, ingredient grams and values, cooked yield, serving weight and retention. A genuine 0 is kept where the source supports it.
- **Each value carries:** its dataset and exact release, record id and name, nutrient definition, unit, source URL, raw/cooked basis, assumptions, identity confirmation, the date and its review state.
- **No AI estimates are proposed.** Unsupported values stay unknown.
- **Kept from 2k:** existing-value protection, before-value snapshots, rollback that refuses to overwrite later edits, at most 20 foods per batch.

## After confirmation and approval (Sachin's decision; not done)
1. An admin creates the batch from the `proposals` list. This only proposes, and the server re-checks every value.
2. A reviewer checks the batch rows, then approves with "approve batch N".
3. An admin applies with "apply batch N". Only the approved revision applies.
4. If anything looks wrong: `POST /api/nutrient-enrichment/batches/N/rollback` restores every value. A value edited after the batch is left alone.

## Reproduce (from any checkout)
The reference packages go in `PILOT_DATA` (default: `pilot-data` in the system temp folder). Every other path resolves from the scripts' own location.
```
export PILOT_DATA="${TMPDIR:-/tmp}/pilot-data"
mkdir -p "$PILOT_DATA/ifctpkg/x" "$PILOT_DATA/sr28/x"
(cd "$PILOT_DATA/ifctpkg" && npm pack ifct2017@2.1.2 && tar -xzf ifct2017-2.1.2.tgz -C x)
(cd "$PILOT_DATA/sr28" && npm pack fda-nutrient-database@1.0.2 && tar -xzf fda-nutrient-database-1.0.2.tgz -C x)
cd <repo>/qa/nutrient-pilot-2k/tools
node pin-refs.mjs ../pilot-mapping.json C033 09040     # rewrites server/data/nutrient-ref-extracts.json (keeps official checks on unchanged records)
node pilot.mjs ../live-inventory-8a16b38.jsonl ../pilot-mapping.json ./out
node review-md.mjs ./out/pilot-rows.json ./out/pilot-review.md
# Local dry run (needs a local server and database; refuses anything else):
node pilot-local.mjs ./dry-run
```
(`out/` and `dry-run/` are scratch folders: don't commit them.)
