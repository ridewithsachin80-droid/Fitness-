/**
 * services/macroCheck.js — does a food's stated calories agree with its own macros?
 *
 * WHY THIS IS ITS OWN MODULE
 * --------------------------
 * The Atwater check already existed in `scripts/validate-foods.js`, where it
 * audits the seed files. Sprint L3 needs the same check live, on the review
 * queue, so an AI-guessed food whose calories contradict its own macros floats
 * to the top. Copying twelve lines into routes/foods.js would have given us two
 * implementations that drift — the same mistake the int8 parser fix was written
 * to avoid. One implementation, called from both places.
 *
 * WHAT IT CATCHES
 * ---------------
 * 4·protein + 4·carbs + 9·fat should land near the stated calories. When it
 * does not, one of the two numbers is wrong, and it is detectable without a
 * human looking at it. In practice this finds:
 *
 *   · per-serving values pasted into a per-100g field (a 30g scoop of whey
 *     entered as 100g reads a third of the truth — this exact bug reached
 *     members' logs)
 *   · a calorie figure the model invented with no macro breakdown behind it
 *     (250 kcal, P0 C0 F0)
 *   · a decimal slip in one macro
 *
 * WHY THE TOLERANCE IS A PARAMETER
 * --------------------------------
 * The 4/4/9 model ignores alcohol, polyols and fibre, so real foods sit a few
 * per cent off it legitimately. The seed validator has run at 25% for months
 * against a known corpus; changing that number would re-flag hundreds of rows
 * that were already reviewed, which is an unrelated change riding along with
 * this sprint. The review queue uses the 20% the sprint doc asks for. Same
 * arithmetic, two calibrations, both stated out loud.
 */

/**
 * Foods whose name says the numbers are per unit, not per 100g — a capsule, a
 * tablet, "per sachet". Atwater cannot say anything useful about those, so they
 * are reported as unknown rather than flagged.
 */
const PER_UNIT = /\(\s*\d|\bcapsule|\btablet|\bdrops?\b|\bper\s|\btsp\b|\btbsp\b|\bml\b|\bIU\b|\bmcg\b|\binjection\b|\bsachet\b/i;

/** 4·protein + 4·carbs + 9·fat. */
function atwaterKcal(per100g = {}) {
  const pro  = +per100g.protein     || 0;
  const carb = +per100g.total_carbs || 0;
  const fat  = +per100g.fat         || 0;
  return 4 * pro + 4 * carb + 9 * fat;
}

/**
 * @param {object} per100g
 * @param {string} name
 * @param {object} [opts]
 * @param {number} [opts.tolerance=0.20]  fraction of the Atwater figure allowed
 * @param {number} [opts.floorKcal=30]    absolute floor, so tiny foods are not
 *                                        flagged for a rounding difference
 * @returns {{status:'ok'|'suspect'|'unknown', stated:number, atwater:number,
 *            delta:number, delta_pct:number|null, reason:string|null}}
 */
function macroPlausibility(per100g = {}, name = '', opts = {}) {
  const tolerance = Number.isFinite(opts.tolerance) ? opts.tolerance : 0.20;
  const floorKcal = Number.isFinite(opts.floorKcal) ? opts.floorKcal : 30;

  const stated  = +per100g.calories || 0;
  const atwater = atwaterKcal(per100g);
  const delta   = Math.abs(stated - atwater);

  // Nothing to compare. An empty per_100g is a different problem (the food has
  // no nutrition at all) and saying "suspect" here would bury the real ones.
  if (stated === 0 && atwater === 0) {
    return { status: 'unknown', stated, atwater, delta: 0, delta_pct: null,
             reason: 'no nutrition data to check' };
  }
  if (PER_UNIT.test(String(name || ''))) {
    return { status: 'unknown', stated, atwater, delta, delta_pct: null,
             reason: 'values look per-unit, not per-100g' };
  }

  const tol = Math.max(floorKcal, atwater * tolerance);
  if (delta <= tol) {
    return { status: 'ok', stated, atwater, delta, delta_pct: pct(delta, atwater), reason: null };
  }

  return {
    status: 'suspect',
    stated, atwater, delta,
    delta_pct: pct(delta, atwater),
    reason: atwater === 0
      ? `${Math.round(stated)} kcal stated but no macros behind it`
      : `${Math.round(stated)} kcal stated, ${Math.round(atwater)} from its macros`,
  };
}

function pct(delta, atwater) {
  if (!atwater) return null;
  return Math.round((delta / atwater) * 100);
}


/**
 * Dishes that are cooked in fat, by name.
 *
 * The Atwater check compares a food's calories with its own macros, so it is
 * blind to a food that is internally consistent and simply wrong. A masala
 * dosa entered as 140 kcal / 3g fat per 100g passes it perfectly — the numbers
 * agree, they just describe a dosa nobody cooked.
 *
 * That is the commonest failure in AI-guessed Indian food: the model returns
 * the batter, not the dish. Two spoons of oil on the tawa is 16-20g of fat that
 * never appears, and the member under-reports by 150-200 kcal every time they
 * log it.
 */
const FRIED_OR_TEMPERED = /\b(dosa|poori|puri|paratha|vada|pakora|pakoda|bhaji|bajji|bonda|samosa|cutlet|tikki|fry|fried|roast|masala|curry|sabzi|subzi|sabji|gravy|kofta|malai|korma|biryani|pulao|halwa|ladoo|laddu|chikki|puran)\b/i;

/** Dishes that genuinely carry little fat despite matching above. */
const LOW_FAT_EXCEPTIONS = /\b(rasam|sambar|dal|chutney|raita|buttermilk|kanji|soup|steam(ed)?|idli|idly|appam|kozhukattai)\b/i;

/** Fat per 100g below which a cooked dish is not credible. */
const COOKED_FAT_FLOOR = 4;

/**
 * Does this look like a cooked dish someone forgot the cooking fat for?
 * @returns {{status:'ok'|'suspect'|'unknown', reason:string|null}}
 */
function cookingFatPlausibility(per100g = {}, name = '') {
  const n = String(name || '');
  if (!FRIED_OR_TEMPERED.test(n))  return { status: 'unknown', reason: 'not a cooked-in-fat dish by name' };
  if (LOW_FAT_EXCEPTIONS.test(n))  return { status: 'unknown', reason: 'this dish is legitimately low fat' };
  if (PER_UNIT.test(n))            return { status: 'unknown', reason: 'values look per-unit, not per-100g' };

  const fat = +per100g.fat || 0;
  const cal = +per100g.calories || 0;
  if (cal === 0) return { status: 'unknown', reason: 'no nutrition data to check' };

  if (fat >= COOKED_FAT_FLOOR) return { status: 'ok', reason: null };
  return {
    status: 'suspect',
    reason: `${fat}g fat per 100g — a cooked dish with no cooking fat in it`,
  };
}

module.exports = { atwaterKcal, macroPlausibility, cookingFatPlausibility,
                   PER_UNIT, FRIED_OR_TEMPERED, COOKED_FAT_FLOOR };
