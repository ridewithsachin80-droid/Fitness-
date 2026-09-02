/**
 * services/fatProfile.js — what a food's fat is likely made of.
 *
 * "10g fat, 0g saturated" is not possible for anything cooked in oil, but the
 * saturated share cannot be COMPUTED from the total: it depends entirely on
 * which fat went in. Sunflower is about a ninth saturated; ghee is two thirds;
 * coconut is nearly all of it. A fixed ratio would be inventing a number, which
 * is how the wrong figures got into this database in the first place.
 *
 * So this suggests rather than calculates. Name the cooking fat and the split
 * follows from that fat's real composition; the coach accepts it with a tap or
 * types their own. The suggestion is always shown with its reasoning attached,
 * so it can be judged rather than trusted.
 *
 * Fractions are of TOTAL FAT, from standard composition tables (IFCT / USDA).
 */
const FATS = {
  sunflower: { label: 'Sunflower oil', sat: 0.11, mufa: 0.20, pufa: 0.66 },
  groundnut: { label: 'Groundnut oil', sat: 0.17, mufa: 0.46, pufa: 0.32 },
  mustard:   { label: 'Mustard oil',   sat: 0.12, mufa: 0.59, pufa: 0.21 },
  ricebran:  { label: 'Rice bran oil', sat: 0.25, mufa: 0.38, pufa: 0.33 },
  sesame:    { label: 'Sesame oil',    sat: 0.14, mufa: 0.40, pufa: 0.42 },
  olive:     { label: 'Olive oil',     sat: 0.14, mufa: 0.73, pufa: 0.11 },
  palm:      { label: 'Palm oil',      sat: 0.49, mufa: 0.37, pufa: 0.09 },
  vanaspati: { label: 'Vanaspati',     sat: 0.50, mufa: 0.35, pufa: 0.10 },
  ghee:      { label: 'Ghee',          sat: 0.65, mufa: 0.25, pufa: 0.04 },
  butter:    { label: 'Butter',        sat: 0.63, mufa: 0.26, pufa: 0.03 },
  coconut:   { label: 'Coconut oil',   sat: 0.87, mufa: 0.06, pufa: 0.02 },
};

/** The default when nobody says — the commonest cooking oil in Indian kitchens. */
const DEFAULT_FAT = 'sunflower';

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * @param {number} totalFat  grams of fat per 100g of the food
 * @param {string} [source]  a key from FATS
 * @returns {{ saturated:number, mufa:number, pufa:number, label:string, note:string }|null}
 */
function suggestFatSplit(totalFat, source = DEFAULT_FAT) {
  const fat = parseFloat(totalFat);
  if (!Number.isFinite(fat) || fat <= 0) return null;
  const f = FATS[source] || FATS[DEFAULT_FAT];
  return {
    saturated: round1(fat * f.sat),
    mufa:      round1(fat * f.mufa),
    pufa:      round1(fat * f.pufa),
    label:     f.label,
    note:      `${round1(fat)}g fat cooked in ${f.label.toLowerCase()} is about ` +
               `${round1(fat * f.sat)}g saturated (${Math.round(f.sat * 100)}% of the fat).`,
  };
}

/**
 * A food with real fat and no saturated fat at all.
 *
 * Detectable without a human, like the Atwater check: there is no fat on earth
 * that is 0% saturated, so a food carrying 10g of fat and 0g saturated is
 * missing data rather than describing something unusual.
 */
const SATURATED_FLOOR_FAT = 3;

function saturatedPlausibility(per100g = {}) {
  const fat = +per100g.fat || 0;
  const sat = +per100g.saturated_fat || 0;
  if (fat < SATURATED_FLOOR_FAT) return { status: 'unknown', reason: 'too little fat to judge' };
  if (sat > 0) {
    // The other direction: saturated cannot exceed the total it is part of.
    if (sat > fat + 0.05) {
      return { status: 'suspect', reason: `${sat}g saturated inside ${fat}g of total fat` };
    }
    return { status: 'ok', reason: null };
  }
  return {
    status: 'suspect',
    reason: `${round1(fat)}g fat but no saturated fat recorded — no fat is 0% saturated`,
  };
}

module.exports = { FATS, DEFAULT_FAT, suggestFatSplit, saturatedPlausibility, SATURATED_FLOOR_FAT };
