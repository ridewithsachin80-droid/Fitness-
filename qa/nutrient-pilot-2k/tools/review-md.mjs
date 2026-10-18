// Builds the human review table for the 2k pilot from pilot-rows.json.
import fs from 'fs';
const [rowsFile, outFile] = process.argv.slice(2);
const rows = JSON.parse(fs.readFileSync(rowsFile, 'utf8'));
const U = { fiber: 'g', sugar: 'g', saturated_fat: 'g', trans_fat: 'g', cholesterol: 'mg', omega3_ala: 'mg', omega3_epa: 'mg', omega3_dha: 'mg', omega6: 'mg', omega9_mufa: 'mg', vit_a: 'mcg', vit_b1: 'mg', vit_b2: 'mg', vit_b3: 'mg', vit_b5: 'mg', vit_b6: 'mg', vit_b12: 'mcg', vit_c: 'mg', vit_d: 'IU', vit_e: 'mg', vit_k: 'mcg', folate: 'mcg', biotin: 'mcg', choline: 'mg', calcium: 'mg', iron: 'mg', magnesium: 'mg', phosphorus: 'mg', potassium: 'mg', sodium: 'mg', zinc: 'mg', copper: 'mg', manganese: 'mg', selenium: 'mcg', lycopene: 'mcg' };
const L = { fiber: 'fibre', saturated_fat: 'sat fat', trans_fat: 'trans fat', omega3_ala: 'ω-3 ALA', omega3_epa: 'ω-3 EPA', omega3_dha: 'ω-3 DHA', omega6: 'ω-6', omega9_mufa: 'MUFA', vit_a: 'vit A', vit_b1: 'B1', vit_b2: 'B2', vit_b3: 'B3', vit_b5: 'B5', vit_b6: 'B6', vit_b12: 'B12', vit_c: 'vit C', vit_d: 'vit D', vit_e: 'vit E', vit_k: 'vit K' };
const n = k => L[k] || k;
const fmt = v => (v === 0 ? '0' : +Number(v).toPrecision(3));
const ok = rows.filter(r => !r.none && !r.error && !r.held), held = rows.filter(r => r.held), none = rows.filter(r => r.none), err = rows.filter(r => r.error);
const total = ok.reduce((a, r) => a + r.out.filter(o => !o.skip).length, 0);
const out = [];
out.push('# Fixes-2k nutrient enrichment pilot — review table (18 Oct 2026)', '');
out.push('**Status: proposed only. Nothing has been applied to the live test database or production.** Applying needs Sachin\'s approval of this table, then an admin typing "apply batch N".', '');
out.push('## What this covers', '');
out.push(`- The brief asked for 20 common foods. The live test database has **${rows.length} foods that qualify** (AI-created, unchecked). All ${rows.length} are reviewed here.`);
out.push(`- **${ok.length} foods: ${total} values proposed** from evidence.`);
out.push(`- **${held.length} held:** the evidence and the food disagree too much.`);
out.push(`- **${none.length} left unknown:** no record or recipe can be checked against them.`);
out.push('- **Only missing or uncertain values are filled.**');
out.push('  - The AI\'s existing numbers are never overwritten. Where they disagree with the evidence by more than 30%, that is listed, for a coach to correct.');
out.push('  - Every food here has the AI\'s numbers for fibre, sugar, vitamin C, calcium, iron, potassium and sodium, and a stored 0 for every other nutrient. Those zeros are "uncertain" (Fixes-2k) and are what the pilot fills.');
out.push('- **Sources:**');
out.push('  - **USDA SR28** = FoodData Central "SR Legacy", NDB numbers given. A blank there means "not analysed" and is not used; a 0 there is a value.');
out.push('  - **IFCT 2017** (ICMR–NIN), from the open transcription (npm `ifct2017` 2.1.2). This copy writes 0 for both "none" and "not analysed", so no IFCT 0 is used. A few rows are broken (all oils at 0 kcal), so an IFCT row is used only if its stated energy matches its own macros.');
out.push('  - **Recipe** = ingredient records × IFCT 2017 retention factors for the cooking method, divided by the cooked weight. The working is stored with every value and re-checked by the server.');
out.push('- **AI estimates proposed: none.** Unsupported values stay unknown.');
out.push('- **How each value will look:** a reference value shows plainly; a recipe value shows "~ value · Recipe estimate". On the day\'s totals a target counts as met only on confirmed values; with estimates it shows "Estimate".', '');
out.push('## Please check before approving', '');
out.push('1. **Spot-check IFCT values against the printed IFCT 2017 book.** IFCT is used here only for ragi (A010) and the paneer curry ingredients (held). I could not find an independent online copy to verify the open transcription against.');
out.push('2. **"Greens" (954):** its numbers are exactly raw spinach. Is it spinach?');
out.push('3. **Black sesame (925):** USDA whole sesame matches the food\'s own numbers. IFCT black gingelly (H009) is the exact variety but has much more calcium (1664 vs 975 mg). Which do you want?');
out.push('4. **Yogurt (794):** 10 g protein per 100 g is Greek-style non-fat. If members mean ordinary dahi, this food should be renamed or split first.');
out.push('5. **Chia seeds "in water" (792):** the numbers are for dry seeds. The name should say dry, or members will weigh the soaked seeds.');
out.push('6. **Vitamin D from IFCT is not used for plant foods.** IFCT 2017 lists vitamin D2 in many cereals and pulses (ragi 41 mcg, about 1,660 IU per 100 g; atta 13 mcg) where USDA gives 0. Used as it stands, one serving of ragi mudde would look like more than a day\'s vitamin D. Mudde\'s vitamin D therefore stays unknown. Only D3 (animal foods) would be taken from IFCT.', '');
out.push('## Summary', '', '| Food (live id) | Decision | Matched to | Basis | Values | Discrepancies / notes |', '|---|---|---|---|---|---|');
for (const r of rows) {
  const id = r.f ? `${r.f.name} (${r.f.id})` : `(${r.m.food_id})`;
  if (r.error) { out.push(`| ${id} | not used | — | — | — | ${r.error} |`); continue; }
  if (r.none) { out.push(`| ${id} | **left unknown** | — | — | 0 | ${r.m.reason} |`); continue; }
  const src = r.m.kind === 'reference' ? `${r.ref.dataset} ${r.ref.code}: ${r.ref.name}` : `Recipe: ${r.m.recipe_label}`;
  const nProp = r.out.filter(o => !o.skip).length;
  const notes = [...r.flags, ...(r.vs || []).map(x => `existing ${x}`)].join('; ');
  out.push(`| ${id} | ${r.held ? '**held**' : (r.m.kind === 'reference' ? 'reference values' : 'recipe estimate')} | ${src} | ${r.m.preparation}; ${r.m.basis_reason} | ${r.held ? 0 : nProp} | ${notes || '—'} |`);
}
out.push('', '## Proposed values, per food', '');
for (const r of ok) {
  const src = r.m.kind === 'reference' ? `${r.ref.dataset} ${r.ref.code}: ${r.ref.name}` : `Recipe: ${r.m.recipe_label}`;
  out.push(`### ${r.f.name} (live id ${r.f.id}) — ${r.m.kind === 'reference' ? 'Reference value' : 'Recipe estimate'}`, '');
  out.push(`- **Source:** ${src}`);
  out.push(`- **Matching:** ${r.m.preparation}, per 100 g. ${r.m.basis_reason}.`);
  if (r.m.assumptions) out.push(`- **Assumptions:** ${r.m.assumptions}`);
  out.push(`- **Food's own figures vs the evidence:** ${r.f.kcal} kcal / ${r.f.p} g protein vs ${fmt(r.macros.kcal)} kcal / ${fmt(r.macros.p)} g.`);
  if ((r.vs || []).length) out.push(`- **Existing AI values that disagree (kept, not overwritten):** ${r.vs.join('; ')}`);
  if ((r.zerosRefused || []).length) out.push(`- **IFCT zeros not used:** ${r.zerosRefused.map(n).join(', ')}`);
  if ((r.blanks || []).length) out.push(`- **Not analysed in the source, so they stay unknown:** ${r.blanks.map(n).join(', ')}`);
  const prop = r.out.filter(o => !o.skip);
  out.push(`- **Proposed (${prop.length}):** ` + prop.map(o => `${n(o.k)} ${r.m.kind === 'recipe' ? '~' : ''}${fmt(o.value)} ${U[o.k] || ''}${o.replaces === 'uncertain 0' ? '' : ' (was empty)'}`).join(' · '));
  const skipped = r.out.filter(o => o.skip);
  if (skipped.length) out.push(`- **Not changed:** ${skipped.map(o => n(o.k)).join(', ')} (they already have the AI's values)`);
  out.push('');
}
if (held.length) {
  out.push('## Held', '');
  for (const r of held) out.push(`- **${r.f.name} (${r.f.id}).** Recipe: ${r.m.recipe_label}. ${r.flags.filter(f => !/not marked/.test(f)).join('; ')}. The recipe and the food describe different things, so nothing is proposed. A coach should check the food's own numbers first.`);
  out.push('');
}
out.push('## Expected screen labels after approval', '');
out.push('- **Food sheet / admin form:** each proposed value shows "Reference value" or "Recipe estimate".');
out.push('- **Member\'s Nutrition sheet, Today link, coach Key Nutrients:**');
out.push('  - values from these foods add up as confirmed (reference) or estimated (recipe);');
out.push('  - the old AI values on the same foods stay estimates;');
out.push('  - a target is "met" only on confirmed values.');
out.push('- **Local dry run** on a copy of these 25 records, with a day of rice, Greens, mudde, yogurt and tomatoes: "3 of 31 targets met · 17 estimated · 11 not known". The member and coach rows are identical, and rollback restored all 25 records exactly (`pilot-dry-run.log`, screenshots).');
fs.writeFileSync(outFile, out.join('\n') + '\n');
console.log(`wrote ${outFile}: ${rows.length} foods, ${total} values`);
