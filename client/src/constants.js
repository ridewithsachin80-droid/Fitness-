// ── Activities (6 total) ─────────────────────────────────────────────────────
export const ACTIVITIES = [
  { id: 'walk',       label: 'Morning Walk',        sub: '30 min · 6:30–7:00 AM',             icon: '🚶' },
  { id: 'sun',        label: 'Sunlight Exposure',   sub: '20 min · 7:00–7:20 AM',             icon: '☀️' },
  { id: 'steps1',     label: 'Post Meal 1 Steps',   sub: '2,000 steps after 10 AM meal',      icon: '👟' },
  { id: 'resistance', label: 'Resistance Training', sub: '30 min under instructor',            icon: '🏋️' },
  { id: 'steps2',     label: 'Post Meal 2 Steps',   sub: '2,000 steps after 1:30 PM meal',    icon: '👟' },
  { id: 'steps3',     label: 'Post Meal 3 Steps',   sub: '2,000 steps after 5:30 PM meal',    icon: '👟' },
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

// ── Food presets for autocomplete ────────────────────────────────────────────
export const FOOD_PRESETS = [
  'Epigamia Greek Yoghurt',
  'Chia Seeds',
  'Paneer (Low Fat)',
  'Avocado',
  'Leafy Greens',
  'Non-Starchy Vegetables',
  'Millets',
  'Brown/Red Rice',
  'Macadamia Nuts',
  'Pecan Nuts',
  'Almonds',
  'Ghee',
  'Tomato',
  'Flaxseed Oil',
  'Nutritional Yeast',
  'ACV (Apple Cider Vinegar)',
  'Eggs',
  'Tofu',
  'Broccoli',
  'Cucumber',
  'Spinach',
  'Oats',
];

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

/** Formats YYYY-MM-DD as "Mon, 3 Jan" in Indian locale */
export const formatDate = (dateStr) =>
  new Date(dateStr + 'T12:00:00').toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

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

/** Calculate compliance % from log fields */
export const calcCompliance = (log) => {
  const actDone  = ACTIVITIES.filter(a => log.activities?.[a.id]).length;
  const acvDone  = ACV_ITEMS.filter(a => log.acv?.[a.id]).length;
  const suppDone = SUPPLEMENTS.filter(s => log.supplements?.[s.id]).length;
  return Math.round(((actDone + acvDone + suppDone) / TOTAL_CHECKABLE) * 100);
};
