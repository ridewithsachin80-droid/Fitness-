/**
 * components/food/useMemberLabels.js — the member's own food labels, for the
 * food log (10 Oct 2026). Loaded once; offered first in the food search; a
 * label saved from the macro editor joins the list at once, so the very next
 * search offers it without a reload.
 */
import { useCallback, useEffect, useState } from 'react';
import { getNutrition } from '../../constants';
import { getMyLabels } from '../../api/memberFoods';

export const labelKey = (n) => String(n || '').trim().replace(/\s+/g, ' ').toLowerCase();

/** A logged item's per-100 g data; foods logged before the food DB fall back to the static table. */
export function per100Of(item) {
  if (item.per_100g) return item.per_100g;
  const n = getNutrition(item.name, 100);
  return n ? { calories: n.cal, protein: n.pro, total_carbs: n.carb, fat: n.fat } : {};
}

export function useMemberLabels() {
  const [labels, setLabels] = useState([]);
  useEffect(() => {
    getMyLabels().then(({ data }) => setLabels(Array.isArray(data) ? data : [])).catch(() => {});
  }, []);

  const labelFor = useCallback((name) => labels.find(l => labelKey(l.name) === labelKey(name)) || null, [labels]);

  /** Search suggestions from the member's labels, in the shape the food search uses. */
  const labelMatches = useCallback((q) => {
    const k = labelKey(q);
    return labels.filter(l => labelKey(l.name).includes(k))
      .map(l => ({ id: `label-${l.id}`, name: l.name, per_100g: l.per_100g, label: true, base_food_id: l.base_food_id || null }));
  }, [labels]);

  const remember = useCallback((name, per_100g, base_food_id = null) => {
    setLabels(prev => [{ id: `local-${Date.now()}`, name, per_100g, base_food_id },
      ...prev.filter(l => labelKey(l.name) !== labelKey(name))]);
  }, []);

  return { labelFor, labelMatches, remember };
}
