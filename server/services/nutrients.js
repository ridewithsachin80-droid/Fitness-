/**
 * services/nutrients.js — the shape of a food's nutrition, in one place.
 *
 * Every food in this app carries the same 39 fields whatever door it came in
 * through: typed into the AI chat, photographed, scanned from a barcode,
 * prescribed by a coach, or entered by hand in Admin. A member's iron total is
 * only meaningful if it is summed over foods that all agree on what "iron"
 * means.
 *
 * This existed TWICE — once in routes/aiChat.js and once in routes/aiFoods.js —
 * and the two had already drifted. Given identical input, one returned
 * net_carbs 1.4 and the other returned NaN, which reaches Postgres as null and
 * turns every downstream sum into NaN. Nothing failed loudly; the number was
 * just wrong for foods that happened to come in through the second door.
 *
 * One implementation. Any new nutrient is added here and every path gets it.
 */

// ── Nutrition normaliser — guarantees all 36 fields exist ────────────────────
function normaliseNutrients(raw = {}) {
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const fiber     = num(raw.fiber);
  const totalCarb = num(raw.total_carbs);
  const netRaw    = parseFloat(raw.net_carbs);
  return {
    calories:      num(raw.calories),
    protein:       num(raw.protein),
    total_carbs:   totalCarb,
    net_carbs:     Number.isFinite(netRaw) ? netRaw : Math.max(0, +(totalCarb - fiber).toFixed(1)),
    fat:           num(raw.fat),
    fiber,
    sugar:         num(raw.sugar),
    saturated_fat: num(raw.saturated_fat),
    trans_fat:     num(raw.trans_fat),
    cholesterol:   num(raw.cholesterol),
    omega3_ala:    num(raw.omega3_ala),
    omega3_epa:    num(raw.omega3_epa),
    omega3_dha:    num(raw.omega3_dha),
    omega6:        num(raw.omega6),
    omega9_mufa:   num(raw.omega9_mufa),
    vit_a: num(raw.vit_a), vit_b1: num(raw.vit_b1), vit_b2: num(raw.vit_b2),
    vit_b3: num(raw.vit_b3), vit_b5: num(raw.vit_b5), vit_b6: num(raw.vit_b6),
    vit_b12: num(raw.vit_b12), vit_c: num(raw.vit_c), vit_d: num(raw.vit_d),
    vit_e: num(raw.vit_e), vit_k: num(raw.vit_k),
    folate: num(raw.folate), biotin: num(raw.biotin), choline: num(raw.choline),
    calcium: num(raw.calcium), iron: num(raw.iron), magnesium: num(raw.magnesium),
    phosphorus: num(raw.phosphorus), potassium: num(raw.potassium),
    sodium: num(raw.sodium), zinc: num(raw.zinc), copper: num(raw.copper),
    manganese: num(raw.manganese), selenium: num(raw.selenium),

    // ── Fields routes/foods.js carried and the other two copies did not ──────
    // Three implementations existed. This one had 45 fields, the other two had
    // 39, and taking the smaller set as canonical would have quietly deleted
    // six nutrients from every food written through the admin editor. The
    // union is the contract; the intersection would have been a data loss.
    glycemic_index:  num(raw.glycemic_index),
    glycemic_load:   num(raw.glycemic_load),
    probiotic:       num(raw.probiotic),
    prebiotic_fiber: num(raw.prebiotic_fiber),
    lycopene:        num(raw.lycopene),
    beta_glucan:     num(raw.beta_glucan),
  };
}

module.exports = { normaliseNutrients };
