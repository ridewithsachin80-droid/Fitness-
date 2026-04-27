// ── Activities (6 total) ─────────────────────────────────────────────────────
export const ACTIVITIES = [
  { id: 'walk',       label: 'Morning Walk',        sub: '30 min · 6:30–7:00 AM',             icon: '🚶', met: 3.5, durationMin: 30 },
  { id: 'sun',        label: 'Sunlight Exposure',   sub: '20 min · 7:00–7:20 AM',             icon: '☀️', met: 1.3, durationMin: 20, vitD_iu: 1000 },
  { id: 'steps1',     label: 'Post Meal 1 Steps',   sub: '2,000 steps after 10 AM meal',      icon: '👟', met: 3.0, durationMin: 15 },
  { id: 'resistance', label: 'Resistance Training', sub: '30 min under instructor',            icon: '🏋️', met: 5.0, durationMin: 30 },
  { id: 'steps2',     label: 'Post Meal 2 Steps',   sub: '2,000 steps after 1:30 PM meal',    icon: '👟', met: 3.0, durationMin: 15 },
  { id: 'steps3',     label: 'Post Meal 3 Steps',   sub: '2,000 steps after 5:30 PM meal',    icon: '👟', met: 3.0, durationMin: 15 },
];

// ── ACV Items (3 total) ──────────────────────────────────────────────────────
export const ACV_ITEMS = [
  { id: 'acv1', label: 'ACV before Meal 1', sub: '9:45 AM · 1 tbsp in 200ml warm water · through straw' },
  { id: 'acv2', label: 'ACV before Meal 2', sub: '1:15 PM · 1 tbsp in 200ml warm water · through straw' },
  { id: 'acv3', label: 'ACV before Meal 3', sub: '5:15 PM · 1 tbsp in 200ml warm water · through straw' },
];

// ── Supplements (7 total) ────────────────────────────────────────────────────
export const SUPPLEMENTS = [
  { id: 'b12',        label: 'Vitamin B12',      sub: 'Injection / Oral' },
  { id: 'd3',         label: 'Vitamin D3',        sub: '60,000 IU weekly' },
  { id: 'fishoil',    label: 'Fish Oil',          sub: 'Muscleze Gold · with Meal 1' },
  { id: 'multi',      label: 'Multivitamin',      sub: 'With Meal 1' },
  { id: 'flax',       label: 'Flaxseed Oil',      sub: '1 tsp · on dinner salad' },
  { id: 'yeast',      label: 'Nutritional Yeast', sub: '1 tbsp · with Meal 2' },
  { id: 'electrolyte',label: 'Electrolyte',       sub: 'Sugar-free · post activity' },
];

// ── Nutrition database (per 100g) ─────────────────────────────────────────────
// { cal: kcal, pro: protein g, carb: carbs g, fat: fat g }
export const NUTRITION_DB = {
  'Epigamia Greek Yoghurt':   { cal: 73,  pro: 6.5, carb: 5.0, fat: 2.8 },
  'Chia Seeds':               { cal: 486, pro: 17,  carb: 42,  fat: 31  },
  'Paneer (Low Fat)':         { cal: 204, pro: 18,  carb: 4.0, fat: 13  },
  'Avocado':                  { cal: 160, pro: 2.0, carb: 9.0, fat: 15  },
  'Leafy Greens':             { cal: 25,  pro: 2.5, carb: 4.0, fat: 0.4 },
  'Non-Starchy Vegetables':   { cal: 30,  pro: 2.0, carb: 5.0, fat: 0.3 },
  'Millets':                  { cal: 378, pro: 11,  carb: 73,  fat: 4.2 },
  'Brown/Red Rice':           { cal: 216, pro: 5.0, carb: 45,  fat: 1.8 },
  'Macadamia Nuts':           { cal: 718, pro: 7.9, carb: 14,  fat: 76  },
  'Pecan Nuts':               { cal: 691, pro: 9.2, carb: 14,  fat: 72  },
  'Almonds':                  { cal: 579, pro: 21,  carb: 22,  fat: 50  },
  'Ghee':                     { cal: 900, pro: 0,   carb: 0,   fat: 99  },
  'Tomato':                   { cal: 18,  pro: 0.9, carb: 3.9, fat: 0.2 },
  'Flaxseed Oil':             { cal: 884, pro: 0,   carb: 0,   fat: 100 },
  'Nutritional Yeast':        { cal: 325, pro: 50,  carb: 38,  fat: 5.0 },
  'ACV (Apple Cider Vinegar)':{ cal: 22,  pro: 0,   carb: 0.9, fat: 0   },
  'Eggs':                     { cal: 155, pro: 13,  carb: 1.1, fat: 11  },
  'Tofu':                     { cal: 76,  pro: 8.1, carb: 1.9, fat: 4.8 },
  'Broccoli':                 { cal: 34,  pro: 2.8, carb: 7.0, fat: 0.4 },
  'Cucumber':                 { cal: 15,  pro: 0.7, carb: 3.6, fat: 0.1 },
  'Spinach':                  { cal: 23,  pro: 2.9, carb: 3.6, fat: 0.4 },
  'Oats':                     { cal: 389, pro: 17,  carb: 66,  fat: 7.0 },
  'Chicken Breast':           { cal: 165, pro: 31,  carb: 0,   fat: 3.6 },
  'Fish (Rohu/Catla)':        { cal: 97,  pro: 17,  carb: 0,   fat: 2.8 },
  'Dal (Cooked)':             { cal: 116, pro: 9.0, carb: 20,  fat: 0.4 },
  'Banana':                   { cal: 89,  pro: 1.1, carb: 23,  fat: 0.3 },
  'Apple':                    { cal: 52,  pro: 0.3, carb: 14,  fat: 0.2 },
  'Coconut Oil':              { cal: 862, pro: 0,   carb: 0,   fat: 100 },
  'Peanut Butter':            { cal: 588, pro: 25,  carb: 20,  fat: 50  },
  'Whole Milk':               { cal: 61,  pro: 3.2, carb: 4.8, fat: 3.3 },
  'Sweet Potato':             { cal: 86,  pro: 1.6, carb: 20,  fat: 0.1 },
  'Chapati/Roti':             { cal: 297, pro: 8.0, carb: 61,  fat: 3.7 },
};

/** Get nutrition for a food item (grams). Returns { cal, pro, carb, fat } */
export const getNutrition = (name, grams) => {
  const db = NUTRITION_DB[name];
  if (!db || !grams) return null;
  const factor = grams / 100;
  return {
    cal:  Math.round(db.cal  * factor),
    pro:  +(db.pro  * factor).toFixed(1),
    carb: +(db.carb * factor).toFixed(1),
    fat:  +(db.fat  * factor).toFixed(1),
  };
};

// ── Food presets for autocomplete ────────────────────────────────────────────
export const FOOD_PRESETS = Object.keys(NUTRITION_DB);

// ── Compliance totals ────────────────────────────────────────────────────────
export const TOTAL_ACTIVITIES   = ACTIVITIES.length;   // 6
export const TOTAL_ACV          = ACV_ITEMS.length;    // 3
export const TOTAL_SUPPLEMENTS  = SUPPLEMENTS.length;  // 7
export const TOTAL_CHECKABLE    = TOTAL_ACTIVITIES + TOTAL_ACV + TOTAL_SUPPLEMENTS; // 16

// ── Helpers ──────────────────────────────────────────────────────────────────
/** Returns today as YYYY-MM-DD in local time */
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Formats YYYY-MM-DD (or full ISO timestamp) as "Mon, 3 Jan" in Indian locale */
export const formatDate = (dateStr) => {
  const d = String(dateStr).slice(0, 10); // handles both "2026-04-26" and "2026-04-26T00:00:00.000Z"
  return new Date(d + 'T12:00:00').toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
};

/** Blank log template */
export const emptyLog = () => ({
  weight:      '',
  activities:  {},
  acv:         {},
  food:        [],
  water:       0,
  supplements: {},
  sleep:       { bedtime: '', waketime: '', quality: 0 },
  notes:       '',
  savedAt:     null,
});

/** Calculate compliance % from log fields — pass filtered active lists for per-member protocol */
export const calcCompliance = (log, acts = ACTIVITIES, acvList = ACV_ITEMS, suppList = SUPPLEMENTS) => {
  const actDone  = acts.filter(a => log.activities?.[a.id]).length;
  const acvDone  = acvList.filter(a => log.acv?.[a.id]).length;
  const suppDone = suppList.filter(s => log.supplements?.[s.id]).length;
  const total    = acts.length + acvList.length + suppList.length;
  if (!total) return 0;
  return Math.round(((actDone + acvDone + suppDone) / total) * 100);
};

// ── Sprint 5: Full RDA Targets (female, 60yr, Indian baseline) ───────────────
// Admin can override any value per member via rda_overrides in patient_profiles.
export const RDA_TARGETS = {
  // ── Vitamins (14) ──
  vit_a:   { rda:700,   unit:'mcg', label:'Vitamin A',         icon:'🥕', tab:'vitamins' },
  vit_b1:  { rda:1.1,   unit:'mg',  label:'B1 Thiamine',       icon:'🌾', tab:'vitamins' },
  vit_b2:  { rda:1.1,   unit:'mg',  label:'B2 Riboflavin',     icon:'🥛', tab:'vitamins' },
  vit_b3:  { rda:14,    unit:'mg',  label:'B3 Niacin',         icon:'🐟', tab:'vitamins' },
  vit_b5:  { rda:5,     unit:'mg',  label:'B5 Pantothenic',    icon:'🥑', tab:'vitamins' },
  vit_b6:  { rda:1.5,   unit:'mg',  label:'B6 Pyridoxine',     icon:'🥜', tab:'vitamins' },
  vit_b12: { rda:2.4,   unit:'mcg', label:'Vitamin B12',       icon:'💉', tab:'vitamins' },
  vit_c:   { rda:75,    unit:'mg',  label:'Vitamin C',         icon:'🍊', tab:'vitamins' },
  vit_d:   { rda:800,   unit:'IU',  label:'Vitamin D',         icon:'☀️', tab:'vitamins' },
  vit_e:   { rda:15,    unit:'mg',  label:'Vitamin E',         icon:'🌻', tab:'vitamins' },
  vit_k:   { rda:90,    unit:'mcg', label:'Vitamin K',         icon:'🥦', tab:'vitamins' },
  folate:  { rda:400,   unit:'mcg', label:'Folate (B9)',        icon:'🧬', tab:'vitamins' },
  biotin:  { rda:30,    unit:'mcg', label:'Biotin (B7)',        icon:'🥚', tab:'vitamins' },
  choline: { rda:425,   unit:'mg',  label:'Choline',           icon:'🧠', tab:'vitamins' },
  // ── Minerals (10) ──
  calcium:    { rda:1200, unit:'mg',  label:'Calcium',   icon:'🦴', tab:'minerals' },
  iron:       { rda:8,    unit:'mg',  label:'Iron',      icon:'⚙️', tab:'minerals' },
  magnesium:  { rda:320,  unit:'mg',  label:'Magnesium', icon:'⚡', tab:'minerals' },
  phosphorus: { rda:700,  unit:'mg',  label:'Phosphorus',icon:'🔋', tab:'minerals' },
  potassium:  { rda:2600, unit:'mg',  label:'Potassium', icon:'🍌', tab:'minerals' },
  sodium:     { rda:2300, unit:'mg',  label:'Sodium',    icon:'🧂', tab:'minerals', upper:true },
  zinc:       { rda:8,    unit:'mg',  label:'Zinc',      icon:'🔩', tab:'minerals' },
  copper:     { rda:0.9,  unit:'mg',  label:'Copper',    icon:'🔶', tab:'minerals' },
  manganese:  { rda:1.8,  unit:'mg',  label:'Manganese', icon:'🔷', tab:'minerals' },
  selenium:   { rda:55,   unit:'mcg', label:'Selenium',  icon:'🌟', tab:'minerals' },
  // ── Specials (7) ──
  omega3_ala: { rda:1100, unit:'mg',  label:'Omega-3 ALA',    icon:'🌿', tab:'specials' },
  omega3_epa: { rda:250,  unit:'mg',  label:'Omega-3 EPA',    icon:'🐟', tab:'specials' },
  omega3_dha: { rda:250,  unit:'mg',  label:'Omega-3 DHA',    icon:'🐠', tab:'specials' },
  omega6:     { rda:11000,unit:'mg',  label:'Omega-6',        icon:'🫒', tab:'specials' },
  fiber:      { rda:21,   unit:'g',   label:'Dietary Fiber',  icon:'🌾', tab:'specials' },
  lycopene:   { rda:6000, unit:'mcg', label:'Lycopene',       icon:'🍅', tab:'specials' },
  beta_glucan:{ rda:3,    unit:'g',   label:'Beta-Glucan',    icon:'🌀', tab:'specials' },
};

// Keys for admin RDA override UI (the most clinically relevant)
export const RDA_OVERRIDE_KEYS = [
  'vit_b12','vit_d','calcium','iron','omega3_epa','omega3_dha','fiber','folate','zinc','selenium'
];
