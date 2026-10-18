/** Source labels describe the nutrition data, never the accuracy of a photo. */
export function foodSource(food = {}) {
  if (food.label || food.source === 'member') return 'Your nutrition label';
  if (food.source === 'db-verified') return 'Verified food database';
  if (['db', 'database', 'db-unverified'].includes(food.source)) return 'Food database';
  if (['ai', 'ai-estimate', 'photo'].includes(food.source)) return 'AI estimate';
  if (food.source === 'plan') return 'From your plan';
  if (food.source === 'saved') return 'Saved nutrition';
  return 'Nutrition source not recorded';
}

/**
 * Raw or cooked: what a food's nutrition numbers are for (18 Oct 2026).
 *  1. The record's own marker first — `preparation` or `basis` on the food or
 *     its per_100g ("raw"/"uncooked" or "cooked"/"prepared"). Since Fixes-2h the
 *     foods table and member labels store `preparation`, and each logged item,
 *     saved meal and plan item carries a copy; foods nobody has marked stay null.
 *  2. Otherwise explicit words in the name (cooked, steamed, tadka… / raw, uncooked).
 *  3. Record and name disagree, or nothing says → unknown: the member is asked to check.
 * The preparation label and the weighing hint both read this, so they never differ.
 */
const RAW_WORDS = /\b(raw|uncooked)\b/i;
const COOKED_WORDS = /\b(cooked|boiled|steamed|fried|roasted|grilled|baked|tadka|curry|gravy|sabzi)\b/i;
const markerBasis = (v) => {
  const t = String(v ?? '').trim().toLowerCase();
  return /^(raw|uncooked)$/.test(t) ? 'raw' : /^(cooked|prepared)$/.test(t) ? 'cooked' : null;
};
export function preparationBasis(food = {}) {
  const f = typeof food === 'string' ? { name: food } : (food || {});
  const record = markerBasis(f.preparation ?? f.basis ?? f.per_100g?.preparation ?? f.per_100g?.basis);
  const n = String(f.name || '');
  const byName = RAW_WORDS.test(n) ? 'raw' : COOKED_WORDS.test(n) ? 'cooked' : null;
  if (record && byName && record !== byName) return { basis: null, from: 'conflict', record, name: byName };
  if (record) return { basis: record, from: 'record' };
  if (byName) return { basis: byName, from: 'name' };
  return { basis: null, from: null };
}
/** 'raw' | 'cooked' | null — a name or a food. */
export const weighingBasis = (food) => preparationBasis(food).basis;

export function preparationLabel(food = {}) {
  const p = preparationBasis(food);
  if (p.from === 'conflict') return 'Check: raw or cooked?';
  return p.basis === 'raw' ? 'Raw weight' : p.basis === 'cooked' ? 'Cooked weight' : 'Preparation not specified';
}
