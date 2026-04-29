/**
 * client/src/components/FoodLog.jsx
 * Sprint 1 — API-backed food search.
 *
 * Bug fixes (27 Apr 2026):
 *  - Debounce timer was not cancelled on suggestion click, causing it to fire
 *    300ms later and re-show old results over the weight/Add button (blocking add).
 *  - Dropdown was capturing all scroll events, blocking page scroll.
 *  - Outside-click handler was using inner wrapper ref, not the full container,
 *    so clicking a suggestion was falsely detected as "outside" and closed the
 *    dropdown before the onClick fired.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import api from '../api/client';
import { getNutrition } from '../constants';
import { getRecentFoods } from '../api/logs';

// Typical portion sizes for common Indian / portioned foods.
// Used to pre-fill grams when a food is selected for the first time.
const TYPICAL_GRAMS = {
  // Eggs / dairy
  egg: 55, 'boiled egg': 55, 'fried egg': 55, 'poached egg': 55,
  curd: 100, yogurt: 100, paneer: 100,
  // Bread / rotis
  chapati: 30, roti: 30, phulka: 25, paratha: 60, puri: 30,
  'bread slice': 25, 'brown bread': 25, idli: 40, dosa: 70, uttapam: 80,
  // Fruits (whole)
  banana: 120, apple: 150, orange: 130, mango: 200,
  // Nuts / seeds (small servings)
  almonds: 28, cashews: 28, walnuts: 28, peanuts: 28,
};

/** Return a smart default gram value for the given food name (lowercased search) */
function smartGrams(foodName) {
  const lc = (foodName || '').toLowerCase();
  for (const [key, g] of Object.entries(TYPICAL_GRAMS)) {
    if (lc.includes(key)) return g;
  }
  return null; // fall back to leaving the field empty
}



function calcMacros(item) {
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

export default function FoodLog({ items = [], onChange }) {
  const [showForm, setShowForm]   = useState(false);
  const [meal, setMeal]           = useState('Meal 1');
  const [query, setQuery]         = useState('');
  const [grams, setGrams]         = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected]   = useState(null);
  const [lookupStatus, setLookupStatus] = useState('');
  // Sprint 12: recent foods
  const [recentFoods, setRecentFoods] = useState([]);

  useEffect(() => {
    getRecentFoods()
      .then(({ data }) => setRecentFoods(data || []))
      .catch(() => {}); // silent fail — feature is optional
  }, []);

  const nameRef      = useRef(null);
  const gramsRef     = useRef(null);
  const debounceRef  = useRef(null);
  // FIX: ref for the FULL search container (input + dropdown together)
  // so the outside-click handler correctly detects clicks inside the dropdown
  const containerRef = useRef(null);

  // ── Search ──────────────────────────────────────────────────────────────────
  const searchFoods = useCallback(async (q) => {
    if (!q || q.length < 2) { setSuggestions([]); setShowSuggestions(false); return; }
    setSearching(true);
    try {
      const { data } = await api.get('/foods/search', { params: { q, limit: 8 } });
      setSuggestions(data);
      setShowSuggestions(true);
    } catch { setSuggestions([]); }
    finally { setSearching(false); }
  }, []);

  const handleQueryChange = (val) => {
    setQuery(val);
    setSelected(null);      // typing again clears previous selection
    setLookupStatus('');
    // FIX: always cancel previous debounce before starting a new one
    clearTimeout(debounceRef.current);
    if (val.length >= 2) {
      debounceRef.current = setTimeout(() => searchFoods(val), 300);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  };

  // ── Pick suggestion ─────────────────────────────────────────────────────────
  const pickSuggestion = (food) => {
    clearTimeout(debounceRef.current);

    setSelected(food);
    setQuery(food.name);
    setSuggestions([]);
    setShowSuggestions(false);
    setLookupStatus('');

    // Pre-fill a sensible gram default so the user just taps Add for portioned foods
    const defaultG = smartGrams(food.name);
    if (defaultG) setGrams(String(defaultG));

    setTimeout(() => gramsRef.current?.focus(), 50);
  };

  // ── Open Food Facts fallback ────────────────────────────────────────────────
  const lookupOff = async () => {
    if (!query.trim()) return;
    clearTimeout(debounceRef.current);
    setLookupStatus('loading');
    setSuggestions([]);
    setShowSuggestions(false);
    try {
      const { data } = await api.post('/foods/lookup', { name: query.trim() });
      setSelected(data);
      setQuery(data.name);
      setLookupStatus('found');
      setTimeout(() => gramsRef.current?.focus(), 50);
    } catch {
      setLookupStatus('notfound');
    }
  };

  // ── Add item ────────────────────────────────────────────────────────────────
  const add = () => {
    if (!query.trim() || !grams) return;
    const g = parseFloat(grams);
    if (isNaN(g) || g <= 0) return;

    onChange([...items, {
      id:       Date.now(),
      name:     selected?.name || query.trim(),
      grams:    g,
      meal,
      food_id:  selected?.id      || null,
      per_100g: selected?.per_100g || null,
    }]);

    setQuery(''); setGrams(''); setSelected(null);
    setLookupStatus(''); setSuggestions([]); setShowSuggestions(false);
    clearTimeout(debounceRef.current);
    nameRef.current?.focus();
  };

  const remove = (id) => onChange(items.filter((i) => i.id !== id));
  const byMeal = (m) => items.filter((i) => i.meal === m);

  function mealTotal(mealItems) {
    return mealItems.reduce((acc, item) => {
      const n = calcMacros(item);
      if (!n) return acc;
      return { cal: acc.cal+(n.cal||0), pro: acc.pro+(n.pro||0), carb: acc.carb+(n.carb||0), fat: acc.fat+(n.fat||0) };
    }, { cal:0, pro:0, carb:0, fat:0 });
  }

  // ── Outside-click closes dropdown ───────────────────────────────────────────
  // FIX: use containerRef (outer div containing input + dropdown) instead of
  // nameRef.current.parentElement (which only covered the input wrapper).
  // With the old code, clicking a suggestion was detected as "outside" and
  // closed the dropdown before the onClick fired.
  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, []);

  const closeForm = () => {
    clearTimeout(debounceRef.current);
    setShowForm(false); setQuery(''); setGrams(''); setSelected(null);
    setLookupStatus(''); setSuggestions([]); setShowSuggestions(false);
  };

  // Sprint 12: quick-add a recently used food — pre-fills name + grams
  const pickRecent = (food) => {
    setSelected({ id: food.food_id, name: food.name, per_100g: food.per_100g });
    setQuery(food.name);
    setGrams(String(food.last_g || 100));
    setSuggestions([]); setShowSuggestions(false); setLookupStatus('');
    setTimeout(() => gramsRef.current?.focus(), 50);
  };

  return (
    <div className="space-y-3">

      {/* Meal sections */}
      {MEALS.map((m) => {
        const mealItems = byMeal(m);
        const totals    = mealTotal(mealItems);
        return (
          <div key={m}>
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="text-xs font-bold text-stone-400 uppercase tracking-wider">{m}</span>
              {mealItems.length > 0 && (
                <>
                  <span className="text-xs text-stone-300">{mealItems.reduce((s,i)=>s+i.grams,0).toFixed(0)}g</span>
                  <span className="text-xs font-semibold text-orange-500">{totals.cal} kcal</span>
                  <span className="text-xs text-blue-400">P {totals.pro.toFixed(1)}g</span>
                  <span className="text-xs text-amber-400">C {totals.carb.toFixed(1)}g</span>
                  <span className="text-xs text-purple-400">F {totals.fat.toFixed(1)}g</span>
                </>
              )}
            </div>
            {mealItems.length === 0 ? (
              <p className="text-xs text-stone-300 italic px-2 py-1">Nothing logged yet</p>
            ) : (
              <div className="space-y-1">
                {mealItems.map((item) => {
                  const n = calcMacros(item);
                  return (
                    <div key={item.id} className="py-2 px-3 rounded-xl bg-stone-50 group">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-medium text-stone-700 truncate">{item.name}</span>
                          <span className="text-xs font-semibold text-emerald-600 flex-shrink-0">{item.grams}g</span>
                        </div>
                        <button onClick={() => remove(item.id)}
                          className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center
                            justify-center rounded-full text-stone-300 hover:text-red-400
                            hover:bg-red-50 transition-all flex-shrink-0 ml-2"
                          aria-label="Remove item">×</button>
                      </div>
                      {n && (
                        <div className="flex gap-3 mt-1">
                          <span className="text-xs font-bold text-orange-500">{n.cal} kcal</span>
                          <span className="text-xs text-blue-500">P {n.pro}g</span>
                          <span className="text-xs text-amber-500">C {n.carb}g</span>
                          <span className="text-xs text-purple-500">F {n.fat}g</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* Day total — shown when at least one item is logged across any meal */}
      {items.length > 0 && (() => {
        const dayTotal = items.reduce((acc, item) => {
          const n = calcMacros(item);
          if (!n) return acc;
          return { cal: acc.cal + (n.cal || 0), pro: acc.pro + (n.pro || 0), carb: acc.carb + (n.carb || 0), fat: acc.fat + (n.fat || 0) };
        }, { cal: 0, pro: 0, carb: 0, fat: 0 });
        return (
          <div className="flex items-center justify-between bg-stone-100 rounded-2xl px-4 py-2.5">
            <span className="text-xs font-bold text-stone-500 uppercase tracking-wider">Day total</span>
            <div className="flex gap-3">
              <span className="text-xs font-bold text-orange-500">{dayTotal.cal} kcal</span>
              <span className="text-xs text-blue-500">P {dayTotal.pro.toFixed(1)}g</span>
              <span className="text-xs text-amber-500">C {dayTotal.carb.toFixed(1)}g</span>
              <span className="text-xs text-purple-500">F {dayTotal.fat.toFixed(1)}g</span>
            </div>
          </div>
        );
      })()}

      {/* Add food form */}
      {!showForm ? (
        <button onClick={() => setShowForm(true)}
          className="w-full py-3 rounded-2xl border-2 border-dashed border-emerald-200
            text-emerald-600 text-sm font-semibold hover:bg-emerald-50 hover:border-emerald-300
            active:scale-98 transition-all">
          + Add food item
        </button>
      ) : (
        <div className="bg-stone-50 rounded-2xl p-3 space-y-3 border border-stone-100">

          {/* Meal selector */}
          <div className="flex gap-1.5">
            {MEALS.map((m) => (
              <button key={m} onClick={() => setMeal(m)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  meal === m ? 'bg-emerald-500 text-white shadow-sm' : 'bg-white text-stone-500 hover:bg-stone-100'
                }`}>{m}</button>
            ))}
          </div>

          {/* Sprint 12: Recently used quick-picks — show when query is empty */}
          {recentFoods.length > 0 && !query && (
            <div>
              <p className="text-xs text-stone-400 font-medium mb-1.5">Recently used</p>
              <div className="flex flex-wrap gap-1.5">
                {recentFoods.map((food, i) => {
                  const kcal = food.per_100g?.calories
                    ? Math.round(food.per_100g.calories * (food.last_g || 100) / 100)
                    : null;
                  return (
                    <button key={i} onClick={() => pickRecent(food)}
                      className="flex items-center gap-1.5 text-xs bg-white border border-stone-200
                        hover:border-emerald-300 hover:bg-emerald-50 rounded-xl px-2.5 py-1.5
                        transition-colors text-stone-700 font-medium max-w-full">
                      <span className="truncate max-w-[120px]">{food.name}</span>
                      <span className="text-stone-400 flex-shrink-0">{food.last_g}g</span>
                      {kcal && <span className="text-orange-500 font-bold flex-shrink-0">{kcal}k</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Food name + autocomplete
              FIX: containerRef on the outer div so clicks inside the dropdown
              are not detected as "outside" by the close handler */}
          <div ref={containerRef} className="relative">

            {/* Input row */}
            <div className="relative">
              <input
                ref={nameRef}
                value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
                onFocus={() => { if (suggestions.length > 0 && !selected) setShowSuggestions(true); }}
                placeholder="Food name…"
                className="w-full px-3 py-2.5 rounded-xl border border-stone-200 text-sm bg-white
                  focus:outline-none focus:ring-2 focus:ring-emerald-300 text-stone-800 font-medium pr-10"
                autoFocus
              />
              {searching && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <div className="w-4 h-4 border-2 border-emerald-300 border-t-emerald-600 rounded-full animate-spin" />
                </div>
              )}
              {selected && !searching && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 text-sm font-bold">✓</span>
              )}
            </div>

            {/* Suggestions dropdown
                FIX: overscroll-contain stops the dropdown from stealing page
                scroll events when it hits its own top/bottom boundary */}
            {showSuggestions && suggestions.length > 0 && (
              <div
                className="absolute left-0 right-0 top-full mt-1 bg-white rounded-xl shadow-lg
                  z-30 border border-stone-100 overflow-hidden"
                style={{ maxHeight: '240px', overflowY: 'auto', overscrollBehavior: 'contain' }}
              >
                {suggestions.map((food) => (
                  <button
                    key={food.id}
                    // FIX: prevent input blur so the click event can fire correctly
                    onMouseDown={(e) => e.preventDefault()}
                    onTouchStart={(e) => e.preventDefault()}
                    onClick={() => pickSuggestion(food)}
                    className="w-full text-left px-3 py-2.5 hover:bg-emerald-50 active:bg-emerald-100
                      transition-colors border-b border-stone-50 last:border-0"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-stone-700 font-medium truncate">{food.name}</span>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {food.verified && (
                          <span className="text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-semibold">✓</span>
                        )}
                        <span className="text-xs font-bold text-orange-500">
                          {food.per_100g?.calories || 0} kcal
                        </span>
                      </div>
                    </div>
                    {food.name_local && food.name_local !== food.name && (
                      <div className="text-xs text-stone-400 mt-0.5">{food.name_local}</div>
                    )}
                  </button>
                ))}

                {/* Search Open Food Facts option at bottom of list */}
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onTouchStart={(e) => e.preventDefault()}
                  onClick={() => { setShowSuggestions(false); lookupOff(); }}
                  className="w-full text-left px-3 py-2.5 bg-stone-50 hover:bg-blue-50
                    active:bg-blue-100 transition-colors border-t border-stone-100"
                >
                  <span className="text-xs text-blue-600 font-semibold">
                    🔍 Search Open Food Facts for "{query}"
                  </span>
                </button>
              </div>
            )}

            {/* No-results / lookup status */}
            {!searching && query.length >= 2 && suggestions.length === 0 && !showSuggestions && !selected && (
              <div className="mt-1.5">
                {lookupStatus === 'loading' && (
                  <p className="text-xs text-stone-400 px-1">Searching Open Food Facts…</p>
                )}
                {lookupStatus === 'notfound' && (
                  <p className="text-xs text-red-400 px-1">Not found — you can still add it manually</p>
                )}
                {lookupStatus === 'found' && (
                  <p className="text-xs text-emerald-600 px-1 font-semibold">✓ Found on Open Food Facts</p>
                )}
                {lookupStatus === '' && (
                  <button onClick={lookupOff}
                    className="text-xs text-blue-600 font-semibold px-1 hover:underline">
                    🔍 Not in local DB — search Open Food Facts
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Per-100g nutrition preview when a food is selected */}
          {selected?.per_100g && (
            <div className="bg-white rounded-xl px-3 py-2 border border-emerald-100">
              <p className="text-xs text-stone-400 mb-1">Per 100g — {selected.name}</p>
              <div className="flex gap-3 flex-wrap">
                <span className="text-xs font-bold text-orange-500">{selected.per_100g.calories || 0} kcal</span>
                <span className="text-xs text-blue-500">P {selected.per_100g.protein || 0}g</span>
                <span className="text-xs text-amber-500">
                  C {selected.per_100g.net_carbs ?? selected.per_100g.total_carbs ?? 0}g net
                </span>
                <span className="text-xs text-purple-500">F {selected.per_100g.fat || 0}g</span>
                {!selected.verified && <span className="text-xs text-stone-400 italic">unverified</span>}
              </div>
            </div>
          )}

          {/* Weight + Add + Close */}
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <input
                ref={gramsRef}
                type="number"
                inputMode="decimal"
                value={grams}
                onChange={(e) => setGrams(e.target.value)}
                placeholder="Raw weight"
                onKeyDown={(e) => e.key === 'Enter' && add()}
                className="w-full px-3 py-2.5 pr-8 rounded-xl border border-stone-200 text-sm bg-white
                  focus:outline-none focus:ring-2 focus:ring-emerald-300 text-stone-800"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-stone-400">g</span>
            </div>
            <button
              onClick={add}
              disabled={!query.trim() || !grams}
              className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40
                text-white text-sm font-bold rounded-xl transition-all active:scale-95">
              Add
            </button>
            <button
              onClick={closeForm}
              className="px-3 py-2.5 text-stone-400 hover:text-stone-600 text-lg leading-none"
              aria-label="Close">
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
