import { normalizeUnresolvedFoods } from '../../utils/unresolvedFoods';

const foodKey = food => `${String(food.name || '').trim().toLowerCase()}\u0000${String(food.meal || '').trim().toLowerCase()}`;

/** Quantity questions stay separate from selectable foods and their totals.
 * An overlapping row is uncertain, not proof that the food was omitted. */
export default function UnresolvedFoods({ foods, reviewedFoods }) {
  const pending = normalizeUnresolvedFoods(foods);
  if (!pending.length) return null;
  const includedNames = new Set((Array.isArray(reviewedFoods) ? reviewedFoods : [])
    .filter(food => food && typeof food.name === 'string'
      && (typeof food.grams === 'number' || typeof food.grams === 'string')
      && Number.isFinite(Number(food.grams)) && Number(food.grams) > 0 && Number(food.grams) <= 5000)
    .map(foodKey));
  const unclear = pending.filter(food => includedNames.has(foodKey(food)));
  const missing = pending.filter(food => !includedNames.has(foodKey(food)));
  return <div data-testid="ai-unresolved-foods" role="status" className="text-caption text-warn mt-2 leading-relaxed break-words space-y-1">
    {missing.length > 0 && <p>
      Not included yet: {missing.map(food => food.name).join(', ')} — tell me the amount{missing.length > 1 ? ' for each' : ''}.
    </p>}
    {unclear.length > 0 && <p>
      Amount unclear: {unclear.map(food => food.name).join(', ')} — confirm how much to include.
    </p>}
  </div>;
}
