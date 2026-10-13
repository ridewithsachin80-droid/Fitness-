import { useState } from 'react';
import { portionOptions, statedPortion, withPortion } from '../../utils/householdPortions';
import { preparationLabel } from '../../utils/foodProvenance';

export default function HouseholdPortion({ food, memories, disabled, onPatch, onForget }) {
  const [forgetting, setForgetting] = useState(false);
  const [error, setError] = useState('');
  const options = portionOptions(food, memories);
  const p = food.portion;
  const selected = p ? (p.basis === 'remembered' ? p.phrase : 'estimate') : '';
  const forget = async () => {
    if (forgetting) return;
    setForgetting(true); setError('');
    try { await onForget(p.phrase); onPatch({ portion:{ ...p, basis:'estimate' }, remember_portion:false }); }
    catch { setError('Couldn’t forget this portion. Try again.'); }
    finally { setForgetting(false); }
  };
  return <details className="portion-details" data-testid="household-portion">
    <summary>Household portions <span>{preparationLabel(food)}</span></summary>
    {options.length ? <>
      <label className="portion-field">Unit<select aria-label={`${food.name} portion unit`} disabled={disabled || forgetting}
        value={selected} onChange={e => {
          const option = options.find(o => o.key === e.target.value);
          if (!option) { onPatch({ portion:null, portion_phrase:null, qty_text:'', remember_portion:false }); return; }
          const count = p?.quantity || statedPortion(food)?.quantity || option.quantity || 1;
          onPatch(withPortion(food, option, count));
        }}><option value="">Grams</option>{options.map(o => <option key={o.key} value={o.key}>
          {o.unit} · {+Number(o.grams_per_unit).toFixed(1)} g ({o.basis === 'remembered' ? 'your portion' : 'estimate'})
        </option>)}</select></label>
      {p && <>
        <div className="ai-food-fields">
          <label>Number of {p.unit}<input aria-label={`${food.name} portion count`} type="number" min="0.1" max="100"
            step="0.1" inputMode="decimal" disabled={disabled || forgetting} value={p.quantity}
            onChange={e => onPatch(withPortion(food, p, e.target.value))} /></label>
          <label>Grams per {p.unit}<input aria-label={`${food.name} grams per portion`} type="number" min="0.1" max="5000"
            step="0.1" inputMode="decimal" disabled={disabled || forgetting} value={p.grams_per_unit}
            onChange={e => onPatch(withPortion(food, { ...p, grams_per_unit:e.target.value, basis:'estimate' }, p.quantity))} /></label>
        </div>
        <p className="text-caption text-mid" aria-live="polite">{p.quantity || '—'} × {p.grams_per_unit || '—'} g = {food.grams || '—'} g</p>
        {!disabled && <label className="portion-remember"><input type="checkbox" checked={!!food.remember_portion}
          disabled={forgetting} onChange={e => onPatch({ remember_portion:e.target.checked })} /> Remember this portion when I save</label>}
        {p.basis === 'remembered' && !disabled && <button type="button" className="portion-forget" disabled={forgetting}
          onClick={forget}>{forgetting ? 'Forgetting…' : 'Forget my saved portion'}</button>}
      </>}
    </> : <p className="text-caption text-mid">No household measure was supplied for this food. Use grams above.</p>}
    <p className="text-caption text-mid">Use the same raw or cooked state as the nutrition values. A photo can’t measure hidden oil or sauces.</p>
    {error && <p role="alert" className="text-caption text-danger">{error}</p>}
  </details>;
}
