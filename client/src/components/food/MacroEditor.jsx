import { useState } from 'react';
import { Segmented, Pressable } from '../primitives';
import { labelFromEntry, withLabel, carbsOf } from '../../lib/day';
import { saveMyLabel, forgetMyLabel } from '../../api/memberFoods';
import { haptic } from '../../store/settingsStore';

/**
 * MacroEditor — "the pack says 24 g protein, not 13".
 *
 * Sachin, 10 Oct 2026: a member could change grams but never the food's
 * macros, so protein oats logged as plain oats. Here the member types protein,
 * carbs and fat — per 100 g as printed on the pack, or for the portion they
 * are logging — and calories follow (4 × protein + 4 × carbs + 9 × fat).
 *
 * "Use these every time" (on by default) saves the numbers as the member's own
 * label for this food name: the AI chat, plate photo and food search use it
 * next time, for this member only. The shared food table is never changed.
 *
 * Used inline in the food log and in a sheet from the AI chat preview.
 * onSave(per100g) receives the food's per-100 g data with the label applied.
 */
const r1 = (v) => String(Math.round((Number(v) || 0) * 10) / 10);

export default function MacroEditor({ name, grams, per100g, foodId = null, isLabel = false, onSave, onCancel }) {
  const g = Number(grams) || 0;
  const [mode, setMode] = useState('per100');
  const [val, setVal] = useState({
    protein: r1(per100g?.protein), carbs: r1(carbsOf(per100g)), fat: r1(per100g?.fat),
  });
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const res = labelFromEntry(val, { mode, grams: g });
  const set = (k) => (e) => { setVal(v => ({ ...v, [k]: e.target.value.replace(',', '.') })); setError(''); };

  // Switching between "per 100 g" and "this portion" converts what is typed,
  // so the member never has to redo the arithmetic.
  const switchMode = (next) => {
    if (next === mode || g <= 0) { setMode(next); return; }
    const f = next === 'portion' ? g / 100 : 100 / g;
    setVal(v => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x === '' ? '' : r1(Number(x) * f)])));
    setMode(next);
  };

  const save = async () => {
    if (!res.ok) { setError(res.error); return; }
    const next = withLabel(per100g, res.per100);
    if (remember) {
      setBusy(true);
      try {
        await saveMyLabel({ name, per_100g: next, food_id: foodId });
      } catch (e) {
        setBusy(false);
        setError(e?.response?.data?.error
          || "Couldn't save it for next time — check your connection, or untick “Use these every time” to change just this entry.");
        return;
      }
      setBusy(false);
    }
    haptic(20);
    onSave?.(next, { remembered: remember });
  };

  const forget = async () => {
    try {
      await forgetMyLabel(name);
      setNote(`Your label for ${name} is removed. This entry keeps these numbers until you change them.`);
    } catch {
      setError("Couldn't remove it — check your connection.");
    }
  };

  const portionKcal = res.ok ? Math.round(res.per100.calories * g / 100) : null;
  const field = (k, label) => (
    <label className="min-w-0">
      <span className="block text-eyebrow font-semibold uppercase tracking-widest text-lo mb-1">{label}</span>
      <span className="relative block">
        <input type="text" inputMode="decimal" value={val[k]} onChange={set(k)} data-testid={`macro-in-${k}`}
          className="w-full bg-charcoal border border-white/[0.14] rounded-xl pl-2.5 pr-6 py-2 text-sm text-white tabular-nums
            focus:outline-none focus:ring-2 focus:ring-gold/40" />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-caption text-ghost">g</span>
      </span>
    </label>
  );

  return (
    <div className="space-y-3" data-testid="macro-editor">
      <Segmented size="sm" value={mode} onChange={switchMode} name="Numbers for"
        options={[{ id: 'per100', label: 'Per 100 g (pack)' }, { id: 'portion', label: `For ${g} g` }]} />

      <div className="grid grid-cols-3 gap-2">
        {field('protein', 'Protein')}
        {field('carbs', 'Carbs')}
        {field('fat', 'Fat')}
      </div>

      {/* Calories follow the macros, live. */}
      <div className="rounded-xl bg-gold/[0.07] border border-gold/20 px-3 py-2" data-testid="macro-kcal">
        {res.ok ? (
          <>
            <p className="text-sm text-white tabular-nums flex flex-wrap gap-x-3">
              <span className="whitespace-nowrap"><span className="font-display font-semibold text-base">{res.per100.calories}</span><span className="text-lo"> kcal per 100 g</span></span>
              <span className="whitespace-nowrap"><span className="font-display font-semibold text-base">{portionKcal}</span><span className="text-lo"> kcal for your {g} g</span></span>
            </p>
            <p className="text-caption text-lo mt-0.5">Worked out as 4 × protein + 4 × carbs + 9 × fat. A pack’s own kcal can differ by a few.</p>
          </>
        ) : (
          <p className="text-caption text-amber-300" data-testid="macro-error-live">{res.error}</p>
        )}
      </div>

      <label className="flex items-start gap-2.5 cursor-pointer" style={{ minHeight: 32 }}>
        <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} data-testid="macro-remember"
          className="mt-0.5 w-4 h-4 accent-gold flex-shrink-0" />
        <span className="text-note text-mid leading-snug">
          Use these every time I log <span className="text-white font-semibold">{name}</span>
          <span className="block text-caption text-lo">Only for you — your coach can see your labels.</span>
        </span>
      </label>

      {error && <p className="text-caption text-red-300 leading-snug" data-testid="macro-error">{error}</p>}
      {note && <p className="text-caption text-gold-light leading-snug" data-testid="macro-note">{note}</p>}

      <div className="flex gap-2">
        <Pressable variant="primary" className="flex-1" onPress={save} disabled={busy} data-testid="macro-save">
          {busy ? 'Saving…' : 'Save'}
        </Pressable>
        <Pressable variant="secondary" onPress={onCancel} data-testid="macro-cancel">Cancel</Pressable>
      </div>
      {isLabel && !note && (
        <button type="button" onClick={forget} data-testid="macro-forget" style={{ minHeight: 32 }}
          className="text-caption text-lo underline underline-offset-2">
          Stop using my label for {name}
        </button>
      )}
    </div>
  );
}
