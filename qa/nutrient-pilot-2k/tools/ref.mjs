// Reference lookup for the 2k pilot: IFCT 2017 (open transcription, ifct2017 npm 2.1.2)
// and USDA SR28 ABBREV (fda-nutrient-database npm 1.0.2). Values returned per 100 g,
// in the app's units. IFCT zeros are reported as null (ambiguous in this copy).
import fs from 'fs'; import os from 'os'; import path from 'path';
// Where the downloaded reference packages live (ifctpkg/ and sr28/, see README).
// Default: the system temp folder, so no machine-specific path is baked in.
export const PILOT_DATA = process.env.PILOT_DATA || path.join(os.tmpdir(), 'pilot-data');
const S = PILOT_DATA;
function parseCSV(s) { const rows = []; let r = [], f = '', q = false; for (let i = 0; i < s.length; i++) { const c = s[i]; if (q) { if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; } else { if (c === '"') q = true; else if (c === ',') { r.push(f); f = ''; } else if (c === '\n') { r.push(f); rows.push(r); r = []; f = ''; } else if (c !== '\r') f += c; } } if (f || r.length) { r.push(f); rows.push(r); } return rows; }

// IFCT: values in g per 100 g edible portion; energy in kJ.
const ifctRows = parseCSV(fs.readFileSync(`${S}/ifctpkg/x/package/compositions/index.csv`, 'utf8')).filter(r => r.length > 10);
const H = ifctRows[0];
const IFCT_MAP = { // app key: [ifct column(s), factor g→app unit]
  fiber: [['fibtg'], 1], sugar: [['fsugar'], 1], saturated_fat: [['fasat'], 1], trans_fat: [['fatrn'], 1], cholesterol: [['cholc'], 1e3],
  calcium: [['ca'], 1e3], iron: [['fe'], 1e3], magnesium: [['mg'], 1e3], phosphorus: [['p'], 1e3], potassium: [['k'], 1e3], sodium: [['na'], 1e3],
  zinc: [['zn'], 1e3], copper: [['cu'], 1e3], manganese: [['mn'], 1e3], selenium: [['se'], 1e6],
  vit_c: [['vitc'], 1e3], vit_b1: [['thia'], 1e3], vit_b2: [['ribf'], 1e3], vit_b3: [['nia'], 1e3], vit_b5: [['pantac'], 1e3], vit_b6: [['vitb6c'], 1e3],
  folate: [['folsum'], 1e6], biotin: [['biot'], 1e6], vit_e: [['vite'], 1e3], vit_k: [['vitk1', 'vitk2'], 1e6], lycopene: [['lycpn'], 1e6],
  omega3_ala: [['f18d3n3'], 1e3], omega3_epa: [['f20d5n3'], 1e3], omega3_dha: [['f22d6n3'], 1e3], omega6: [['f18d2cn6'], 1e3],
};
export const ifct = ifctRows.slice(1).map(r => {
  const g = k => { const i = H.indexOf(k); return i < 0 || r[i] === '' ? null : Number(r[i]); };
  const out = { dataset: 'IFCT 2017', code: r[0], name: r[1], group: r[H.indexOf('grup')], kcal: Math.round(g('enerc') / 4.184), protein: g('protcnt'), fat: g('fatce'), carbs: g('choavldf'), values: {}, zeros: [] };
  for (const [k, [cols, f]] of Object.entries(IFCT_MAP)) {
    const vals = cols.map(g).filter(v => v !== null);
    if (!vals.length) continue;
    const sum = vals.reduce((a, b) => a + b, 0);
    if (sum > 0) out.values[k] = +(sum * f).toPrecision(4); else out.zeros.push(k);
  }
  // Vitamin D: only D3 (cholecalciferol). IFCT 2017 reports D2 (ergocalciferol) in many plant
  // foods (ragi 41 mcg, atta 13 mcg per 100 g) where other tables give 0; not used pending review.
  const d3 = g('chocal') || 0, d2 = g('ergcal') || 0;
  if (d3 > 0) out.values.vit_d = +(d3 * 1e6 * 40).toPrecision(4); else if (!d2) out.zeros.push('vit_d');
  if (d2 > 0) out.d2_not_used = +(d2 * 1e6).toPrecision(3);
  return out;
});

// SR28 ABBREV: caret-delimited, ~text~, blank = not analysed.
const SR_FIELDS = ['ndb', 'desc', 'water', 'kcal', 'protein', 'fat', 'ash', 'carbs', 'fiber', 'sugar', 'calcium', 'iron', 'magnesium', 'phosphorus', 'potassium', 'sodium', 'zinc', 'copper', 'manganese', 'selenium', 'vit_c', 'vit_b1', 'vit_b2', 'vit_b3', 'vit_b5', 'vit_b6', 'folate', 'folic_acid', 'food_folate', 'folate_dfe', 'choline', 'vit_b12', 'vit_a_iu', 'vit_a', 'retinol', 'alpha_carot', 'beta_carot', 'beta_crypt', 'lycopene', 'lut_zea', 'vit_e', 'vit_d_mcg', 'vit_d', 'vit_k', 'saturated_fat', 'mufa', 'pufa', 'cholesterol'];
const APP_SR = ['fiber', 'sugar', 'calcium', 'iron', 'magnesium', 'phosphorus', 'potassium', 'sodium', 'zinc', 'copper', 'manganese', 'selenium', 'vit_c', 'vit_b1', 'vit_b2', 'vit_b3', 'vit_b5', 'vit_b6', 'folate', 'choline', 'vit_b12', 'vit_a', 'lycopene', 'vit_e', 'vit_d', 'vit_k', 'saturated_fat', 'cholesterol'];
const longDesc = new Map(fs.readFileSync(`${S}/sr28/x/package/data/FOOD_DES.txt`, 'latin1').split('\n').filter(Boolean).map(l => { const f = l.split('^').map(x => x.replace(/^~|~$/g, '')); return [f[0], f[2]]; }));
export const sr = fs.readFileSync(`${S}/sr28/x/package/data/ABBREV.txt`, 'latin1').split('\n').filter(Boolean).map(l => {
  const f = l.split('^').map(x => x.replace(/^~|~$/g, ''));
  const o = Object.fromEntries(SR_FIELDS.map((k, i) => [k, f[i] === '' || f[i] === undefined ? null : (i < 2 ? f[i] : Number(f[i]))]));
  const out = { dataset: 'USDA SR28', code: o.ndb, name: longDesc.get(o.ndb) || o.desc, kcal: o.kcal, protein: o.protein, fat: o.fat, carbs: o.carbs, values: {}, zeros: [], blanks: [] };
  for (const k of APP_SR) { if (o[k] === null) out.blanks.push(k); else if (o[k] > 0) out.values[k] = o[k]; else out.zeros.push(k); }
  return out;
});

export function find(q, { ds = 'both', limit = 8 } = {}) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = r => words.every(w => r.name.toLowerCase().includes(w));
  return [...(ds !== 'sr' ? ifct.filter(hit) : []), ...(ds !== 'ifct' ? sr.filter(hit) : [])].slice(0, limit);
}
export const byCode = (code) => ifct.find(r => r.code === code) || sr.find(r => r.code === code);

// IFCT 2017 retention factors per cooking method (fraction kept), keyed by app
// nutrient. One copy here (Fixes-2l) so pilot.mjs and pin-refs.mjs agree.
export const RF_COL = { fiber: 'fibtg', sugar: 'fsugar', saturated_fat: 'fasat', trans_fat: 'fatrn', cholesterol: 'cholc', calcium: 'ca', iron: 'fe', magnesium: 'mg', phosphorus: 'p', potassium: 'k', sodium: 'na', zinc: 'zn', copper: 'cu', manganese: 'mn', selenium: 'se',
  vit_c: 'vitc', vit_b1: 'thia', vit_b2: 'ribf', vit_b3: 'nia', vit_b5: 'pantac', vit_b6: 'vitb6c', folate: 'folsum', biotin: 'biot', vit_e: 'vite', vit_k: 'vitk1', lycopene: 'lycpn', vit_d: 'chocal',
  omega3_ala: 'f18d3n3', omega3_epa: 'f20d5n3', omega3_dha: 'f22d6n3', omega6: 'f18d2cn6' };
const rfRows = parseCSV(fs.readFileSync(`${S}/ifctpkg/x/package/retentionfactors/index.csv`, 'utf8'));
const RFH = rfRows[0];
export const RF_METHODS = RFH.slice(1);
export function retention(key, method) {
  if (!method || method === 'none') return 1;
  const row = rfRows.find(r => r[0] === RF_COL[key]); const i = RFH.indexOf(method);
  if (!row || i < 0) return null;
  return Number(row[i]);
}

if (process.argv[2]) for (const r of find(process.argv.slice(2).join(' '))) console.log(`${r.dataset} ${r.code} | ${r.name} | ${r.kcal} kcal P${r.protein} F${r.fat} C${r.carbs} | ${Object.entries(r.values).map(([k, v]) => `${k} ${v}`).join(', ')}`);
