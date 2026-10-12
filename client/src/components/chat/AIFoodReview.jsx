import ChatFoodMacros from './ChatFoodMacros';
import { reviewTotals, foodReviewError } from '../../utils/aiFoodReview';

export default function AIFoodReview({ foods, disabled, mealSlots, autoSlot, onToggle, onGrams, onPatch, onMacros }) {
  const total = reviewTotals(foods);
  const error = foodReviewError(foods);
  return <div className="space-y-3" data-testid="ai-food-review">
    <p className="text-caption text-mid">AI estimates · check the portion, meal and nutrition before saving.</p>
    {foods.map((f, i) => <div key={i} className={'ai-food-review' + (!f.on ? ' excluded' : '')}>
      <label className="flex items-start gap-3 text-sm font-semibold">
        <input type="checkbox" checked={!!f.on} disabled={disabled} onChange={() => onToggle(i)}
          className="w-5 h-5 accent-gold mt-0.5" aria-label={'Include ' + f.name} />
        <span className="min-w-0">{f.name}<span className="block text-caption font-normal text-mid">{f.qty_text || 'Estimated portion'}</span></span>
      </label>
      <div className="ai-food-fields">
        <label>Quantity · grams<input type="number" min="0.1" max="5000" step="0.1" inputMode="decimal"
          value={f.grams} disabled={disabled} onChange={e => onGrams(i, e.target.value)} aria-label={f.name + ' grams'} /></label>
        <label>Meal<select value={mealSlots.includes(f.meal) ? f.meal : autoSlot} disabled={disabled}
          onChange={e => onPatch(i, { meal: e.target.value })} aria-label={f.name + ' meal'}>
          {[...new Set([...mealSlots, autoSlot].filter(Boolean))].map(slot => <option key={slot}>{slot}</option>)}
        </select></label>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-hair pt-2">
        <span className="text-caption text-mid">{f.label ? 'Your nutrition values' : 'Estimated nutrition'}
          {f.source === 'db-verified' && <span className="block text-gold">Verified food data</span>}</span>
        <ChatFoodMacros f={f} disabled={disabled} onSave={per => onMacros(i, per)} />
      </div>
      {f.warning && <p className="text-caption text-warn">{f.warning}</p>}
    </div>)}
    <div className="ai-food-total" aria-live="polite"><strong>{total.cal} kcal</strong><span>P {total.pro} g · C {total.carb} g · F {total.fat} g</span></div>
    {!disabled && error && <p className="text-caption text-danger" role="alert">{error}</p>}
  </div>;
}
