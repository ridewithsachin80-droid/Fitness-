// 2k pilot generator: live inventory records + a reviewed mapping → checked proposals,
// discrepancy flags and the review table. Nothing is written to any database.
//   node pilot.mjs <inventory.jsonl> <mapping.json> <outdir>
// Paths resolve from this script's own location (Fixes-2l, review item 7):
// the repo root is two levels above tools/, so the instructions work on any
// machine. Only PILOT_DATA (the downloaded reference packages) stays an env.
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url'; import { createRequire } from 'module';
import { ifct, sr, byCode, retention, RF_COL, PILOT_DATA as S } from './ref.mjs';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(path.join(REPO, 'server', 'package.json'));
const E = require(path.join(REPO, 'server', 'services', 'nutrientEnrichment.js'));
const { MICRO_KEYS } = require(path.join(REPO, 'server', 'services', 'nutrientStatus.js'));
const [invFile, mapFile, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });

const inv = fs.readFileSync(invFile, 'utf8').split('\n').filter(l => l.trim().startsWith('{')).map(l => JSON.parse(l));
const byId = new Map(inv.map(f => [f.id, f]));
const mapping = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
const DS = r => (r.dataset === 'IFCT 2017' ? 'IFCT 2017' : 'USDA SR28');
// The open IFCT copy has some broken rows (oils at 0 kcal, one chicken row at 2x): a record is
// used only when its stated energy agrees with its own protein, carbs, fat and fibre.
const consistent = (r) => { const at = 4 * (r.protein || 0) + 4 * (r.carbs || 0) + 9 * (r.fat || 0) + 2 * (r.values.fiber || 0); return !at || Math.abs(r.kcal - at) <= Math.max(15, at * 0.15); };
const UNITS = E.APP_UNITS;

const rows = [], proposals = [], candidates = [], csv = [['food_id', 'food', 'nutrient', 'existing', 'proposed', 'unit', 'status', 'source', 'record', 'basis', 'screen label', 'note']];
for (const m of mapping) {
  const f = byId.get(m.food_id);
  if (!f) { rows.push({ m, error: 'not in the live inventory' }); continue; }
  if (m.kind === 'none') { rows.push({ m, f, none: true, out: [] }); csv.push([f.id, f.name, '(all)', '', '', '', 'left unknown', '', '', '', 'Not known', m.reason]); continue; }
  const food = { id: f.id, name: f.name, source: 'ai', verified: false, preparation: f.prep || null,
    per_100g: { ...Object.fromEntries(MICRO_KEYS.map(k => [k, null])), ...Object.fromEntries((f.uncertain_zero || []).map(k => [k, 0])), ...f.values, _status: f.statuses || {} } };
  let ref = null, recipe = null, values = {}, macros = null, flags = [], zerosRefused = [], blanks = [];
  if (m.kind === 'reference') {
    ref = byCode(m.code);
    if (!ref) { rows.push({ m, f, error: `record ${m.code} not found` }); continue; }
    if (ref.dataset === 'IFCT 2017' && !consistent(ref)) { rows.push({ m, f, error: `IFCT ${ref.code} fails the energy check (stated ${ref.kcal} kcal vs its own macros); not used` }); continue; }
    values = { ...ref.values };
    if (DS(ref) === 'USDA SR28') for (const k of ref.zeros) values[k] = 0; else zerosRefused = ref.zeros.filter(k => MICRO_KEYS.includes(k));
    blanks = ref.blanks || [];
    macros = { kcal: ref.kcal, p: ref.protein, c: ref.carbs, f: ref.fat };
  } else if (m.kind === 'recipe') {
    const ings = m.ingredients.map(i => ({ ...i, rec: i.code ? byCode(i.code) : null }));
    const missingRec = ings.filter(i => i.code && !i.rec);
    const broken = ings.filter(i => i.rec && i.rec.dataset === 'IFCT 2017' && !consistent(i.rec));
    if (broken.length) { rows.push({ m, f, error: `IFCT ingredient fails the energy check: ${broken.map(i => i.code).join(', ')}` }); continue; }
    if (missingRec.length) { rows.push({ m, f, error: `ingredient record not found: ${missingRec.map(i => i.code).join(', ')}` }); continue; }
    const cooked = m.cooked_weight_g;
    macros = { kcal: 0, p: 0, c: 0, f: 0 };
    for (const i of ings) if (i.rec) { macros.kcal += i.grams / 100 * i.rec.kcal; macros.p += i.grams / 100 * (i.rec.protein || 0); macros.c += i.grams / 100 * (i.rec.carbs || 0); macros.f += i.grams / 100 * (i.rec.fat || 0); }
    for (const k of Object.keys(macros)) macros[k] = +(macros[k] / cooked * 100).toFixed(1);
    recipe = { unit: null, cooked_weight_g: cooked, ingredients: ings.map(i => ({ name: i.name || i.rec?.name, code: i.code || null, dataset: i.rec ? DS(i.rec) : null, grams: i.grams, method: i.method || 'none' })) };
    for (const k of MICRO_KEYS) {
      if (!RF_COL[k] && !['vit_b12', 'choline', 'vit_a'].includes(k)) continue;
      let total = 0, ok = true; const parts = [];
      for (const i of ings) {
        let v;
        if (!i.rec) { v = (i.assume_zero || []).includes(k) || i.assume_zero === 'all' ? 0 : undefined; }
        else if (i.rec.values[k] !== undefined) v = i.rec.values[k];
        else if ((i.assume_zero || []).includes(k) || i.assume_zero === 'all') v = 0;
        else if (DS(i.rec) === 'USDA SR28' && i.rec.zeros.includes(k)) v = 0;
        else v = undefined;
        if (v === undefined) { ok = false; break; }
        const r = retention(k, i.method); if (r === null) { ok = false; break; }
        // 2l: each contributing ingredient carries its pinned record id and the
        // retention method, so the server can recompute from the pinned extracts.
        total += i.grams / 100 * v * r;
        parts.push({ name: i.name || i.rec?.name, grams: i.grams, value_per_100g: v, retention: r,
                     code: i.rec ? `${DS(i.rec)}|${i.code}` : null, retention_method: i.method || 'none' });
      }
      if (ok) { const per = total / cooked * 100; if (per > 0) { values[k] = +per.toPrecision(4); recipe[`parts_${k}`] = parts; } }
    }
  }
  // Discrepancy checks against the food's own macros.
  const pct = (a, b) => (b ? Math.round((a - b) / b * 100) : null);
  const dk = pct(Number(f.kcal), macros.kcal);
  if (dk !== null && Math.abs(dk) > 25) flags.push(`calories: food ${f.kcal} vs ${m.kind === 'recipe' ? 'recipe' : 'reference'} ${macros.kcal} per 100 g (${dk > 0 ? '+' : ''}${dk}%)`);
  const dp = pct(Number(f.p), macros.p);
  if (dp !== null && Math.abs(dp) > 35 && Math.abs(Number(f.p) - macros.p) > 2) flags.push(`protein: food ${f.p} g vs ${macros.p} g`);
  const held = (dk !== null && Math.abs(dk) > 40) || (dp !== null && Math.abs(dp) > 50 && Math.abs(Number(f.p) - macros.p) > 3);
  // The food's existing AI values against the evidence: never overwritten here (fill only missing), but shown.
  const vs = [];
  for (const [k, v] of Object.entries(f.values || {})) {
    if (values[k] === undefined || !(Number(v) > 0)) continue;
    const d = (Number(v) - values[k]) / values[k] * 100;
    if (Math.abs(d) > 30) vs.push(`${k}: AI ${v} vs ${m.kind === 'recipe' ? 'recipe' : 'reference'} ${+values[k].toPrecision(3)} (${d > 0 ? '+' : ''}${Math.round(d)}%)`);
  }
  if (!food.preparation) flags.push(`food not marked raw/cooked; matched as ${m.preparation} (${m.basis_reason || 'from its name and calories'})`);
  const out = [];
  for (const k of MICRO_KEYS) {
    if (values[k] === undefined) continue;
    const fl = E.fillability(food, k);
    if (!fl.ok) { out.push({ k, skip: fl.reason }); continue; }
    if (held) { out.push({ k, skip: `held: ${dk !== null && Math.abs(dk) > 40 ? 'calories' : 'protein'} disagree too much to trust the recipe` }); continue; }
    // 2l: identity comes from the mapping. Every mapping is a CANDIDATE until
    // Sachin or a coach confirms the food, preparation, brand/variety and
    // recipe basis — closeness to the old AI numbers is not confirmation. The
    // server refuses candidate proposals; the dry run below validates only
    // their numbers so the review table can show what WOULD be filled.
    const identity = m.identity === 'confirmed' && m.identity_confirmed_by ? 'confirmed' : 'candidate';
    const pr = { food_id: f.id, nutrient: k, value: values[k], unit: UNITS[k], basis: 'per_100g', preparation: m.preparation, status: m.kind === 'reference' ? 'reference' : 'recipe',
      identity, identity_confirmed_by: identity === 'confirmed' ? m.identity_confirmed_by : null,
      source: m.kind === 'reference' ? { dataset: DS(ref), record_id: ref.code, name: ref.name, url: DS(ref) === 'USDA SR28' ? `https://fdc.nal.usda.gov/ (SR Legacy, NDB ${ref.code})` : null } : null,
      assumptions: m.assumptions || null };
    if (m.kind === 'recipe') pr.recipe = { unit: UNITS[k], cooked_weight_g: m.cooked_weight_g, ingredients: recipe[`parts_${k}`] };
    try {
      const chk = E.checkProposal({ ...food, preparation: food.preparation }, pr, identity === 'candidate' ? { dryRunCandidates: true } : {});
      (identity === 'confirmed' ? proposals : candidates).push(pr);
      out.push({ k, value: chk.value, replaces: fl.replaces, candidate: identity === 'candidate' });
    } catch (e) { out.push({ k, skip: `refused: ${e.message}` }); }
  }
  rows.push({ m, f, ref, recipe, macros, flags, zerosRefused, blanks, out, held, vs });
  for (const o of out) csv.push([f.id, f.name, o.k, (f.values?.[o.k] ?? ((f.uncertain_zero || []).includes(o.k) ? '0 (uncertain)' : 'empty')), o.value ?? '', UNITS[o.k], o.skip ? 'not proposed' : (m.kind === 'reference' ? 'Reference value' : 'Recipe estimate'),
    m.kind === 'reference' ? DS(ref) : 'Recipe', m.kind === 'reference' ? `${ref.code} ${ref.name}` : (m.recipe_label || ''), m.preparation, o.skip ? '' : (m.kind === 'reference' ? `${o.value} ${UNITS[o.k]}` : `~${o.value} ${UNITS[o.k]} · Recipe estimate`), o.skip || ((o.candidate ? 'CANDIDATE (identity unconfirmed — not ready to apply); ' : '') + (o.replaces === 'uncertain 0' ? 'replaces an uncertain 0' : 'fills an empty value'))]);
}
// 2l: nothing is ready to apply until identities are confirmed. The file keeps
// its name, but the ready-to-apply `proposals` list holds confirmed identities
// only; everything else sits in `candidates` with what confirmation it needs.
fs.writeFileSync(path.join(outDir, 'pilot-proposals.json'), JSON.stringify({
  label: 'Fixes-2k pilot: 20 common foods',
  identity_state: proposals.length ? 'mixed' : 'all candidates — none ready to apply',
  proposals, candidates,
  candidate_rule: 'A candidate becomes a proposal only when its mapping carries identity: "confirmed" and identity_confirmed_by (Sachin or a coach), after the food, preparation, brand/variety and recipe basis are confirmed. The server refuses candidates.',
}, null, 1));
fs.writeFileSync(path.join(outDir, 'pilot-review.csv'), csv.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n') + '\n');
fs.writeFileSync(path.join(outDir, 'pilot-rows.json'), JSON.stringify(rows.map(r => ({ ...r, ref: r.ref ? { dataset: r.ref.dataset, code: r.ref.code, name: r.ref.name } : null })), null, 1));
console.log(`${rows.length} foods, ${proposals.length} ready proposals, ${candidates.length} candidate values, ${rows.filter(r => r.error).length} errors, ${rows.filter(r => r.held).length} held`);
