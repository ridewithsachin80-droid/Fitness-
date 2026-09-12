/**
 * components/food/macros.js — per-item macros (per-100g first, static table as fallback).
 * Moved out of components/FoodLog.jsx verbatim (Sprint 12c). Behaviour unchanged.
 */
import { getNutrition } from '../../constants';

export function calcMacros(item) {
  if (item.per_100g) {
    const f = item.grams / 100;
    const n = item.per_100g;
    return {
      cal:  Math.round((n.calories || 0) * f),
      pro:  +((n.protein    || 0) * f).toFixed(1),
      carb: +((n.net_carbs != null ? n.net_carbs : n.total_carbs || 0) * f).toFixed(1),
      fat:  +((n.fat        || 0) * f).toFixed(1),
    };
  }
  return getNutrition(item.name, item.grams);
}


// ── Barcode scanner ──────────────────────────────────────────────────────────
// Native BarcodeDetector (Chrome/Android — the member base). No library, no
// bundle weight. Browsers without it simply never see the button. A hit goes
// through the existing /foods/lookup → Open Food Facts pipeline, which also
// caches the product into the foods table for next time.

