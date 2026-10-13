import { withFoodGrams } from './aiFoodReview';
import { portionFoodKey } from './householdPortions';

const list = value => Array.isArray(value) ? value : [];
export function usualSuggestions(presets, recent, labels, autoSlot) {
  const foods = items => list(items).filter(f => f?.name && Number(f.grams ?? f.last_g) > 0 && f.per_100g).map(f => {
    const own = list(labels).find(l => l.name && portionFoodKey(l.name) === portionFoodKey(f.name));
    return withFoodGrams({ ...f, per_100g:own?.per_100g || f.per_100g,
      label:!!(own || f.label), source:own || f.label ? 'member' : f.source || 'saved',
      meal:autoSlot, on:true, ai_grams:Number(f.grams ?? f.last_g) }, Number(f.grams ?? f.last_g));
  });
  const saved = list(presets).map(p => ({ key:`preset-${p.id}`, name:p.name, meal:p.meal,
    foods:foods(p.items), kind:'Saved meal' })).filter(p => p.foods.length);
  saved.sort((a,b) => Number(b.meal === autoSlot) - Number(a.meal === autoSlot));
  const singles = list(recent).map((f,i) => ({ key:`recent-${i}`, name:f.name,
    foods:foods([f]), kind:'Recent food' })).filter(p => p.foods.length);
  return [...saved, ...singles].slice(0, 12);
}

export function usualReview(suggestion, logDate) {
  return { role:'ai', text:`${suggestion.name}. Check the quantities and meal, then save.`,
    logDate, applied:false, usualKey:suggestion.key,
    parsed:{ foods:suggestion.foods.map(f => ({ ...f, on:true })), activities:[], acv:[],
      supplements:[], workouts:[], corrections:[], weight_kg:null, water_ml_add:null,
      weightOn:false, waterOn:false, sleep:null, sleepOn:false } };
}
