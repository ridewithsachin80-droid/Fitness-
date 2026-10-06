/**
 * services/swaps.js — Phase 6: approved alternatives for foods in a plan.
 *
 * Sachin's rules (5 Oct 2026): the AI suggests alternatives and the coach
 * approves each one; the list is kept per member (by food name, so it carries
 * over when the plan is revised). A member can ask for one that is not on the
 * list; it waits for the coach like any other.
 *
 * A swap keeps the calories: the alternative's grams are worked out here so
 * that it carries the same kcal as the planned portion (to within rounding).
 */
const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
const str = (v, n) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, n);

/** Grams of the alternative that carry the same kcal as `grams` of the original. */
function swapGrams(grams, origPer100, altPer100) {
  const ok = Number(origPer100?.calories) || 0, ak = Number(altPer100?.calories) || 0;
  if (!(ok > 0) || !(ak > 0) || !(Number(grams) > 0)) return null;
  const g = (Number(grams) * ok) / ak;
  const r = g < 30 ? Math.round(g) : Math.round(g / 5) * 5;
  return Math.min(2000, Math.max(5, r));
}

function per100(e) {
  return { calories: num(e?.kcal_100g ?? e?.per_100g?.calories, 0, 900) ?? 0,
           protein: num(e?.protein_100g ?? e?.per_100g?.protein, 0, 100) ?? 0,
           total_carbs: num(e?.carbs_100g ?? e?.per_100g?.total_carbs, 0, 100) ?? 0,
           fat: num(e?.fat_100g ?? e?.per_100g?.fat, 0, 100) ?? 0 };
}

/** Distinct foods in a plan's week, with nutrition, for the AI to suggest against. */
function planFoods(days) {
  const map = new Map();
  (days || []).forEach(d => (d || []).forEach(m => (m.items || []).forEach(it => {
    const k = String(it.name || '').toLowerCase().trim();
    if (k && !map.has(k)) map.set(k, { name: String(it.name).trim(), meal: m.meal, per_100g: it.per_100g || {} });
  })));
  return [...map.values()];
}

function buildSuggestPrompt({ foods, avoid = [], title = '', brief = '' }) {
  const list = foods.slice(0, 40).map(f => {
    const p = f.per_100g || {};
    return `- ${f.name} (${f.meal}): ${Math.round(p.calories || 0)} kcal, P ${p.protein || 0} C ${p.total_carbs || 0} F ${p.fat || 0} per 100 g`;
  }).join('\n');
  return `You are helping a fitness coach in India give a member approved food swaps.
For each food below, suggest up to 3 alternatives the member could eat INSTEAD, that:
- do the same job in the meal (a protein for a protein, a fruit for a fruit, a grain for a grain);
- are close in protein, carbs and fat per calorie;
- are everyday foods easy to get in Karnataka, named as people say them (palak, ragi mudde, kadle);
- respect the plan: ${title ? `"${title}"; ` : ''}never suggest anything on the avoid list (${avoid.join(', ') || 'none'})${brief ? `; coach's brief: ${String(brief).slice(0, 400)}` : ''}.
Give per-100 g nutrition for each alternative AS EATEN. The coach approves each one; do not explain.

FOODS
${list}

Return ONLY this JSON:
{"swaps": [{"for": "<food name exactly as listed>", "options": [{"name": "<food>", "kcal_100g": 0, "protein_100g": 0, "carbs_100g": 0, "fat_100g": 0}]}]}`;
}

/** The model's answer, as rows to save. Only foods that are in the plan; no swap for itself; nothing to avoid. */
function normaliseSuggestions(raw, foods, avoid = []) {
  const names = new Map(foods.map(f => [f.name.toLowerCase(), f.name]));
  const bad = avoid.map(a => String(a).toLowerCase()).filter(Boolean);
  const out = [];
  for (const s of Array.isArray(raw?.swaps) ? raw.swaps : []) {
    const food = names.get(String(s?.for || '').toLowerCase().trim());
    if (!food) continue;
    for (const o of (Array.isArray(s.options) ? s.options : []).slice(0, 3)) {
      const name = str(o?.name, 100);
      const p = per100(o);
      if (!name || name.toLowerCase() === food.toLowerCase() || !(p.calories > 0)) continue;
      if (bad.some(b => name.toLowerCase().includes(b))) continue;
      out.push({ food_name: food, alt_name: name, alt_per_100g: p });
    }
  }
  return out;
}

module.exports = { swapGrams, per100, planFoods, buildSuggestPrompt, normaliseSuggestions };
