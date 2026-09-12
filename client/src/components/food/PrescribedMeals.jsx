/**
 * components/food/PrescribedMeals.jsx — the coach's prescribed meal items inside the food log.
 * Moved out of components/FoodLog.jsx verbatim (Sprint 12c). Behaviour unchanged.
 */
import { useState, useEffect } from 'react';
import api from '../../api/client';
import { plural } from '../../constants';
import { haptic } from '../../store/settingsStore';
import { calcMacros } from './macros';
import { PortionPicker, smartGrams } from './portions.jsx';

export function PrescribedMeals({ items, onChange }) {
  const [plans, setPlans] = useState([]);
  const [consumed, setConsumed] = useState({});   // `${meal}|${name}` -> grams string
  const [collapsed, setCollapsed] = useState({});

  useEffect(() => {
    api.get('/members/me/meal-plan').then(({ data }) => {
      setPlans(data.meals || []);
      const init = {};
      for (const m of (data.meals || [])) {
        for (const it of (m.items || [])) init[`${m.meal}|${it.name}`] = String(it.grams);
      }
      setConsumed(init);
    }).catch(() => {});
  }, []);

  if (!plans.length) return null;

  const loggedNames = (meal) => new Set(
    (items || []).filter(f => f.meal === meal).map(f => String(f.name).toLowerCase()));

  const logMeal = (plan) => {
    const already = loggedNames(plan.meal);
    const toAdd = plan.items
      .filter(it => !already.has(it.name.toLowerCase()))
      .map(it => {
        const g = parseFloat(consumed[`${plan.meal}|${it.name}`]);
        if (!Number.isFinite(g) || g <= 0) return null;
        return {
          id: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: it.name,
          grams: Math.min(2000, g),
          meal: plan.meal,
          food_id: null,
          per_100g: it.per_100g,
        };
      }).filter(Boolean);
    if (!toAdd.length) return;
    onChange([...(items || []), ...toAdd]);
    haptic(30);
  };

  return (
    <div className="mb-3 space-y-2">
      {plans.map(plan => {
        const already = loggedNames(plan.meal);
        const pending = plan.items.filter(it => !already.has(it.name.toLowerCase()));
        const allDone = pending.length === 0;
        const planKcal = Math.round(plan.items.reduce((a, it) =>
          a + ((it.per_100g?.calories || 0) * it.grams / 100), 0));
        const isCollapsed = collapsed[plan.meal] ?? allDone;
        return (
          <div key={plan.meal}
            className={`rounded-2xl border px-3 py-2.5 ${
              allDone ? 'border-hair bg-white/[0.02]'
                      : 'border-gold/30 bg-gold/5'}`}>
            <button className="w-full flex items-center justify-between"
              onClick={() => setCollapsed(c => ({ ...c, [plan.meal]: !isCollapsed }))}>
              <span className="text-xs font-bold text-gold-light">
                🍽️ Coach's {plan.meal} plan {allDone && '· done ✓'}
              </span>
              <span className="text-eyebrow text-mute">~{planKcal} kcal {isCollapsed ? '▾' : '▴'}</span>
            </button>

            {!isCollapsed && (
              <>
                <div className="mt-2 space-y-1.5">
                  {plan.items.map(it => {
                    const done = already.has(it.name.toLowerCase());
                    const key = `${plan.meal}|${it.name}`;
                    return (
                      <div key={it.name} className="flex items-center gap-2">
                        <span className={`flex-1 text-xs truncate ${done ? 'text-faint line-through' : 'text-white'}`}>
                          {it.name}
                          <span className="text-mute"> · plan {it.qty_text}</span>
                        </span>
                        {done ? (
                          <span className="text-eyebrow text-gold-light font-bold">logged ✓</span>
                        ) : (
                          <>
                            <input type="number" inputMode="decimal" min="0" max="2000"
                              value={consumed[key] ?? ''}
                              onChange={e => setConsumed(c => ({ ...c, [key]: e.target.value }))}
                              className="w-16 text-right text-xs bg-charcoal border border-white/[0.12] rounded-lg px-2 py-1 text-white" />
                            <span className="text-eyebrow text-mute w-4">g</span>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
                {!allDone && (
                  <button onClick={() => logMeal(plan)}
                    style={{ minHeight: 40 }}
                    className="mt-2.5 w-full rounded-full bg-gold text-charcoal text-xs font-bold active:scale-[0.98] transition-transform">
                    Log {pending.length === plan.items.length ? 'this meal' : `${pending.length} remaining ${plural(pending.length, 'item')}`} as entered
                  </button>
                )}
                <p className="mt-1.5 text-eyebrow text-faint text-center">
                  Ate more or less? Change the grams before logging — honesty beats neatness.
                </p>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

