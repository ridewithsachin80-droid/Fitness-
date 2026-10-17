import { useCallback, useEffect, useState } from 'react';
import { Sheet, Pressable, Eyebrow, Icon, EmptyState, SkeletonText } from '../primitives';
import { getRecentFoods } from '../../api/logs';
import { suggestMeal, istHour } from '../../lib/day';

/**
 * MealIdeaSheet — "what should I eat now?" (Sprint 11).
 *
 * Works out what is left of today's calorie and protein targets and fills it
 * from the member's own most-logged foods, at the gram amounts they normally
 * use. Everything is checkable: the numbers come from their food history, not
 * from a model, so they can see why paneer 150 g is being suggested.
 *
 * "Add to today" writes the items straight into the day's food log through
 * the same `update('food', …)` path every other screen uses.
 *
 * 17 Oct 2026: one explicit screen per situation (data-state on the body):
 *   no-targets · loading · error (with Retry) · message (on target, over,
 *   no usable history…) · suggestion. Before, a member without targets saw a
 *   heading and "Done" only, and a failed request looked like "no history".
 */
export default function MealIdeaSheet({ open, onClose, m }) {
  const { log, update, kcalIn, kcalTarget, proteinIn, proteinTarget, terms } = m;
  const [foods, setFoods] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [added, setAdded] = useState(false);
  // No invented targets: without a calorie or protein target there is no gap to fill.
  const hasTargets = Number(kcalTarget) > 0 || Number(proteinTarget) > 0;

  const load = useCallback(() => {
    setLoadError(false); setFoods(null);
    getRecentFoods()
      .then(({ data }) => setFoods(Array.isArray(data) ? data : []))
      .catch(() => setLoadError(true)); // a failed request is NOT an empty history
  }, []);
  useEffect(() => {
    if (!open || !hasTargets || foods !== null || loadError) return;
    load();
  }, [open, hasTargets, foods, loadError, load]);

  useEffect(() => { if (open) setAdded(false); }, [open]);

  const idea = !hasTargets || foods === null ? null : suggestMeal({
    kcalIn, kcalTarget, proteinIn, proteinTarget, foods, hour: istHour(),
  });
  const state = !hasTargets ? 'no-targets' : loadError ? 'error' : foods === null ? 'loading' : idea?.items?.length ? 'suggestion' : 'message';

  const addAll = () => {
    if (!idea?.items?.length) return;
    const rows = idea.items.map(it => {
      const src = foods.find(f => f.name === it.name);
      return { name: it.name, grams: it.grams, per_100g: src?.per_100g || null, food_id: src?.food_id ?? null };
    });
    update('food', [...(log.food || []), ...rows]);
    setAdded(true);
  };

  return (
    <Sheet open={open} onClose={onClose} eyebrow="Meal idea" title={idea?.headline || 'Meal ideas'}
      footer={idea?.items?.length ? (
        <div className="flex gap-2">
          <Pressable variant="primary" className="flex-1" onPress={added ? onClose : addAll} data-testid="idea-add">
            {added ? 'Added ✓ Done' : 'Add to today'}
          </Pressable>
          <Pressable variant="secondary" onPress={onClose}>Not now</Pressable>
        </div>
      ) : <Pressable variant="primary" className="w-full" onPress={onClose}>Done</Pressable>}>

      <div data-testid="meal-idea-body" data-state={state} data-reason={idea?.reason || ''}>
      {state === 'no-targets' && (
        <EmptyState compact icon="calendar" title="Your nutrition targets aren’t set yet."
          body="You can still log meals. Once your coach sets your calories or protein, ideas will show here." />
      )}

      {state === 'loading' && <SkeletonText lines={3} />}

      {state === 'error' && (
        <div role="alert" className="py-2">
          <p className="text-body-sm text-white font-semibold">Couldn’t load your recent foods.</p>
          <p className="text-caption text-mid mt-1 mb-3">Check your connection and try again. Nothing was changed.</p>
          <Pressable variant="secondary" onPress={load} data-testid="idea-retry">Try again</Pressable>
        </div>
      )}

      {idea && (
        <div data-testid="meal-idea">
          {idea.items.length > 0 && idea.note && <p className="text-body-sm text-mid leading-relaxed mb-3">{idea.note}</p>}

          {idea.items.length > 0 ? (
            <>
              <Eyebrow className="mb-2">From what you usually eat</Eyebrow>
              {idea.items.map((it, i) => (
                <div key={i} data-testid="idea-item" className="flex items-center gap-3 py-2.5 border-b border-hair last:border-b-0">
                  <span className="w-8 h-8 rounded-full bg-gold/[0.12] text-gold flex items-center justify-center flex-shrink-0"><Icon name="food" size={15} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-white truncate">{it.name}</span>
                    <span className="block text-caption text-mid tabular-nums">{it.grams} g · {it.protein} g protein</span>
                  </span>
                  <span className="text-sm font-display font-semibold tabular-nums text-white flex-shrink-0">{it.kcal} {terms.kcal}</span>
                </div>
              ))}
              <p className="text-caption text-lo mt-3">
                Amounts are the ones you normally log. Adjust them in the food log after adding.
              </p>
            </>
          ) : (
            <EmptyState compact icon={idea.reason === 'no-history' ? 'food' : 'check'} body={idea.note || ''}
              title={{ 'no-history': 'No usual foods yet', 'no-fit': 'Nothing you usually eat fits', over: 'Over for today', 'on-target': 'You’re on target' }[idea.reason] || 'Nothing to add right now'} />
          )}
        </div>
      )}
      </div>
    </Sheet>
  );
}
