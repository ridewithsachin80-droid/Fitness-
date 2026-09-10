import { calcFoodMacros } from './macros';

/**
 * lib/day/mealSuggest.js — "what should I eat now?" from the day's own gap.
 *
 * Sprint 11. The member has a calorie and protein target and has eaten some
 * of it. This works out what is LEFT, then picks from the foods they already
 * eat (their most-logged, with the gram amount they normally use) to fill it.
 *
 * Deliberately not an AI call: the suggestion has to be checkable. A member
 * can see "42 g protein left" and "paneer 150 g gets you 27 of it" and judge
 * it. It also has to work offline and instantly, which a round trip does not.
 *
 * Rules that keep it honest:
 *   · no targets → no suggestion (we would be inventing the gap)
 *   · nothing meaningful left → says so instead of pushing food
 *   · never suggests more than the remaining calories allow
 *   · only foods with real per-100g data, so the numbers are true
 */
const PROTEIN_DENSE = 12;   // g protein per 100 g — "a protein source"

/** What is left of the day's targets. Null when there is nothing to compare to. */
export function remaining({ kcalIn = 0, kcalTarget = null, proteinIn = 0, proteinTarget = null }) {
  if (!kcalTarget && !proteinTarget) return null;
  return {
    kcal: kcalTarget ? Math.round(kcalTarget - kcalIn) : null,
    protein: proteinTarget ? Math.round(proteinTarget - proteinIn) : null,
  };
}

/** Macros for `grams` of a food carrying per_100g data. */
function macrosFor(food, grams) {
  return calcFoodMacros([{ name: food.name, grams, per_100g: food.per_100g }]);
}

/**
 * @param {object} p
 * @param {number} p.kcalIn / p.kcalTarget / p.proteinIn / p.proteinTarget
 * @param {Array}  p.foods    recent foods: { name, per_100g, last_g, count }
 * @param {number} p.hour     IST hour — only used to name the meal
 * @returns {null | { headline, note, items: [{ name, grams, kcal, protein }], totals }}
 */
export function suggestMeal({ kcalIn = 0, kcalTarget = null, proteinIn = 0, proteinTarget = null, foods = [], hour = 12 }) {
  const left = remaining({ kcalIn, kcalTarget, proteinIn, proteinTarget });
  if (!left) return null;

  const kcalLeft = left.kcal;
  const proLeft  = left.protein;

  // Over the target is checked FIRST: a negative "kcal left" is not a small
  // remainder. (It read as "on target" until a test caught 2,100 against 1,800.)
  if (kcalLeft != null && kcalLeft < 0) {
    return { headline: `${Math.abs(kcalLeft)} kcal over target today.`, note: 'Water, a walk and an early night beat another meal.', items: [], totals: { kcal: 0, protein: 0 } };
  }
  const proteinMet = proLeft == null || proLeft <= 5;
  if (kcalLeft === 0 && proteinMet) {
    return { headline: 'Exactly on target today.', note: null, items: [], totals: { kcal: 0, protein: 0 } };
  }
  // Nothing worth suggesting: under ~150 kcal left and protein essentially met.
  if (proteinMet && (kcalLeft == null || kcalLeft < 150)) {
    return { headline: 'On target for today.', note: kcalLeft > 0 ? `About ${kcalLeft} kcal spare.` : null, items: [], totals: { kcal: 0, protein: 0 } };
  }

  const usable = foods.filter(f => f?.per_100g?.calories > 0 && f.name);
  if (!usable.length) {
    return {
      headline: proLeft > 5 ? `${proLeft} g protein and ${kcalLeft} kcal still to go.` : `${kcalLeft} kcal left today.`,
      note: 'Log a few meals and I can suggest from what you actually eat.',
      items: [], totals: { kcal: 0, protein: 0 },
    };
  }

  // Protein first when it is behind — it is the target members miss most and
  // the one that changes what to pick. Otherwise most-logged order.
  const ranked = [...usable].sort((a, b) => {
    if (proLeft != null && proLeft > 5) {
      const pa = a.per_100g.protein || 0, pb = b.per_100g.protein || 0;
      if ((pb >= PROTEIN_DENSE) !== (pa >= PROTEIN_DENSE)) return (pb >= PROTEIN_DENSE) ? 1 : -1;
    }
    return (b.count || 0) - (a.count || 0);
  });

  const items = [];
  let kcal = 0, protein = 0;
  const budget = kcalLeft != null ? kcalLeft : Infinity;
  for (const f of ranked) {
    if (items.length >= 3) break;
    const grams = Math.max(20, Math.round((f.last_g || 100) / 10) * 10);
    const m = macrosFor(f, grams);
    if (m.kcal <= 0) continue;
    if (kcal + m.kcal > budget) continue;                 // never blow the day's budget
    const helps = (proLeft != null && proLeft > 5) ? m.pro >= 4 : true;
    if (!helps && items.length) continue;
    items.push({ name: f.name, grams, kcal: m.kcal, protein: Math.round(m.pro) });
    kcal += m.kcal; protein += m.pro;
    if (proLeft != null && proLeft > 5 && protein >= proLeft) break;
    if (kcal >= budget * 0.8) break;
  }

  if (!items.length) {
    return {
      headline: `${kcalLeft} kcal left today.`,
      note: 'Nothing in your usual foods fits what is left — something light and high in protein.',
      items: [], totals: { kcal: 0, protein: 0 },
    };
  }

  const mealName = hour < 11 ? 'breakfast' : hour < 16 ? 'lunch' : hour < 21 ? 'dinner' : 'a late meal';
  const headline = (proLeft != null && proLeft > 5)
    ? `${proLeft} g protein left — best fit for ${mealName}`
    : `${kcalLeft} kcal left — an idea for ${mealName}`;

  return {
    headline,
    note: `${Math.round(kcal).toLocaleString('en-IN')} kcal · ${Math.round(protein)} g protein from what you usually eat.`,
    items,
    totals: { kcal: Math.round(kcal), protein: Math.round(protein) },
  };
}
