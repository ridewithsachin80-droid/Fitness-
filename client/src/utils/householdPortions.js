import { withFoodGrams } from './aiFoodReview';

// Keep preparation qualifiers: a bowl of raw rice is not a bowl of cooked rice.
export const portionFoodKey = name => String(name || '').toLowerCase().trim().replace(/\s+/g, ' ');
const UNITS = { pieces:'piece', slices:'slice', scoops:'scoop', eggs:'egg', idlis:'idli', rotis:'roti',
  chapatis:'chapati', dosas:'dosa', bowls:'bowl', cups:'cup', glasses:'glass', katoris:'katori',
  tablespoon:'tbsp', tablespoons:'tbsp', teaspoon:'tsp', teaspoons:'tsp' };
const UNIT = /\b(katoris?|bowls?|cups?|glass(?:es)?|pieces?|slices?|scoops?|tbsp|tablespoons?|tsp|teaspoons?|rotis?|chapatis?|idlis?|dosas?|eggs?)\b/i;
const positive = v => Number.isFinite(Number(v)) && Number(v) > 0;

export function statedPortion(food) {
  const text = String(food.qty_text || '').trim();
  const match = text.match(UNIT);
  if (!match) return null;
  const number = text.match(/^(\d+(?:\.\d+)?(?:\s*\/\s*\d+)?|[½¼¾])\s*/)?.[1];
  const fractions = { '½':0.5, '¼':0.25, '¾':0.75 };
  const quantity = number in fractions ? fractions[number] : number?.includes('/')
    ? Number(number.split('/')[0]) / Number(number.split('/')[1]) : Number(number);
  if (!positive(quantity) || quantity > 100 || !positive(food.grams)) return null;
  const unit = UNITS[match[1].toLowerCase()] || match[1].toLowerCase();
  return { unit, quantity, grams_per_unit: Number(food.grams) / quantity,
    phrase: `${unit} ${portionFoodKey(food.name)}`.slice(0, 80), basis:'estimate' };
}

export function portionOptions(food, memories = []) {
  const options = [];
  const stated = food.portion || statedPortion(food);
  if (stated && positive(stated.grams_per_unit)) options.push({ ...stated, key:'estimate', basis:'estimate' });
  for (const memory of memories) {
    const split = String(memory.phrase || '').indexOf(' ');
    const unit = memory.phrase?.slice(0, split);
    if (split < 1 || !UNIT.test(unit) || memory.phrase.slice(split + 1) !== portionFoodKey(food.name) || !positive(memory.grams)) continue;
    options.push({ unit, grams_per_unit:Number(memory.grams), phrase:memory.phrase, basis:'remembered', key:memory.phrase });
  }
  return options;
}

export function withPortion(food, portion, quantity = 1) {
  const grams = quantity === '' ? '' : Number(quantity) * Number(portion.grams_per_unit);
  // Reject oversized portions in review instead of silently reducing them.
  const next = withFoodGrams(food, grams);
  return { ...next, portion:{ ...portion, quantity },
    qty_text: quantity === '' ? '' : `${quantity} ${portion.unit}`, qty_description:'',
    portion_phrase:portion.phrase };
}

/** Learn the weight of ONE unit, not the total weight of two bowls. */
export function portionCorrections(foods = []) {
  return foods.filter(f => f.on && positive(f.grams) && Number(f.grams) <= 5000).flatMap(f => {
    if (f.portion) {
      return f.remember_portion && positive(f.portion.quantity)
        ? [{ phrase:f.portion.phrase, grams:Number(f.grams), quantity:Number(f.portion.quantity), replace:true }] : [];
    }
    const stated = statedPortion(f);
    return f.portion_phrase && Number(f.grams) !== Number(f.ai_grams)
      ? [{ phrase:f.portion_phrase, grams:Number(f.grams), quantity:stated?.quantity || 1 }] : [];
  });
}
