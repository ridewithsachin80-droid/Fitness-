# Nutrient enrichment pilot — review table (Fixes-2k, revised in Fixes-2l, 19 Oct 2026)

**Status: candidates only. Nothing is ready to apply, and nothing has been applied to the live test database or production.**

Since Fixes-2l, every food below is a **candidate**: its identity (which food, preparation, brand or variety, recipe basis) has not been confirmed by Sachin or a coach. The server refuses candidate values. A food moves to "ready" only when its mapping records `identity: "confirmed"` and who confirmed it. Matching the food's old AI numbers is never treated as confirmation (19 Oct review).

Applying then needs, in order: the batch proposed, a reviewer's approval (who approved and the exact revision are recorded), and an admin typing "apply batch N". Apply refuses any other revision.

## What this covers

- The live test database has **25 foods that qualify** (AI-created, unchecked). All 25 are reviewed here.
- **12 foods: 240 candidate values**, each checked against the pinned source extracts (`server/data/nutrient-ref-extracts.json`).
- **2 held:** the evidence and the food disagree too much.
- **11 left unknown:** vague names or brands; no record or recipe can be checked against them.
- **Only missing or uncertain values would be filled.**
  - The AI's existing numbers are never overwritten. Where they disagree with the evidence by more than 30%, that is listed, for a coach to correct separately (backlog B16).
  - Every food here has the AI's numbers for fibre, sugar, vitamin C, calcium, iron, potassium and sodium, and a stored 0 for every other nutrient. Those zeros are "uncertain" (Fixes-2k) and are what the pilot would fill.
- **Sources** (exact releases, file checksums and nutrient definitions are in the pinned extracts file):
  - **USDA SR28:** Standard Reference, Release 28, from npm `fda-nutrient-database` 1.0.2 (the README cites "Version Current: September 2015"). This is SR28, not SR Legacy's final April 2018 release, and individual records may differ between the two. A blank means "not analysed" and is not used; a 0 is a value.
  - **IFCT 2017** (ICMR–NIN), from the open transcription (npm `ifct2017` 2.1.2). The official PDF is online: https://www.nin.res.in/ebooks/IFCT2017_16122024.pdf. This copy writes 0 for both "none" and "not analysed", so no IFCT 0 is used. IFCT rows whose stated energy does not match their own macros are not used.
  - **Recipe:** ingredient records × IFCT 2017 retention factors for the cooking method, divided by the cooked weight. Each ingredient carries its pinned record id and retention method, and the server recomputes the working from the pinned extracts.
- **AI estimates proposed: none.** Unsupported values stay unknown.
- **How each value would look:** a reference value shows plainly; a recipe value shows "~ value · Recipe estimate". On the day's totals a target counts as met only on confirmed values; with estimates it shows "Estimate".

## Confirmations needed (19 Oct review)

1. **Cooked white rice (854):** Confirm the rice type and whether it is fortified (India distributes fortified rice; this member's rice may or may not be).
2. **Carrots (858):** Confirm the raw/cooked state and the food type before assigning the reference profile.
3. **Red Bell Pepper (859):** Confirm the raw/cooked state and the food type before assigning the reference profile.
4. **Tomatoes (860):** Confirm the raw/cooked state and the food type before assigning the reference profile.
5. **Lettuce (861):** Confirm the raw/cooked state and the food type before assigning the reference profile.
6. **Black Sesame Seeds (925):** Choose the reference from the actual variety, processing and hull state, not by preference or closeness to old AI values.
7. **Greens (954):** Coach confirms which vegetable 'Greens' is and its preparation. Matching the old numbers to spinach is not confirmation that it is spinach.
8. **Yogurt (794):** Confirm Greek-style non-fat yogurt vs ordinary dahi, with brand and fat level. Rename or split the food before applying any profile.
9. **Chia seeds in water (792):** Resolve dry-seed grams vs soaked-mixture grams. A dry-seed profile must not attach to a food members may weigh after soaking.
10. **Dark Chocolate (820):** Confirm the product or cacao percentage. Choosing 45-59% cacao because its energy is closest to the old estimate is not enough.
11. **Mudde (835):** Confirm the member's recipe and cooked yield, or create a clearly named standard-recipe entry. 100 g flour to 330 g cooked is an assumption.
12. **Sweetened Date Paste (822):** Confirm the recipe or product. The 90:10 dates-to-sugar ratio is assumed; keep it illustrative or as a separate standard recipe until confirmed.
13. **Cucumber and Tomato Salad (793):** Confirm the recipe, ingredient quantities and prepared yield.
14. **Paneer Curry (868):** Confirm the recipe, ingredient quantities and prepared yield.
15. **USDA values against FoodData Central (SR Legacy):** rice 20445 is checked (all 28 values agree). The other 15 USDA records still need the same comparison; the build workspace was rate-limited by FoodData Central after two lookups. Each record's link is https://fdc.nal.usda.gov/ → search the NDB number.
16. **IFCT values against the official PDF:** check the pinned IFCT records (ragi A010; paneer curry ingredients L003, G017, D076; spinach C033 used in tests) against the official table. Not yet done by the builder: the workspace cannot download the PDF. The reviewer checked some ragi entries and found that several match.
17. **Ragi vitamin D2:** IFCT 2017 prints a D2 figure for ragi (41.5 mcg per 100 g; the reviewer found it in the official table). It stays unapplied pending clarification and is never replaced with a 0. Only D3 is taken from IFCT.

## Summary

| Food (live id) | Decision | Matched to | Basis | Values | Discrepancies / notes |
|---|---|---|---|---|---|
| Cooked white rice (854) | candidate · reference | USDA SR28 20445: Rice, white, long-grain, regular, unenriched, cooked without salt | cooked; the name says cooked; 130 kcal matches cooked rice (raw is ~360) | 22 | food not marked raw/cooked; matched as cooked (the name says cooked; 130 kcal matches cooked rice (raw is ~360)); existing sugar: AI 0.1 vs reference 0.05 (+100%) |
| Carrots (858) | candidate · reference | USDA SR28 11124: Carrots, raw | raw; 41 kcal and the AI's other figures match raw carrots | 21 | food not marked raw/cooked; matched as raw (41 kcal and the AI's other figures match raw carrots) |
| Red Bell Pepper (859) | candidate · reference | USDA SR28 11821: Peppers, sweet, red, raw | raw; 31 kcal and vitamin C 127.7 match raw red sweet pepper | 21 | food not marked raw/cooked; matched as raw (31 kcal and vitamin C 127.7 match raw red sweet pepper); existing calcium: AI 10 vs reference 7 (+43%) |
| Tomatoes (860) | candidate · reference | USDA SR28 11529: Tomatoes, red, ripe, raw, year round average | raw; 18 kcal matches raw tomatoes | 21 | food not marked raw/cooked; matched as raw (18 kcal matches raw tomatoes) |
| Lettuce (861) | candidate · reference | USDA SR28 11253: Lettuce, green leaf, raw | raw; 15 kcal and 1.4 g protein match raw green leaf lettuce | 21 | food not marked raw/cooked; matched as raw (15 kcal and 1.4 g protein match raw green leaf lettuce); existing fiber: AI 2.1 vs reference 1.3 (+62%); existing sugar: AI 1.1 vs reference 0.78 (+41%); existing vit_c: AI 4 vs reference 9.2 (-57%); existing sodium: AI 2 vs reference 28 (-93%) |
| Black Sesame Seeds (925) | candidate · reference | USDA SR28 12023: Seeds, sesame seeds, whole, dried | raw; the food's 573 kcal, 18 g protein and 49.7 g fat match USDA whole dried sesame exactly | 22 | food not marked raw/cooked; matched as raw (the food's 573 kcal, 18 g protein and 49.7 g fat match USDA whole dried sesame exactly); existing sugar: AI 1.4 vs reference 0.3 (+367%) |
| Greens (954) | candidate · reference | USDA SR28 11457: Spinach, raw | raw; every existing figure (23 kcal, iron 2.7, calcium 99, potassium 558, vitamin C 28) is USDA raw spinach | 21 | food not marked raw/cooked; matched as raw (every existing figure (23 kcal, iron 2.7, calcium 99, potassium 558, vitamin C 28) is USDA raw spinach) |
| Yogurt (794) | candidate · reference | USDA SR28 01256: Yogurt, Greek, plain, nonfat | raw; 60 kcal with 10 g protein is non-fat Greek yogurt, not ordinary curd (about 3 g protein) | 23 | food not marked raw/cooked; matched as raw (60 kcal with 10 g protein is non-fat Greek yogurt, not ordinary curd (about 3 g protein)); existing iron: AI 0.1 vs reference 0.07 (+43%); existing sodium: AI 50 vs reference 36 (+39%) |
| Chia seeds in water (792) | candidate · reference | USDA SR28 12006: Seeds, chia seeds, dried | raw; 486 kcal is dry chia seeds; the name says 'in water' but the numbers are for the dry seeds | 15 | food not marked raw/cooked; matched as raw (486 kcal is dry chia seeds; the name says 'in water' but the numbers are for the dry seeds) |
| Dark Chocolate (820) | candidate · reference | USDA SR28 19902: Chocolate, dark, 45- 59% cacao solids | raw; 520 kcal is closest to 45-59% cacao dark chocolate (546); 70-85% is 598 | 18 | food not marked raw/cooked; matched as raw (520 kcal is closest to 45-59% cacao dark chocolate (546); 70-85% is 598); existing fiber: AI 10 vs reference 7 (+43%); existing sodium: AI 10 vs reference 24 (-58%) |
| Mudde (835) | candidate · recipe estimate | Recipe: Ragi mudde: 100 g ragi flour (IFCT A010) + 230 g water, cooked to 330 g | cooked; mudde is cooked ragi dough | 18 | food not marked raw/cooked; matched as cooked (mudde is cooked ragi dough); existing fiber: AI 1.6 vs recipe 3.22 (-50%); existing sugar: AI 0.5 vs recipe 0.0927 (+439%); existing calcium: AI 33 vs recipe 105 (-69%); existing iron: AI 2 vs recipe 1.26 (+59%); existing potassium: AI 250 vs recipe 94 (+166%); existing sodium: AI 5 vs recipe 1.37 (+266%) |
| Sweetened Date Paste (822) | candidate · recipe estimate | Recipe: 90 g dates (USDA 09087) + 10 g sugar (USDA 19335) | raw; a paste of dates with added sugar, not cooked | 17 | food not marked raw/cooked; matched as raw (a paste of dates with added sugar, not cooked); existing fiber: AI 5 vs recipe 7.2 (-31%); existing calcium: AI 60 vs recipe 35.2 (+70%); existing iron: AI 2 vs recipe 0.923 (+117%); existing sodium: AI 5 vs recipe 1.9 (+163%) |
| Cucumber and Tomato Salad (793) | **held** | Recipe: 48 g cucumber + 48 g tomato + 3.5 g oil + 0.5 g salt | raw; a raw salad | 0 | calories: food 70 vs recipe 46.8 per 100 g (+50%); food not marked raw/cooked; matched as raw (a raw salad); existing fiber: AI 2 vs recipe 0.816 (+145%); existing sugar: AI 3 vs recipe 2.06 (+45%); existing calcium: AI 20 vs recipe 12.6 (+59%); existing iron: AI 0.5 vs recipe 0.267 (+87%); existing sodium: AI 10 vs recipe 197 (-95%) |
| Paneer Curry (868) | **held** | Recipe: 40 g paneer + 20 g onion + 25 g tomato + 5 g oil + 15 g water, to 100 g | cooked; a home paneer curry | 0 | protein: food 15 g vs 8.1 g; food not marked raw/cooked; matched as cooked (a home paneer curry); existing sugar: AI 3 vs recipe 5.53 (-46%); existing iron: AI 1.5 vs recipe 0.479 (+213%); existing potassium: AI 250 vs recipe 84.3 (+197%); existing sodium: AI 300 vs recipe 10.2 (+2838%) |
| Protein powder (818) | **left unknown** | — | — | 0 | Branded protein powder: needs the product's own label (photo or text of the nutrition panel). No reference record can stand in for a brand. |
| Bournville chocolate (821) | **left unknown** | — | — | 0 | Branded (Cadbury Bournville): needs the pack's nutrition panel. Not guessed from a generic dark chocolate. |
| Spinach and Lentil Patty (823) | **left unknown** | — | — | 0 | 'Spinach and lentil patty': the recipe varies (which lentil, binder, how much oil); no record or recipe can be checked against it. |
| Green Chutney (795) | **left unknown** | — | — | 0 | 'Green chutney': recipes vary widely (coconut, peanut, coriander, mint); the food's numbers don't identify one. |
| Green Vegetable Curry (796) | **left unknown** | — | — | 0 | 'Green vegetable curry': does not say which vegetable. |
| Green Paste (824) | **left unknown** | — | — | 0 | 'Green paste': does not identify a food. |
| Bread/Pancake (825) | **left unknown** | — | — | 0 | 'Bread/Pancake': two different foods in one name. |
| Green Vegetable Dish (869) | **left unknown** | — | — | 0 | 'Green vegetable dish': does not say which vegetable. |
| Green Curry (870) | **left unknown** | — | — | 0 | 'Green curry': does not say which vegetable or recipe. |
| Salad (791) | **left unknown** | — | — | 0 | 'Salad': does not say what is in it. |
| Vegetable Salad (953) | **left unknown** | — | — | 0 | 'Vegetable salad': does not say which vegetables. |

## Candidate values, per food

### Cooked white rice (live id 854) — candidate reference value

- **Confirm first:** Confirm the rice type and whether it is fortified (India distributes fortified rice; this member's rice may or may not be).
- **Source:** USDA SR28 20445: Rice, white, long-grain, regular, unenriched, cooked without salt
- **Source check (2l):** USDA SR28 20445: checked (USDA FoodData Central API, SR Legacy (final release, April 2018), NDB 20445 = fdcId 169757, published 2019-04-01; builder (Claude), Fixes-2l, read through a web-fetch tool that summarises the API response, 2026-10-19). The server refuses a value whose pinned record is not checked.
- **Matching:** cooked, per 100 g. the name says cooked; 130 kcal matches cooked rice (raw is ~360).
- **Assumptions:** Plain white rice, cooked in water without salt. The unenriched USDA record is a candidate only: fortification status is NOT assumed (India runs a fortified-rice distribution programme), so it must be confirmed for this food before any value is proposed.
- **Food's own figures vs the evidence:** 130 kcal / 2.4 g protein vs 130 kcal / 2.69 g.
- **Existing AI values that disagree (kept, not overwritten):** sugar: AI 0.1 vs reference 0.05 (+100%)
- **Candidate values (22):** sat fat 0.077 g · cholesterol 0 mg · vit A 0 mcg · B1 0.02 mg · B2 0.013 mg · B3 0.4 mg · B5 0.39 mg · B6 0.093 mg · B12 0 mcg · vit C 0 mg · vit D 0 IU · vit E 0.04 mg · vit K 0 mcg · folate 3 mcg · choline 2.1 mg · magnesium 12 mg · phosphorus 43 mg · zinc 0.49 mg · copper 0.069 mg · manganese 0.472 mg · selenium 7.5 mcg · lycopene 0 mcg
- **Not changed:** fibre, sugar, calcium, iron, potassium, sodium (they already have the AI's values)

### Carrots (live id 858) — candidate reference value

- **Confirm first:** Confirm the raw/cooked state and the food type before assigning the reference profile.
- **Source:** USDA SR28 11124: Carrots, raw
- **Source check (2l):** USDA SR28 11124: NOT yet checked against the official source. The server refuses a value whose pinned record is not checked.
- **Matching:** raw, per 100 g. 41 kcal and the AI's other figures match raw carrots.
- **Assumptions:** Raw carrots, edible portion.
- **Food's own figures vs the evidence:** 41 kcal / 0.9 g protein vs 41 kcal / 0.93 g.
- **Candidate values (21):** sat fat 0.037 g · cholesterol 0 mg · vit A 835 mcg · B1 0.066 mg · B2 0.058 mg · B3 0.983 mg · B5 0.273 mg · B6 0.138 mg · B12 0 mcg · vit D 0 IU · vit E 0.66 mg · vit K 13.2 mcg · folate 19 mcg · choline 8.8 mg · magnesium 12 mg · phosphorus 35 mg · zinc 0.24 mg · copper 0.045 mg · manganese 0.143 mg · selenium 0.1 mcg · lycopene 1 mcg
- **Not changed:** fibre, sugar, vit C, calcium, iron, potassium, sodium (they already have the AI's values)

### Red Bell Pepper (live id 859) — candidate reference value

- **Confirm first:** Confirm the raw/cooked state and the food type before assigning the reference profile.
- **Source:** USDA SR28 11821: Peppers, sweet, red, raw
- **Source check (2l):** USDA SR28 11821: NOT yet checked against the official source. The server refuses a value whose pinned record is not checked.
- **Matching:** raw, per 100 g. 31 kcal and vitamin C 127.7 match raw red sweet pepper.
- **Assumptions:** Raw red bell pepper (capsicum).
- **Food's own figures vs the evidence:** 31 kcal / 1 g protein vs 31 kcal / 0.99 g.
- **Existing AI values that disagree (kept, not overwritten):** calcium: AI 10 vs reference 7 (+43%)
- **Candidate values (21):** sat fat 0.027 g · cholesterol 0 mg · vit A 157 mcg · B1 0.054 mg · B2 0.085 mg · B3 0.979 mg · B5 0.317 mg · B6 0.291 mg · B12 0 mcg · vit D 0 IU · vit E 1.58 mg · vit K 4.9 mcg · folate 46 mcg · choline 5.6 mg · magnesium 12 mg · phosphorus 26 mg · zinc 0.25 mg · copper 0.017 mg · manganese 0.112 mg · selenium 0.1 mcg · lycopene 0 mcg
- **Not changed:** fibre, sugar, vit C, calcium, iron, potassium, sodium (they already have the AI's values)

### Tomatoes (live id 860) — candidate reference value

- **Confirm first:** Confirm the raw/cooked state and the food type before assigning the reference profile.
- **Source:** USDA SR28 11529: Tomatoes, red, ripe, raw, year round average
- **Source check (2l):** USDA SR28 11529: NOT yet checked against the official source. The server refuses a value whose pinned record is not checked.
- **Matching:** raw, per 100 g. 18 kcal matches raw tomatoes.
- **Assumptions:** Raw red ripe tomatoes, year-round average.
- **Food's own figures vs the evidence:** 18 kcal / 0.9 g protein vs 18 kcal / 0.88 g.
- **Candidate values (21):** sat fat 0.028 g · cholesterol 0 mg · vit A 42 mcg · B1 0.037 mg · B2 0.019 mg · B3 0.594 mg · B5 0.089 mg · B6 0.08 mg · B12 0 mcg · vit D 0 IU · vit E 0.54 mg · vit K 7.9 mcg · folate 15 mcg · choline 6.7 mg · magnesium 11 mg · phosphorus 24 mg · zinc 0.17 mg · copper 0.059 mg · manganese 0.114 mg · selenium 0 mcg · lycopene 2570 mcg
- **Not changed:** fibre, sugar, vit C, calcium, iron, potassium, sodium (they already have the AI's values)

### Lettuce (live id 861) — candidate reference value

- **Confirm first:** Confirm the raw/cooked state and the food type before assigning the reference profile.
- **Source:** USDA SR28 11253: Lettuce, green leaf, raw
- **Source check (2l):** USDA SR28 11253: NOT yet checked against the official source. The server refuses a value whose pinned record is not checked.
- **Matching:** raw, per 100 g. 15 kcal and 1.4 g protein match raw green leaf lettuce.
- **Assumptions:** Green leaf lettuce, raw.
- **Food's own figures vs the evidence:** 15 kcal / 1.4 g protein vs 15 kcal / 1.36 g.
- **Existing AI values that disagree (kept, not overwritten):** fiber: AI 2.1 vs reference 1.3 (+62%); sugar: AI 1.1 vs reference 0.78 (+41%); vit_c: AI 4 vs reference 9.2 (-57%); sodium: AI 2 vs reference 28 (-93%)
- **Candidate values (21):** sat fat 0.02 g · cholesterol 0 mg · vit A 370 mcg · B1 0.07 mg · B2 0.08 mg · B3 0.375 mg · B5 0.134 mg · B6 0.09 mg · B12 0 mcg · vit D 0 IU · vit E 0.22 mg · vit K 126 mcg · folate 38 mcg · choline 13.6 mg · magnesium 13 mg · phosphorus 29 mg · zinc 0.18 mg · copper 0.029 mg · manganese 0.25 mg · selenium 0.6 mcg · lycopene 0 mcg
- **Not changed:** fibre, sugar, vit C, calcium, iron, potassium, sodium (they already have the AI's values)

### Black Sesame Seeds (live id 925) — candidate reference value

- **Confirm first:** Choose the reference from the actual variety, processing and hull state, not by preference or closeness to old AI values.
- **Source:** USDA SR28 12023: Seeds, sesame seeds, whole, dried
- **Source check (2l):** USDA SR28 12023: NOT yet checked against the official source. The server refuses a value whose pinned record is not checked.
- **Matching:** raw, per 100 g. the food's 573 kcal, 18 g protein and 49.7 g fat match USDA whole dried sesame exactly.
- **Assumptions:** USDA does not separate black from white sesame. IFCT 2017 has black gingelly seeds (H009): 508 kcal, calcium 1664 mg vs USDA 975 mg. USDA chosen to match the food's existing numbers; reviewer may prefer IFCT H009.
- **Food's own figures vs the evidence:** 573 kcal / 18 g protein vs 573 kcal / 17.7 g.
- **Existing AI values that disagree (kept, not overwritten):** sugar: AI 1.4 vs reference 0.3 (+367%)
- **Candidate values (22):** sat fat 6.96 g · cholesterol 0 mg · vit A 0 mcg · B1 0.791 mg · B2 0.247 mg · B3 4.51 mg · B5 0.05 mg · B6 0.79 mg · B12 0 mcg · vit C 0 mg · vit D 0 IU · vit E 0.25 mg · vit K 0 mcg · folate 97 mcg · choline 25.6 mg · magnesium 351 mg · phosphorus 629 mg · zinc 7.75 mg · copper 4.08 mg · manganese 2.46 mg · selenium 34.4 mcg · lycopene 0 mcg
- **Not changed:** fibre, sugar, calcium, iron, potassium, sodium (they already have the AI's values)

### Greens (live id 954) — candidate reference value

- **Confirm first:** Coach confirms which vegetable 'Greens' is and its preparation. Matching the old numbers to spinach is not confirmation that it is spinach.
- **Source:** USDA SR28 11457: Spinach, raw
- **Source check (2l):** USDA SR28 11457: NOT yet checked against the official source. The server refuses a value whose pinned record is not checked.
- **Matching:** raw, per 100 g. every existing figure (23 kcal, iron 2.7, calcium 99, potassium 558, vitamin C 28) is USDA raw spinach.
- **Assumptions:** The name is only 'Greens'; its numbers are exactly raw spinach. Needs the coach to confirm it is spinach.
- **Food's own figures vs the evidence:** 23 kcal / 2.9 g protein vs 23 kcal / 2.86 g.
- **Candidate values (21):** sat fat 0.063 g · cholesterol 0 mg · vit A 469 mcg · B1 0.078 mg · B2 0.189 mg · B3 0.724 mg · B5 0.065 mg · B6 0.195 mg · B12 0 mcg · vit D 0 IU · vit E 2.03 mg · vit K 483 mcg · folate 194 mcg · choline 19.3 mg · magnesium 79 mg · phosphorus 49 mg · zinc 0.53 mg · copper 0.13 mg · manganese 0.897 mg · selenium 1 mcg · lycopene 0 mcg
- **Not changed:** fibre, sugar, vit C, calcium, iron, potassium, sodium (they already have the AI's values)

### Yogurt (live id 794) — candidate reference value

- **Confirm first:** Confirm Greek-style non-fat yogurt vs ordinary dahi, with brand and fat level. Rename or split the food before applying any profile.
- **Source:** USDA SR28 01256: Yogurt, Greek, plain, nonfat
- **Source check (2l):** USDA SR28 01256: NOT yet checked against the official source. The server refuses a value whose pinned record is not checked.
- **Matching:** raw, per 100 g. 60 kcal with 10 g protein is non-fat Greek yogurt, not ordinary curd (about 3 g protein).
- **Assumptions:** Plain non-fat Greek yogurt. The food's fat (2 g) is higher than the record's (0.4 g).
- **Food's own figures vs the evidence:** 60 kcal / 10 g protein vs 59 kcal / 10.2 g.
- **Existing AI values that disagree (kept, not overwritten):** iron: AI 0.1 vs reference 0.07 (+43%); sodium: AI 50 vs reference 36 (+39%)
- **Candidate values (23):** fibre 0 g · sat fat 0.117 g · cholesterol 5 mg · vit A 1 mcg · B1 0.023 mg · B2 0.278 mg · B3 0.208 mg · B5 0.331 mg · B6 0.063 mg · B12 0.75 mcg · vit C 0 mg · vit D 0 IU · vit E 0.01 mg · vit K 0 mcg · folate 7 mcg · choline 15.1 mg · magnesium 11 mg · phosphorus 135 mg · zinc 0.52 mg · copper 0.017 mg · manganese 0.009 mg · selenium 9.7 mcg · lycopene 0 mcg
- **Not changed:** sugar, calcium, iron, potassium, sodium (they already have the AI's values)

### Chia seeds in water (live id 792) — candidate reference value

- **Confirm first:** Resolve dry-seed grams vs soaked-mixture grams. A dry-seed profile must not attach to a food members may weigh after soaking.
- **Source:** USDA SR28 12006: Seeds, chia seeds, dried
- **Source check (2l):** USDA SR28 12006: NOT yet checked against the official source. The server refuses a value whose pinned record is not checked.
- **Matching:** raw, per 100 g. 486 kcal is dry chia seeds; the name says 'in water' but the numbers are for the dry seeds.
- **Assumptions:** Values per 100 g of dry seeds, as the food's existing numbers are. Soaked weight is not what is logged.
- **Food's own figures vs the evidence:** 486 kcal / 17 g protein vs 486 kcal / 16.5 g.
- **Not analysed in the source, so they stay unknown:** sugar, B5, B6, choline, vit A, lycopene, vit D, vit K
- **Candidate values (15):** sat fat 3.33 g · cholesterol 0 mg · B1 0.62 mg · B2 0.17 mg · B3 8.83 mg · B12 0 mcg · vit C 1.6 mg · vit E 0.5 mg · folate 49 mcg · magnesium 335 mg · phosphorus 860 mg · zinc 4.58 mg · copper 0.924 mg · manganese 2.72 mg · selenium 55.2 mcg
- **Not changed:** fibre, calcium, iron, potassium, sodium (they already have the AI's values)

### Dark Chocolate (live id 820) — candidate reference value

- **Confirm first:** Confirm the product or cacao percentage. Choosing 45-59% cacao because its energy is closest to the old estimate is not enough.
- **Source:** USDA SR28 19902: Chocolate, dark, 45- 59% cacao solids
- **Source check (2l):** USDA SR28 19902: NOT yet checked against the official source. The server refuses a value whose pinned record is not checked.
- **Matching:** raw, per 100 g. 520 kcal is closest to 45-59% cacao dark chocolate (546); 70-85% is 598.
- **Assumptions:** Cacao percentage not given; 45-59% chosen from the calories.
- **Food's own figures vs the evidence:** 520 kcal / 5 g protein vs 546 kcal / 4.88 g.
- **Existing AI values that disagree (kept, not overwritten):** fiber: AI 10 vs reference 7 (+43%); sodium: AI 10 vs reference 24 (-58%)
- **Not analysed in the source, so they stay unknown:** vit C, folate, choline, vit D
- **Candidate values (18):** sat fat 18.5 g · cholesterol 8 mg · vit A 2 mcg · B1 0.025 mg · B2 0.05 mg · B3 0.725 mg · B5 0.297 mg · B6 0.042 mg · B12 0.23 mcg · vit E 0.54 mg · vit K 8.1 mcg · magnesium 146 mg · phosphorus 206 mg · zinc 2.01 mg · copper 1.03 mg · manganese 1.42 mg · selenium 3 mcg · lycopene 0 mcg
- **Not changed:** fibre, sugar, calcium, iron, potassium, sodium (they already have the AI's values)

### Mudde (live id 835) — candidate recipe estimate

- **Confirm first:** Confirm the member's recipe and cooked yield, or create a clearly named standard-recipe entry. 100 g flour to 330 g cooked is an assumption.
- **Source:** Recipe: Ragi mudde: 100 g ragi flour (IFCT A010) + 230 g water, cooked to 330 g
- **Source check (2l):** IFCT 2017 A010: NOT yet checked against the official source; retention-factor table: NOT yet checked. The server refuses a value whose pinned record is not checked.
- **Matching:** cooked, per 100 g. mudde is cooked ragi dough.
- **Assumptions:** Usual home recipe: 1 part ragi flour to about 2.3 parts water by weight, stirred and cooked to about 330 g. IFCT boiling retention factors. Gives 97 kcal per 100 g, the food's own figure.
- **Food's own figures vs the evidence:** 97 kcal / 3.3 g protein vs 97.3 kcal / 2.2 g.
- **Existing AI values that disagree (kept, not overwritten):** fiber: AI 1.6 vs recipe 3.22 (-50%); sugar: AI 0.5 vs recipe 0.0927 (+439%); calcium: AI 33 vs recipe 105 (-69%); iron: AI 2 vs recipe 1.26 (+59%); potassium: AI 250 vs recipe 94 (+166%); sodium: AI 5 vs recipe 1.37 (+266%)
- **Candidate values (18):** sat fat ~0.082 g · ω-3 ALA ~16.6 mg · ω-6 ~93.2 mg · B1 ~0.076 mg · B2 ~0.039 mg · B3 ~0.345 mg · B5 ~0.07 mg · B6 ~0.011 mg · vit E ~0.044 mg · vit K ~0.864 mcg · folate ~6.83 mcg · biotin ~0.253 mcg · magnesium ~39.8 mg · phosphorus ~60.5 mg · zinc ~0.69 mg · copper ~0.183 mg · manganese ~0.87 mg · selenium ~4.17 mcg
- **Not changed:** fibre, sugar, calcium, iron, potassium, sodium (they already have the AI's values)

### Sweetened Date Paste (live id 822) — candidate recipe estimate

- **Confirm first:** Confirm the recipe or product. The 90:10 dates-to-sugar ratio is assumed; keep it illustrative or as a separate standard recipe until confirmed.
- **Source:** Recipe: 90 g dates (USDA 09087) + 10 g sugar (USDA 19335)
- **Source check (2l):** USDA SR28 09087: NOT yet checked against the official source; USDA SR28 19335: NOT yet checked against the official source. The server refuses a value whose pinned record is not checked.
- **Matching:** raw, per 100 g. a paste of dates with added sugar, not cooked.
- **Assumptions:** 'Sweetened' read as about 10% added sugar; gives 293 kcal vs the food's 300.
- **Food's own figures vs the evidence:** 300 kcal / 2 g protein vs 293 kcal / 2.2 g.
- **Existing AI values that disagree (kept, not overwritten):** fiber: AI 5 vs recipe 7.2 (-31%); calcium: AI 60 vs recipe 35.2 (+70%); iron: AI 2 vs recipe 0.923 (+117%); sodium: AI 5 vs recipe 1.9 (+163%)
- **Candidate values (17):** sat fat ~0.029 g · B1 ~0.047 mg · B2 ~0.061 mg · B3 ~1.15 mg · B5 ~0.53 mg · B6 ~0.149 mg · vit C ~0.36 mg · vit E ~0.045 mg · vit K ~2.43 mcg · folate ~17.1 mcg · choline ~5.67 mg · magnesium ~38.7 mg · phosphorus ~55.8 mg · zinc ~0.262 mg · copper ~0.186 mg · manganese ~0.236 mg · selenium ~2.76 mcg
- **Not changed:** fibre, sugar, calcium, iron, potassium, sodium (they already have the AI's values)

## Held

- **Cucumber and Tomato Salad (793).** Recipe: 48 g cucumber + 48 g tomato + 3.5 g oil + 0.5 g salt. calories: food 70 vs recipe 46.8 per 100 g (+50%). The recipe and the food describe different things, so nothing is proposed. A coach should check the food's own numbers first.
- **Paneer Curry (868).** Recipe: 40 g paneer + 20 g onion + 25 g tomato + 5 g oil + 15 g water, to 100 g. protein: food 15 g vs 8.1 g. The recipe and the food describe different things, so nothing is proposed. A coach should check the food's own numbers first.

## Expected screen labels, if confirmed, approved and applied

- **Food sheet / admin form:** each proposed value shows "Reference value" or "Recipe estimate".
- **Member's Nutrition sheet, Today link, coach Key Nutrients:**
  - values from these foods add up as confirmed (reference) or estimated (recipe);
  - the old AI values on the same foods stay estimates;
  - a target is "met" only on confirmed values.
- **Local dry run** (`pilot-dry-run.log`, re-run in 2l): on a local copy of these 25 records only, with every candidate marked "local dry run (not a real confirmation)". The real batch check accepted only the 22 rice values (the one record checked against the official source) and refused the other 218 as resting on unchecked records, for no other reason. Apply was refused before approval; after approval the 22 applied, a logged copy kept its statuses, and rollback restored all 25 records exactly. Screens were not part of this run (covered by ui-tests and the delivery screenshots).
