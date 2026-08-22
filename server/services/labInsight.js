/**
 * labInsight.js — turns a lab panel into nutritional guidance, with a hard
 * safety layer that runs before any AI is consulted.
 *
 * ── The line this file draws ────────────────────────────────────────────────
 *
 * NUTRITIONAL INTERPRETATION is in scope. A nutritionist looks at ferritin,
 * B12, vitamin D, HbA1c and lipids and changes what someone eats. Those
 * markers have real dietary levers and the advice is the same advice a
 * qualified practitioner would give.
 *
 * MEDICAL DIAGNOSIS is not. Explaining WHY a marker is abnormal is
 * differential diagnosis: it needs medication history, symptoms, examination
 * and often further tests. "ALT is high because of fatty liver" could equally
 * be hepatitis, a statin, or last weekend. The app must not guess, and this
 * file makes it structurally unable to.
 *
 * ── Why the rule layer runs first ───────────────────────────────────────────
 *
 * The dangerous failure is not bad diet advice. It is an app that offers diet
 * advice at all when the number needs a doctor this week — a member with
 * haemoglobin of 7 does not need spinach recipes, and receiving them is an
 * implicit reassurance that could cost them time they do not have.
 *
 * So: deterministic thresholds classify every marker BEFORE the AI is called.
 * Anything urgent is escalated and its dietary advice suppressed entirely.
 * The AI only ever sees markers already cleared as nutritionally actionable.
 *
 * ── And a coach still approves ──────────────────────────────────────────────
 *
 * Output goes to the coach, never straight to the member. Same pattern as the
 * macro trials: the engine proposes, the professional decides.
 */

const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

/** Normalise the many ways a lab prints the same marker. */
function canonical(name) {
  const n = String(name || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const map = [
    [/hba1c|glycated h|glycosylated h/, 'hba1c'],
    [/fasting (blood )?(glucose|sugar)|fbs\b/, 'glucose_fasting'],
    [/random (blood )?(glucose|sugar)|rbs\b/, 'glucose_random'],
    [/^h(a)?emoglobin$|^hb$|^hb /, 'haemoglobin'],
    [/ferritin/, 'ferritin'],
    [/vitamin b ?12|cobalamin/, 'b12'],
    [/vitamin d|25 ?oh|cholecalciferol/, 'vitamin_d'],
    [/total cholesterol|^cholesterol total|^cholesterol$/, 'cholesterol_total'],
    [/\bldl\b/, 'ldl'],
    [/\bhdl\b/, 'hdl'],
    [/triglyceride/, 'triglycerides'],
    [/\balt\b|sgpt/, 'alt'],
    [/\bast\b|sgot/, 'ast'],
    [/\bggt\b|gamma gt/, 'ggt'],
    [/creatinine/, 'creatinine'],
    [/\buric acid\b/, 'uric_acid'],
    [/\btsh\b|thyroid stimulating/, 'tsh'],
    [/potassium|\bk\b/, 'potassium'],
    [/sodium/, 'sodium'],
    [/platelet/, 'platelets'],
    [/leucocyte|leukocyte|\bwbc\b|white (blood )?cell/, 'wbc'],
    [/\bcrp\b|c reactive/, 'crp'],
    [/\bmcv\b/, 'mcv'],
    [/\bpcv\b|h(a)?ematocrit/, 'pcv'],
  ];
  for (const [rx, key] of map) if (rx.test(n)) return key;
  return null;
}

/**
 * Values that warrant prompt medical review regardless of anything else.
 * Deliberately conservative — a false escalation costs a GP visit, a missed
 * one costs far more. Units are the ones Indian labs print by default.
 */
const RED_FLAGS = [
  { key: 'haemoglobin',      test: v => v < 9,               why: 'markedly low haemoglobin' },
  { key: 'glucose_fasting',  test: v => v > 180,             why: 'a very high fasting glucose' },
  { key: 'glucose_random',   test: v => v > 250,             why: 'a very high random glucose' },
  { key: 'hba1c',            test: v => v > 9,               why: 'an HbA1c in a range that needs medical management' },
  { key: 'creatinine',       test: v => v > 2.0,             why: 'a raised creatinine' },
  { key: 'potassium',        test: v => v < 3.0 || v > 5.5,  why: 'a potassium level outside the safe band' },
  { key: 'platelets',        test: v => v < 100000 || v < 100, why: 'a low platelet count' },
  { key: 'wbc',              test: v => v < 3000 || v > 15000, why: 'a white cell count well outside range' },
  { key: 'tsh',              test: v => v > 10 || v < 0.1,   why: 'a TSH well outside range' },
  { key: 'alt',              test: v => v > 120,             why: 'a substantially raised ALT' },
  { key: 'ast',              test: v => v > 120,             why: 'a substantially raised AST' },
  { key: 'triglycerides',    test: v => v > 500,             why: 'a very high triglyceride level' },
];

/**
 * Markers with genuine dietary levers. `direction` is the abnormality this
 * entry addresses. Everything here is standard nutrition practice, not
 * inference — which is why it can be stated plainly.
 */
const NUTRITION_LEVERS = {
  ferritin: {
    low: {
      label: 'Low iron stores',
      foods: ['ragi', 'bajra', 'amaranth', 'green leafy vegetables', 'dates', 'jaggery',
              'chana', 'rajma', 'sesame seeds', 'liver or red meat if eaten'],
      pairing: 'Pair iron-rich meals with vitamin C — lemon, amla, guava, tomato — which sharply increases absorption.',
      avoid: 'Tea and coffee with meals block iron absorption; move them an hour either side.',
    },
  },
  b12: {
    low: {
      label: 'Low vitamin B12',
      foods: ['milk and curd', 'paneer', 'eggs', 'fish', 'fortified cereals'],
      pairing: 'B12 comes almost entirely from animal foods, so vegetarian members usually need a supplement rather than a food change.',
      avoid: null,
    },
  },
  vitamin_d: {
    low: {
      label: 'Low vitamin D',
      foods: ['fortified milk', 'egg yolk', 'fatty fish', 'mushrooms exposed to sunlight'],
      pairing: 'Diet contributes little — 20 to 30 minutes of midday sun on arms and legs matters more, and most deficiency needs supplementation.',
      avoid: null,
    },
  },
  hba1c: {
    high: {
      label: 'Raised blood sugar',
      foods: ['whole grains in place of refined', 'pulses and legumes', 'vegetables at every meal',
              'nuts', 'curd'],
      pairing: 'Eating protein and vegetables before the carbohydrate portion of a meal blunts the glucose rise. Walking 10–15 minutes after meals helps measurably.',
      avoid: 'Sugary drinks, sweets, refined flour and fruit juice raise it most sharply.',
    },
  },
  triglycerides: {
    high: {
      label: 'High triglycerides',
      foods: ['fatty fish', 'flaxseed', 'walnuts', 'vegetables', 'whole grains'],
      pairing: 'Triglycerides respond faster to diet than most markers — often within weeks.',
      avoid: 'Refined carbohydrates, sugar and alcohol are the main drivers, more so than dietary fat.',
    },
  },
  ldl: {
    high: {
      label: 'High LDL cholesterol',
      foods: ['oats', 'barley', 'pulses', 'nuts', 'fruit and vegetables', 'mustard or rice bran oil'],
      pairing: 'Soluble fibre — oats, beans, psyllium — lowers LDL directly.',
      avoid: 'Saturated fat: ghee, butter, coconut oil, fried food, and processed meats.',
    },
  },
  hdl: {
    low: {
      label: 'Low HDL cholesterol',
      foods: ['nuts', 'seeds', 'olive or mustard oil', 'fatty fish'],
      pairing: 'HDL responds more to activity than to food — regular aerobic exercise is the strongest lever.',
      avoid: 'Refined carbohydrates lower HDL.',
    },
  },
  uric_acid: {
    high: {
      label: 'High uric acid',
      foods: ['water — 3 litres daily', 'cherries', 'low-fat dairy', 'vegetables'],
      pairing: 'Hydration matters more than most people expect.',
      avoid: 'Organ meat, red meat, shellfish, beer and fructose-sweetened drinks.',
    },
  },
  haemoglobin: {
    low: {
      label: 'Low haemoglobin',
      foods: ['green leafy vegetables', 'ragi', 'dates', 'jaggery', 'pulses', 'sesame'],
      pairing: 'Add vitamin C to iron-rich meals. If ferritin was also tested, that tells you whether iron stores are the cause.',
      avoid: 'Tea and coffee with meals.',
    },
  },
};

function state(value, refMin, refMax) {
  const v = num(value), lo = num(refMin), hi = num(refMax);
  if (v == null) return null;
  if (lo != null && v < lo) return 'low';
  if (hi != null && v > hi) return 'high';
  return 'normal';
}

/**
 * Classify a panel before any AI sees it.
 * @returns { urgent[], actionable[], other[], safe_to_advise }
 */
function triage(labs = []) {
  const urgent = [], actionable = [], other = [];
  const seen = new Set();

  // Newest result per marker only — advising on a superseded value is wrong
  const latest = new Map();
  for (const l of labs) {
    const key = canonical(l.test_name) || String(l.test_name || '').toLowerCase();
    const prev = latest.get(key);
    if (!prev || new Date(l.test_date) > new Date(prev.test_date)) latest.set(key, l);
  }

  for (const [key, l] of latest) {
    const v = num(l.value);
    if (v == null) continue;
    const st = state(l.value, l.ref_min, l.ref_max);
    const canon = canonical(l.test_name);
    const row = {
      test_name: l.test_name, canonical: canon, value: v, unit: l.unit,
      ref_min: num(l.ref_min), ref_max: num(l.ref_max), state: st,
      test_date: l.test_date,
    };

    const flag = RED_FLAGS.find(f => f.key === canon && f.test(v));
    if (flag) { urgent.push({ ...row, why: flag.why }); seen.add(key); continue; }

    if (st === 'low' || st === 'high') {
      const lever = canon && NUTRITION_LEVERS[canon]?.[st];
      if (lever) actionable.push({ ...row, lever });
      else other.push(row);
    }
  }

  return {
    urgent, actionable, other,
    // When anything urgent is present, diet advice is withheld for the whole
    // panel. Mixing "see a doctor promptly" with recipe suggestions dilutes
    // the first message, and the first message is the one that matters.
    safe_to_advise: urgent.length === 0,
  };
}

/**
 * Build the prompt for the narrative. Only ever receives markers already
 * cleared by triage, and states the boundaries explicitly rather than trusting
 * the model to infer them.
 */
function buildPrompt(t, context = {}) {
  const { name = 'the member', diet = 'unknown', kcal, protein } = context;

  const lines = t.actionable.map(a =>
    `  ${a.test_name}: ${a.value}${a.unit ? ' ' + a.unit : ''} (${a.state}, reference ` +
    `${a.ref_min ?? '—'}–${a.ref_max ?? '—'}) — ${a.lever.label}`).join('\n');

  const otherLines = t.other.length
    ? t.other.map(o => `  ${o.test_name}: ${o.value}${o.unit ? ' ' + o.unit : ''} (${o.state})`).join('\n')
    : '  none';

  return `You are a registered nutritionist writing notes for a fitness coach about
${name}'s recent blood work. The coach will review your notes before anything
reaches the member.

MARKERS WITH DIETARY LEVERS (these are what you address):
${lines || '  none'}

OTHER OUT-OF-RANGE MARKERS (mention only that the coach should raise them with
the member's doctor — do NOT interpret them):
${otherLines}

MEMBER CONTEXT
  Diet: ${diet}
  Current target: ${kcal ? `${kcal} kcal, ${protein}g protein` : 'not set'}

WHAT TO WRITE
For each marker with a dietary lever, three short paragraphs:
  1. WHAT it measures, in plain language a member would understand.
  2. WHAT THE DIET CHANGE IS — specific Indian foods, quantities where useful,
     and what to reduce. Practical, not generic.
  3. WHAT TO EXPECT — roughly how long before a retest could show movement.

Then one short section: three concrete meal ideas that fit their current
calorie and protein target while addressing the markers above. Indian foods,
things sold in an ordinary Indian market.

HARD RULES — these are not style preferences
· NEVER name a disease or condition. Not diabetes, not anaemia, not fatty
  liver, not deficiency-as-a-diagnosis. Describe the number, not a label.
· NEVER explain WHY a marker is abnormal. You do not have their medications,
  symptoms or history, and the same number has many causes.
· NEVER mention, suggest, adjust or discourage any medication or supplement
  dose. You may say "a supplement may be needed — the doctor should decide".
· NEVER predict or promise a result.
· NEVER suggest the member does or does not need to see a doctor. That is the
  coach's call, informed by the doctor who ordered the test.
· Write about food. Where food is not the main lever — vitamin D is mostly
  sunlight and supplementation — say so plainly rather than overstating diet.

Return ONLY raw JSON:
{
  "summary": "two sentences the coach could read aloud",
  "markers": [
    { "test_name": "Ferritin", "what_it_is": "...", "diet_change": "...",
      "timeframe": "..." }
  ],
  "meal_ideas": [
    { "meal": "Breakfast", "idea": "...", "why": "addresses low iron" }
  ],
  "raise_with_doctor": ["markers the coach should flag, by name only"]
}`;
}

/**
 * Build a macro target from the member's own numbers, adjusted for what the
 * panel actually showed.
 *
 * Computed in code, not by the model. Macro arithmetic is arithmetic — asking
 * a language model to divide calories into grams invites quiet errors that
 * look plausible, and the same input must always give the same answer.
 *
 * The lab-driven adjustments are conservative and reflect ordinary practice:
 *
 *   raised HbA1c        lower the carbohydrate share, raise protein and fibre
 *   high triglycerides  lower carbohydrate; triglycerides respond to refined
 *                       carbohydrate and alcohol more than to dietary fat
 *   high LDL            hold carbohydrate, shift fat quality rather than
 *                       quantity — the lever is saturated fat and fibre, and
 *                       neither shows up in a macro split
 *   low HDL             slightly higher fat, weighted to unsaturated sources
 *
 * Micronutrient findings — ferritin, B12, vitamin D — deliberately move
 * nothing. They are food-choice problems, not macro-ratio problems, and
 * pretending otherwise would be theatre.
 */
function macroTargets({ weightKg, maintenanceKcal, goal = 'loss', actionable = [] }) {
  if (!weightKg || !maintenanceKcal) return null;

  const has = (canon, st) => actionable.some(a => a.canonical === canon && a.state === st);

  const adjust = goal === 'gain' ? +250 : goal === 'maintain' ? 0 : -450;
  const kcal = Math.max(1200, Math.round((maintenanceKcal + adjust) / 10) * 10);

  // ── protein first, from body weight ──
  let proteinPerKg = goal === 'loss' ? 1.9 : 1.6;
  const reasons = [];
  if (has('hba1c', 'high')) { proteinPerKg += 0.2; }
  const protein_g = Math.round(Math.min(2.4, proteinPerKg) * weightKg);

  // ── then split what remains between carbohydrate and fat by SHARE ──
  // An earlier version derived carbohydrate as the leftover after a fixed fat
  // figure, which meant a carbohydrate floor bound in every scenario and none
  // of the lab adjustments moved the numbers at all — while the explanation
  // still claimed they had. Splitting the remainder by share makes each lever
  // visible in the output.
  const remaining = kcal - protein_g * 4;
  let carbShare = 0.55;                       // of the non-protein calories

  if (has('hba1c', 'high'))         { carbShare -= 0.10; }
  if (has('triglycerides', 'high')) { carbShare -= 0.08; }
  if (has('hdl', 'low'))            { carbShare -= 0.05; }
  carbShare = Math.max(0.35, carbShare);      // never starve training of fuel

  let carbs_g = Math.round((remaining * carbShare) / 4);
  let fat_g   = Math.round((remaining * (1 - carbShare)) / 9);

  // Floors, applied after the split so they only bite in extreme cases
  const minFat = Math.round(0.7 * weightKg);
  if (fat_g < minFat) {
    fat_g = minFat;
    carbs_g = Math.max(0, Math.round((remaining - fat_g * 9) / 4));
    reasons.push('fat held at its floor for hormonal function');
  }

  // Only claim an adjustment that actually happened
  if (has('hba1c', 'high')) {
    reasons.unshift('protein raised and carbohydrate reduced for the HbA1c reading');
  }
  if (has('triglycerides', 'high')) {
    reasons.push('carbohydrate reduced further — triglycerides respond to refined carbohydrate and alcohol more than to dietary fat');
  }
  if (has('hdl', 'low')) {
    reasons.push('a little more fat, weighted to nuts, seeds and oily fish, for the low HDL');
  }
  if (has('ldl', 'high')) {
    reasons.push('the ratio is unchanged for LDL — the lever there is saturated fat and soluble fibre, neither of which shows up in a macro split');
  }
  if (carbShare === 0.35) {
    reasons.push('carbohydrate held at its floor so training stays fuelled');
  }

  const total = protein_g * 4 + carbs_g * 4 + fat_g * 9;
  const pct = cal => Math.round((cal / total) * 100);
  // Derive the last share from the other two so they always sum to 100 —
  // three independent roundings otherwise show 33/34/34 = 101 or 99, which
  // looks like a bug to anyone reading carefully.
  const protein_pct = pct(protein_g * 4);
  const carbs_pct   = pct(carbs_g * 4);
  const fat_pct     = 100 - protein_pct - carbs_pct;

  return {
    kcal,
    protein_g, carbs_g, fat_g,
    protein_pct, carbs_pct, fat_pct,
    protein_per_kg: +(protein_g / weightKg).toFixed(2),
    computed_kcal: total,
    reasons,
  };
}

/**
 * Screen a generated analysis for clinical overreach.
 *
 * The first version of this matched bare words, which fails badly in both
 * directions: it blocked "this is not a diagnosis" and "the doctor should
 * decide the dose" — both of which are exactly the careful phrasing we want —
 * while a fluent claim using none of those words would sail through.
 *
 * So this checks CLAIMS, not vocabulary:
 *   · a disease named as an assertion, but not when it is being denied or
 *     deferred to a doctor
 *   · a specific dose, but not a statement that dosing is the doctor's call
 *   · a direct "you have <condition>" attribution
 *
 * @returns { ok:boolean, matches:string[] }
 */
function screenClinical(text) {
  const t = String(text || '');
  const matches = [];

  const DISEASE = /\b(diabetes|pre-?diabetes|an[a]?emia|fatty liver|hepatitis|cirrhosis|hypothyroidism|hyperthyroidism|thyroid disease|kidney disease|renal (failure|impairment)|cancer|metabolic syndrome)\b/gi;

  // Words that turn a disease mention into a denial or a referral. Checked in
  // the ~60 characters before the mention, which covers ordinary sentence
  // structure without swallowing a whole paragraph.
  const SAFE_CONTEXT = /\b(not|no|isn'?t|aren'?t|does not|do not|doesn'?t|cannot|can'?t|never|rather than|instead of|without|rule out|ruling out|whether|if\b|any|suggest(s|ing)? nothing|only a doctor|the doctor|their doctor|a doctor)\b/i;

  let m;
  while ((m = DISEASE.exec(t)) !== null) {
    const before = t.slice(Math.max(0, m.index - 60), m.index);
    if (!SAFE_CONTEXT.test(before)) matches.push(`asserts "${m[0]}"`);
  }

  // A specific dose is prescribing. "The doctor should decide the dose" is not.
  const DOSE = /\b(take|start|begin|increase|reduce|add)\b[^.]{0,40}?\b\d+\s*(mg|mcg|µg|iu|g|ml|tablets?|capsules?)\b/gi;
  while ((m = DOSE.exec(t)) !== null) matches.push(`prescribes a dose: "${m[0].trim().slice(0, 50)}"`);

  // Direct attribution to the member
  const ATTRIB = /\byou (have|are suffering from|are) (a |an )?(diabet|an[a]?emi|deficien|thyroid|fatty liver)/gi;
  while ((m = ATTRIB.exec(t)) !== null) matches.push(`attributes a condition: "${m[0].slice(0, 40)}"`);

  return { ok: matches.length === 0, matches };
}

module.exports = { triage, buildPrompt, canonical, state, screenClinical, macroTargets, RED_FLAGS, NUTRITION_LEVERS };
