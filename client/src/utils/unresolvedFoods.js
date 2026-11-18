/** Quantity questions are separate from foods: they have no calories or save toggle. */
export function normalizeUnresolvedFoods(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const row of value) {
    if (!row || row.reason !== 'quantity_needed' || typeof row.name !== 'string') continue;
    const name = row.name.trim().slice(0, 100);
    const meal = typeof row.meal === 'string' ? row.meal.trim().slice(0, 40) || null : null;
    if (!name) continue;
    const key = `${name.toLowerCase()}\u0000${(meal || '').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ name, meal, reason: 'quantity_needed' });
    if (result.length === 10) break;
  }
  return result;
}

/** Only the latest unsaved reply may supply a portion question. An older
 * meal must not silently become the subject of a new conversation or day. */
export function foodClarificationContext(messages, day) {
  if (!Array.isArray(messages) || !day) return null;
  const latest = [...messages].reverse().find(message => message?.role === 'ai');
  if (!latest?.parsed || latest.applied || latest.undone || latest.logDate !== day) return null;
  const unresolved = normalizeUnresolvedFoods(latest.parsed.unresolved_foods)
    .map(({ name, meal }) => ({ name, meal }));
  if (!unresolved.length) return null;
  const reviewedFoods = (Array.isArray(latest.parsed.foods) ? latest.parsed.foods : [])
    .filter(food => food && typeof food.name === 'string' && food.name.trim()
      && (typeof food.grams === 'number' || typeof food.grams === 'string')
      && Number.isFinite(Number(food.grams)) && Number(food.grams) > 0 && Number(food.grams) <= 5000)
    .slice(0, 20)
    .map(food => ({ name: food.name.trim().slice(0, 100), grams: Number(food.grams),
      meal: typeof food.meal === 'string' ? food.meal.trim().slice(0, 40) || null : null }));
  return { unresolved, reviewedFoods };
}
