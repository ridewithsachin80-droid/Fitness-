// Builds the human review table for the pilot from pilot-rows.json (2k; candidate wording since 2l).
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const [rowsFile, outFile] = process.argv.slice(2);
// 2l: the pinned extracts say which records have been checked against the official source.
const REFS = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../server/data/nutrient-ref-extracts.json'), 'utf8'));
const checkOf = (key) => { const c = REFS.records?.[key]?.official_check; return c && c.result === 'match' ? `checked (${c.against}; ${c.by}, ${c.date})` : 'NOT yet checked against the official source'; };
const sourceCheck = (r) => {
  if (r.m.kind === 'reference') return `${r.ref.dataset} ${r.ref.code}: ${checkOf(`${r.ref.dataset}|${r.ref.code}`)}`;
  const codes = [...new Set(Object.keys(r.recipe || {}).filter(k => k.startsWith('parts_')).flatMap(k => r.recipe[k].map(i => i.code)).filter(Boolean))];
  const usesRF = Object.keys(r.recipe || {}).some(k => k.startsWith('parts_') && r.recipe[k].some(i => i.retention < 1));
  return codes.map(c => `${c.replace('|', ' ')}: ${checkOf(c)}`).join('; ') + (usesRF ? `; retention-factor table: ${REFS.retention_factors_check?.result === 'match' ? 'checked' : 'NOT yet checked'}` : '');
};
const rows = JSON.parse(fs.readFileSync(rowsFile, 'utf8'));
const U = { fiber: 'g', sugar: 'g', saturated_fat: 'g', trans_fat: 'g', cholesterol: 'mg', omega3_ala: 'mg', omega3_epa: 'mg', omega3_dha: 'mg', omega6: 'mg', omega9_mufa: 'mg', vit_a: 'mcg', vit_b1: 'mg', vit_b2: 'mg', vit_b3: 'mg', vit_b5: 'mg', vit_b6: 'mg', vit_b12: 'mcg', vit_c: 'mg', vit_d: 'IU', vit_e: 'mg', vit_k: 'mcg', folate: 'mcg', biotin: 'mcg', choline: 'mg', calcium: 'mg', iron: 'mg', magnesium: 'mg', phosphorus: 'mg', potassium: 'mg', sodium: 'mg', zinc: 'mg', copper: 'mg', manganese: 'mg', selenium: 'mcg', lycopene: 'mcg' };
const L = { fiber: 'fibre', saturated_fat: 'sat fat', trans_fat: 'trans fat', omega3_ala: 'ω-3 ALA', omega3_epa: 'ω-3 EPA', omega3_dha: 'ω-3 DHA', omega6: 'ω-6', omega9_mufa: 'MUFA', vit_a: 'vit A', vit_b1: 'B1', vit_b2: 'B2', vit_b3: 'B3', vit_b5: 'B5', vit_b6: 'B6', vit_b12: 'B12', vit_c: 'vit C', vit_d: 'vit D', vit_e: 'vit E', vit_k: 'vit K' };
const n = k => L[k] || k;
const fmt = v => (v === 0 ? '0' : +Number(v).toPrecision(3));
const ok = rows.filter(r => !r.none && !r.error && !r.held), held = rows.filter(r => r.held), none = rows.filter(r => r.none), err = rows.filter(r => r.error);
const total = ok.reduce((a, r) => a + r.out.filter(o => !o.skip).length, 0);
const out = [];
out.push('# Nutrient enrichment pilot — review table (Fixes-2k, revised in Fixes-2l, 19 Oct 2026)', '');
out.push('**Status: candidates only. Nothing is ready to apply, and nothing has been applied to the live test database or production.**', '');
out.push('Since Fixes-2l, every food below is a **candidate**: its identity (which food, preparation, brand or variety, recipe basis) has not been confirmed by Sachin or a coach. The server refuses candidate values. A food moves to "ready" only when its mapping records `identity: "confirmed"` and who confirmed it. Matching the food\'s old AI numbers is never treated as confirmation (19 Oct review).', '');
out.push('Applying then needs, in order: the batch proposed, a reviewer\'s approval (who approved and the exact revision are recorded), and an admin typing "apply batch N". Apply refuses any other revision.', '');
out.push('## What this covers', '');
out.push(`- The live test database has **${rows.length} foods that qualify** (AI-created, unchecked). All ${rows.length} are reviewed here.`);
out.push(`- **${ok.length} foods: ${total} candidate values**, each checked against the pinned source extracts (\`server/data/nutrient-ref-extracts.json\`).`);
out.push(`- **${held.length} held:** the evidence and the food disagree too much.`);
out.push(`- **${none.length} left unknown:** vague names or brands; no record or recipe can be checked against them.`);
out.push('- **Only missing or uncertain values would be filled.**');
out.push('  - The AI\'s existing numbers are never overwritten. Where they disagree with the evidence by more than 30%, that is listed, for a coach to correct separately (backlog B16).');
out.push('  - Every food here has the AI\'s numbers for fibre, sugar, vitamin C, calcium, iron, potassium and sodium, and a stored 0 for every other nutrient. Those zeros are "uncertain" (Fixes-2k) and are what the pilot would fill.');
out.push('- **Sources** (exact releases, file checksums and nutrient definitions are in the pinned extracts file):');
out.push('  - **USDA SR28:** Standard Reference, Release 28, from npm `fda-nutrient-database` 1.0.2 (the README cites "Version Current: September 2015"). This is SR28, not SR Legacy\'s final April 2018 release, and individual records may differ between the two. A blank means "not analysed" and is not used; a 0 is a value.');
out.push('  - **IFCT 2017** (ICMR–NIN), from the open transcription (npm `ifct2017` 2.1.2). The official PDF is online: https://www.nin.res.in/ebooks/IFCT2017_16122024.pdf. This copy writes 0 for both "none" and "not analysed", so no IFCT 0 is used. IFCT rows whose stated energy does not match their own macros are not used.');
out.push('  - **Recipe:** ingredient records × IFCT 2017 retention factors for the cooking method, divided by the cooked weight. Each ingredient carries its pinned record id and retention method, and the server recomputes the working from the pinned extracts.');
out.push('- **AI estimates proposed: none.** Unsupported values stay unknown.');
out.push('- **How each value would look:** a reference value shows plainly; a recipe value shows "~ value · Recipe estimate". On the day\'s totals a target counts as met only on confirmed values; with estimates it shows "Estimate".', '');
out.push('## Confirmations needed (19 Oct review)', '');
let ci = 1;
for (const r of ok.concat(held)) if (r.m.confirmation_needed) out.push(`${ci++}. **${r.f.name} (${r.f.id}):** ${r.m.confirmation_needed}`);
out.push(`${ci++}. **USDA values against FoodData Central (SR Legacy):** rice 20445 is checked (all 28 values agree). The other 15 USDA records still need the same comparison; the build workspace was rate-limited by FoodData Central after two lookups. Each record's link is https://fdc.nal.usda.gov/ → search the NDB number.`);
out.push(`${ci++}. **IFCT values against the official PDF:** check the pinned IFCT records (ragi A010; paneer curry ingredients L003, G017, D076; spinach C033 used in tests) against the official table. Not yet done by the builder: the workspace cannot download the PDF. The reviewer checked some ragi entries and found that several match.`);
out.push(`${ci++}. **Ragi vitamin D2:** IFCT 2017 prints a D2 figure for ragi (41.5 mcg per 100 g; the reviewer found it in the official table). It stays unapplied pending clarification and is never replaced with a 0. Only D3 is taken from IFCT.`, '');
out.push('## Summary', '', '| Food (live id) | Decision | Matched to | Basis | Values | Discrepancies / notes |', '|---|---|---|---|---|---|');
for (const r of rows) {
  const id = r.f ? `${r.f.name} (${r.f.id})` : `(${r.m.food_id})`;
  if (r.error) { out.push(`| ${id} | not used | — | — | — | ${r.error} |`); continue; }
  if (r.none) { out.push(`| ${id} | **left unknown** | — | — | 0 | ${r.m.reason} |`); continue; }
  const src = r.m.kind === 'reference' ? `${r.ref.dataset} ${r.ref.code}: ${r.ref.name}` : `Recipe: ${r.m.recipe_label}`;
  const nProp = r.out.filter(o => !o.skip).length;
  const notes = [...r.flags, ...(r.vs || []).map(x => `existing ${x}`)].join('; ');
  out.push(`| ${id} | ${r.held ? '**held**' : (r.m.kind === 'reference' ? 'candidate · reference' : 'candidate · recipe estimate')} | ${src} | ${r.m.preparation}; ${r.m.basis_reason} | ${r.held ? 0 : nProp} | ${notes || '—'} |`);
}
out.push('', '## Candidate values, per food', '');
for (const r of ok) {
  const src = r.m.kind === 'reference' ? `${r.ref.dataset} ${r.ref.code}: ${r.ref.name}` : `Recipe: ${r.m.recipe_label}`;
  out.push(`### ${r.f.name} (live id ${r.f.id}) — candidate ${r.m.kind === 'reference' ? 'reference value' : 'recipe estimate'}`, '');
  if (r.m.confirmation_needed) out.push(`- **Confirm first:** ${r.m.confirmation_needed}`);
  out.push(`- **Source:** ${src}`);
  out.push(`- **Source check (2l):** ${sourceCheck(r)}. The server refuses a value whose pinned record is not checked.`);
  out.push(`- **Matching:** ${r.m.preparation}, per 100 g. ${r.m.basis_reason}.`);
  if (r.m.assumptions) out.push(`- **Assumptions:** ${r.m.assumptions}`);
  out.push(`- **Food's own figures vs the evidence:** ${r.f.kcal} kcal / ${r.f.p} g protein vs ${fmt(r.macros.kcal)} kcal / ${fmt(r.macros.p)} g.`);
  if ((r.vs || []).length) out.push(`- **Existing AI values that disagree (kept, not overwritten):** ${r.vs.join('; ')}`);
  if ((r.zerosRefused || []).length) out.push(`- **IFCT zeros not used:** ${r.zerosRefused.map(n).join(', ')}`);
  if ((r.blanks || []).length) out.push(`- **Not analysed in the source, so they stay unknown:** ${r.blanks.map(n).join(', ')}`);
  const prop = r.out.filter(o => !o.skip);
  out.push(`- **Candidate values (${prop.length}):** ` + prop.map(o => `${n(o.k)} ${r.m.kind === 'recipe' ? '~' : ''}${fmt(o.value)} ${U[o.k] || ''}${o.replaces === 'uncertain 0' ? '' : ' (was empty)'}`).join(' · '));
  const skipped = r.out.filter(o => o.skip);
  if (skipped.length) out.push(`- **Not changed:** ${skipped.map(o => n(o.k)).join(', ')} (they already have the AI's values)`);
  out.push('');
}
if (held.length) {
  out.push('## Held', '');
  for (const r of held) out.push(`- **${r.f.name} (${r.f.id}).** Recipe: ${r.m.recipe_label}. ${r.flags.filter(f => !/not marked/.test(f)).join('; ')}. The recipe and the food describe different things, so nothing is proposed. A coach should check the food's own numbers first.`);
  out.push('');
}
out.push('## Expected screen labels, if confirmed, approved and applied', '');
out.push('- **Food sheet / admin form:** each proposed value shows "Reference value" or "Recipe estimate".');
out.push('- **Member\'s Nutrition sheet, Today link, coach Key Nutrients:**');
out.push('  - values from these foods add up as confirmed (reference) or estimated (recipe);');
out.push('  - the old AI values on the same foods stay estimates;');
out.push('  - a target is "met" only on confirmed values.');
out.push('- **Local dry run** (`pilot-dry-run.log`, re-run in 2l): on a local copy of these 25 records only, with every candidate marked "local dry run (not a real confirmation)". The real batch check accepted only the 22 rice values (the one record checked against the official source) and refused the other 218 as resting on unchecked records, for no other reason. Apply was refused before approval; after approval the 22 applied, a logged copy kept its statuses, and rollback restored all 25 records exactly. Screens were not part of this run (covered by ui-tests and the delivery screenshots).');
fs.writeFileSync(outFile, out.join('\n') + '\n');
console.log(`wrote ${outFile}: ${rows.length} foods, ${total} values`);
