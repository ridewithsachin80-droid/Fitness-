import { useEffect, useState } from 'react';
import { Sheet, Pressable, Icon } from '../primitives';
import { haptic } from '../../store/settingsStore';
import { plannedRows, clock, itemKcal } from '../../lib/day';

/**
 * LogPlannedSheet — "Log as planned" for one prescribed meal (Phase 2).
 *
 * Every item starts ticked at the planned grams, so eating to plan is one tap
 * on the button. Ate less, or skipped something? Change the grams or untick
 * it first; the line above the button says exactly what differs from the plan.
 *
 * It writes ordinary food-log rows through the same `update('food', …)` every
 * other way of logging uses, so offline queueing, totals and the coach's view
 * need nothing new. Items already logged under this meal are never added twice.
 */
export default function LogPlannedSheet({ meal, onClose, m }) {
  const { log, update, terms } = m;
  const [choices, setChoices] = useState({});

  // Fresh choices each time a meal is opened: planned grams, everything ticked.
  useEffect(() => {
    if (!meal) return;
    const init = {};
    for (const it of meal.pending) init[it.name] = { on: true, grams: String(it.grams) };
    setChoices(init);
  }, [meal]);

  if (!meal) return <Sheet open={false} onClose={onClose} title="" />;

  const { rows, kcal, changes } = plannedRows(meal, choices, log.food);
  const set = (name, patch) => setChoices(c => ({ ...c, [name]: { ...c[name], ...patch } }));

  const save = () => {
    if (!rows.length) return;
    const stamp = Date.now();
    update('food', [...(log.food || []), ...rows.map((r, i) => ({ id: `plan-${stamp}-${i}`, ...r }))]);
    haptic(30);
    onClose();
  };

  return (
    <Sheet open onClose={onClose} eyebrow="Log as planned"
      title={`${meal.time ? `${clock(meal.time)} · ` : ''}${meal.meal}`}
      footer={
        <Pressable variant="primary" className="w-full" disabled={!rows.length} onPress={save} data-testid="planned-save">
          {rows.length ? `Log ${rows.length} ${rows.length === 1 ? 'item' : 'items'} · ${kcal.toLocaleString('en-IN')} ${terms?.kcal || 'kcal'}` : 'Nothing ticked'}
        </Pressable>
      }>
      <p className="text-caption text-mid mb-3">Change any amount if you ate more or less. Untick what you skipped.</p>

      <div className="space-y-2" data-testid="planned-items">
        {meal.pending.map(it => {
          const c = choices[it.name] || { on: true, grams: String(it.grams) };
          const changed = c.on && parseFloat(c.grams) !== Number(it.grams);
          return (
            <div key={it.name} className="flex items-center gap-3 rounded-2xl bg-charcoal px-3 py-2" style={{ minHeight: 56 }}>
              <label className="flex items-center gap-3 flex-1 min-w-0">
                <input type="checkbox" checked={c.on} onChange={e => set(it.name, { on: e.target.checked })}
                  className="w-6 h-6 accent-gold flex-shrink-0" aria-label={`${it.name}: eaten`} />
                <span className={`text-sm min-w-0 ${c.on ? 'text-white' : 'text-lo'}`}>
                  {it.name}
                  <span className={`block text-caption ${changed ? 'text-gold-light' : 'text-mid'}`}>
                    {!c.on ? 'skipped' : changed ? `planned ${Number(it.grams)} g` : `${itemKcal(it)} ${terms?.kcal || 'kcal'}`}
                  </span>
                </span>
              </label>
              <input type="number" inputMode="decimal" min="0" max="2000" value={c.grams} disabled={!c.on}
                onChange={e => set(it.name, { grams: e.target.value })} aria-label={`${it.name} grams`}
                style={{ minHeight: 44, width: 72 }}
                className={`text-right text-base font-semibold rounded-xl px-2.5 border bg-transparent text-white tabular-nums disabled:opacity-40 ${changed ? 'border-gold' : 'border-white/[0.12]'}`} />
              <span className="text-caption text-mid">g</span>
            </div>
          );
        })}
      </div>

      {changes.length > 0 && (
        <p className="text-caption text-mid mt-3 leading-relaxed" data-testid="planned-changes">
          <Icon name="info" size={12} className="inline-block mr-1 -mt-0.5" />
          Different from the plan: {changes.join(', ')}.
        </p>
      )}
    </Sheet>
  );
}
