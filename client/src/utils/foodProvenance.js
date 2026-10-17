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

export function preparationLabel(food = {}) {
  if (/\braw\b/i.test(food.name || '')) return 'Raw weight';
  if (/\bcooked\b/i.test(food.name || '')) return 'Cooked weight';
  return 'Preparation not specified';
}

/**
 * Raw or cooked: what the food's nutrition numbers are for, read from its name
 * (17 Oct 2026). The food sheet used to tell everyone "Enter weight before
 * cooking", which is wrong for the many foods whose numbers are for the cooked
 * dish (cooked rice, dal tadka, steamed idli). Only explicit words count; when
 * the name does not say, the answer is null and the member is asked to check.
 */
export function weighingBasis(name = '') {
  const n = String(name || '');
  if (/\b(raw|uncooked)\b/i.test(n)) return 'raw';
  if (/\b(cooked|boiled|steamed|fried|roasted|grilled|baked|tadka|curry|gravy|sabzi)\b/i.test(n)) return 'cooked';
  return null;
}
