import { useEffect, useState } from 'react';
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
 */
export default function MealIdeaSheet({ open, onClose, m }) {
  const { log, update, kcalIn, kcalTarget, proteinIn, proteinTarget, terms } = m;
  const [foods, setFoods] = useState(null);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    if (!open || foods !== null) return;
    getRecentFoods()
      .then(({ data }) => setFoods(Array.isArray(data) ? data : []))
      .catch(() => setFoods([]));
  }, [open, foods]);

  useEffect(() => { if (open) setAdded(false); }, [open]);

  const idea = foods === null ? null : suggestMeal({
    kcalIn, kcalTarget, proteinIn, proteinTarget, foods, hour: istHour(),
  });

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
    <Sheet open={open} onClose={onClose} eyebrow="Meal idea" title={idea?.headline || 'What is left today'}
      footer={idea?.items?.length ? (
        <div className="flex gap-2">
          <Pressable variant="primary" className="flex-1" onPress={added ? onClose : addAll} data-testid="idea-add">
            {added ? 'Added ✓ Done' : 'Add to today'}
          </Pressable>
          <Pressable variant="secondary" onPress={onClose}>Not now</Pressable>
        </div>
      ) : <Pressable variant="primary" className="w-full" onPress={onClose}>Done</Pressable>}>

      {foods === null && <SkeletonText lines={3} />}

      {idea && (
        <div data-testid="meal-idea">
          {idea.note && <p className="text-body-sm text-mid leading-relaxed mb-3">{idea.note}</p>}

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
            <EmptyState compact icon="check" title={idea.headline} body={idea.note || ''} />
          )}
        </div>
      )}
    </Sheet>
  );
}
