// pin-refs.mjs (NEW, Fixes-2l) — writes the pinned source extracts the server
// verifies reference amounts against (server/data/nutrient-ref-extracts.json).
//
// Why: the 2k checker validated the dataset NAME and the presence of a record
// id, not the amount — a fabricated value riding a real dataset passed. The
// server now refuses any reference amount that is not in this file, and any
// recipe ingredient value or retention factor that disagrees with it. So this
// file is the reviewed boundary: only records someone has looked at get in.
//
//   PILOT_DATA=/tmp/pilot-data node pin-refs.mjs <mapping.json> [extra codes…]
//
// It collects every record code the mapping uses (reference records and recipe
// ingredients), plus any codes given on the command line (the test suites pin
// IFCT C033 and USDA 09040), extracts their per-100 g values in the app's
// units from the downloaded packages, and pins the IFCT retention factors for
// every method the table carries. IFCT zeros are NOT pinned (this open copy
// cannot tell "none" from "not analysed"); USDA SR28 zeros are pinned as real
// zeros (SR28 leaves "not analysed" blank).
//
// Paths resolve from this script's location, so the README instructions work
// on any machine (review item 7). Nothing here touches any database.
import fs from 'fs'; import path from 'path'; import crypto from 'crypto'; import { fileURLToPath } from 'url';
import { byCode, retention, RF_COL, RF_METHODS, PILOT_DATA } from './ref.mjs';
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const OUT = path.join(REPO, 'server', 'data', 'nutrient-ref-extracts.json');

const mapFile = process.argv[2] || path.join(HERE, '..', 'pilot-mapping.json');
const mapping = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
const codes = new Set(process.argv.slice(3));
for (const m of mapping) {
  if (m.kind === 'reference' && m.code) codes.add(m.code);
  if (m.kind === 'recipe') for (const i of m.ingredients || []) if (i.code) codes.add(i.code);
}

// Official checks already recorded in the pinned file survive a re-run, but
// only while the record's values are unchanged: a changed transcription has
// to be checked again.
let prev = {};
try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { prev = {}; }
const same = (a, b) => JSON.stringify(Object.entries(a || {}).sort()) === JSON.stringify(Object.entries(b || {}).sort());

const records = {};
const missing = [];
for (const code of [...codes].sort()) {
  const r = byCode(code);
  if (!r) { missing.push(code); continue; }
  const values = { ...r.values };
  if (r.dataset === 'USDA SR28') for (const k of r.zeros) values[k] = 0;   // an SR28 0 is a value
  const key = `${r.dataset}|${r.code}`;
  const was = prev.records?.[key];
  records[key] = {
    name: r.name,
    basis: 'per_100g, edible portion, app units (see server/services/nutrientEnrichment.js APP_UNITS)',
    values,
    // null = not yet compared with the official source; the server refuses to
    // use an unchecked record. Filled in by hand (or a check tool) with
    // { result: 'match', against, by, date, note } after the comparison.
    official_check: was && same(was.values, values) ? (was.official_check ?? null) : null,
    ...(was && same(was.values, values) && was.official_check_notes ? { official_check_notes: was.official_check_notes } : {}),
    ...(r.d2_not_used ? { d2_not_used_mcg: r.d2_not_used, d2_note: 'Ergocalciferol (D2) figure from IFCT 2017. The 19 Oct review found the unusual ragi D2 entry in the official printed table, so it is not treated as a transcription error. Kept unapplied pending clarification; never substituted with a zero.' } : {}),
  };
}
if (missing.length) { console.error(`records not found: ${missing.join(', ')}`); process.exit(1); }

const retention_factors = {};
for (const key of Object.keys(RF_COL)) for (const m of RF_METHODS) {
  const r = retention(key, m);
  if (r !== null && Number.isFinite(r)) retention_factors[`${key}|${m}`] = r;
}

const out = {
  written_by: 'qa/nutrient-pilot-2k/tools/pin-refs.mjs (Fixes-2l)',
  rule: 'A reference amount, a recipe ingredient value and a retention factor are accepted by the server only when they match this file. Add a record here only after checking it against the official source.',
  datasets: {
    'IFCT 2017': {
      release: 'Indian Food Composition Tables 2017, ICMR–National Institute of Nutrition (T. Longvah et al.)',
      official_source: 'https://www.nin.res.in/ebooks/IFCT2017_16122024.pdf (the official NIN PDF, available online)',
      transcription: 'npm ifct2017@2.1.2 (open transcription, AGPL-3.0; lookup only, never shipped in the app)',
      files_sha256: { 'compositions/index.csv': sha(`${PILOT_DATA}/ifctpkg/x/package/compositions/index.csv`), 'retentionfactors/index.csv': sha(`${PILOT_DATA}/ifctpkg/x/package/retentionfactors/index.csv`) },
      official_check: 'Per record (records[…].official_check). None done yet for IFCT records: the build workspace cannot download the official PDF (network allowlist), and the PDF text that can be read carries no table values (55,160 characters: front matter and chapter 1 only). The 19 Oct reviewer checked selected ragi entries and table headers against the PDF and found several pilot ingredient values match, but did not list which, so no record is marked. Values to check are listed in qa/nutrient-pilot-2k/README.md.',
      caveat: 'This open copy writes 0 for both "none" and "not analysed", so IFCT zeros are never pinned and never proposed. Check transcriptions against the official PDF; below-detection, not-analysed and recorded-zero distinctions in the printed table are preserved by not pinning ambiguous zeros.',
    },
    'USDA SR28': {
      release: 'USDA National Nutrient Database for Standard Reference, Release 28 ("Version Current: September 2015", as cited in the package README). Whether this copy includes USDA’s May 2016 minor revision is not stated by the package and has not been verified.',
      files_sha256: { 'ABBREV.txt': sha(`${PILOT_DATA}/sr28/x/package/data/ABBREV.txt`), 'FOOD_DES.txt': sha(`${PILOT_DATA}/sr28/x/package/data/FOOD_DES.txt`) },
      official_source: 'https://fdc.nal.usda.gov/ (published as "SR Legacy"; note: SR Legacy’s FINAL release is April 2018 and may differ from SR28 for some records — these extracts are SR28, named exactly)',
      transcription: 'npm fda-nutrient-database@1.0.2, files ABBREV.txt and FOOD_DES.txt (SR28 ASCII release; lookup only, never shipped in the app)',
      caveat: 'A blank in ABBREV means "not analysed" and is never pinned; a 0 is a measured value and is pinned as 0.',
      official_check: prev.datasets?.['USDA SR28']?.official_check || 'Per record (records[…].official_check), against USDA FoodData Central SR Legacy.',
    },
    'Product label': {
      release: 'Exact product labels, added one by one when a label is in hand',
      caveat: 'No label extracts are pinned yet, so no "Product label" reference amount can pass verification.',
    },
  },
  // What each app nutrient means in each dataset, by the source column it is
  // read from (ref.mjs). Stored on every accepted value (meta.source.definition).
  nutrient_definitions: {
    'USDA SR28': {
      _columns: 'ABBREV.txt field names (SR28 documentation)',
      vit_a: 'Vit_A_RAE (mcg retinol activity equivalents)', vit_d: 'Vit_D_IU (IU; D2 + D3)', vit_e: 'Vit_E_(mg) (alpha-tocopherol)',
      vit_k: 'Vit_K_(µg) (phylloquinone)', folate: 'Folate_Tot_(µg) (total folate, not DFE)', vit_b12: 'Vitamin_B12_(µg)', choline: 'Choline_Tot_(mg)',
      fiber: 'Fiber_TD_(g) (total dietary fibre)', sugar: 'Sugar_Tot_(g)', saturated_fat: 'FA_Sat_(g)', cholesterol: 'Cholestrl_(mg)', lycopene: 'Lycopene_(µg)',
      _other: 'other minerals and B vitamins: the ABBREV field of the same name, in the app unit',
    },
    'IFCT 2017': {
      _columns: 'IFCT 2017 component codes as transcribed in ifct2017@2.1.2 (check against the official PDF headers)',
      vit_d: 'chocal (cholecalciferol, D3) only, converted 1 mcg = 40 IU; ergocalciferol (D2) is not used',
      vit_k: 'vitk1 + vitk2', folate: 'folsum (total folates)', fiber: 'fibtg (total dietary fibre)', vit_e: 'vite (as transcribed)',
      omega3_ala: 'f18d3n3', omega3_epa: 'f20d5n3', omega3_dha: 'f22d6n3', omega6: 'f18d2cn6',
      _other: 'other nutrients: the component code mapped in ref.mjs IFCT_MAP, converted from g to the app unit',
    },
  },
  retention_factors_source: 'The retention-factor table in npm ifct2017@2.1.2 (retentionfactors/index.csv), attributed there to IFCT 2017; fraction kept per cooking method; key "<nutrient>|<method>". Not yet compared with the official book (retention_factors_check). An absent retention factor on an ingredient means the documented default 1 (nothing lost).',
  retention_factors,
  // Same rule for the factor table: null until checked against the official source.
  retention_factors_check: prev.retention_factors && same(prev.retention_factors, retention_factors) ? (prev.retention_factors_check ?? null) : null,
  records,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`pinned ${Object.keys(records).length} records and ${Object.keys(retention_factors).length} retention factors → ${path.relative(REPO, OUT)}`);
