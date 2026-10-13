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
