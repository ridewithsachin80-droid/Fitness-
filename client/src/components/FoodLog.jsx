import { useState, useRef, useEffect } from 'react';
import { FOOD_PRESETS, getNutrition } from '../constants';

const MEALS = ['Meal 1', 'Meal 2', 'Meal 3'];

export default function FoodLog({ items = [], onChange }) {
  const [showForm, setShowForm]   = useState(false);
  const [meal, setMeal]           = useState('Meal 1');
  const [name, setName]           = useState('');
  const [grams, setGrams]         = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const nameRef = useRef(null);

  const suggestions = name.length > 0
    ? FOOD_PRESETS.filter((f) => f.toLowerCase().includes(name.toLowerCase())).slice(0, 6)
    : [];

  const add = () => {
    if (!name.trim() || !grams) return;
    onChange([
      ...items,
      { id: Date.now(), name: name.trim(), grams: parseFloat(grams), meal },
    ]);
    setName('');
    setGrams('');
    setShowSuggestions(false);
    // Keep form open for rapid entry
    nameRef.current?.focus();
  };

  const remove = (id) => onChange(items.filter((i) => i.id !== id));

  const byMeal = (m) => items.filter((i) => i.meal === m);

  // Close suggestions on outside click
  useEffect(() => {
    const handler = (e) => {
      if (!nameRef.current?.parentElement?.contains(e.target)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="space-y-3">

      {/* Meal sections */}
      {MEALS.map((m) => {
        const mealItems = byMeal(m);
        return (
          <div key={m}>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-bold text-stone-400 uppercase tracking-wider">{m}</span>
              {mealItems.length > 0 && (
                <>
                  <span className="text-xs text-stone-300">
                    {mealItems.reduce((sum, i) => sum + i.grams, 0).toFixed(0)}g
                  </span>
                  <span className="text-xs font-semibold text-orange-500">
                    {mealItems.reduce((sum, i) => sum + (getNutrition(i.name, i.grams)?.cal || 0), 0)} kcal
                  </span>
                </>
              )}
            </div>

            {mealItems.length === 0 ? (
              <p className="text-xs text-stone-300 italic px-2 py-1">Nothing logged yet</p>
            ) : (
              <div className="space-y-1">
                {mealItems.map((item) => {
                  const n = getNutrition(item.name, item.grams);
                  return (
                  <div
                    key={item.id}
                    className="py-2 px-3 rounded-xl bg-stone-50 group"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium text-stone-700 truncate">{item.name}</span>
                        <span className="text-xs font-semibold text-emerald-600 flex-shrink-0">
                          {item.grams}g
                        </span>
                      </div>
                      <button
                        onClick={() => remove(item.id)}
                        className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center
                          justify-center rounded-full text-stone-300 hover:text-red-400
                          hover:bg-red-50 transition-all flex-shrink-0 ml-2"
                        aria-label="Remove item"
                      >
                        ×
                      </button>
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

      {/* Add food form */}
      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="w-full py-3 rounded-2xl border-2 border-dashed border-emerald-200
            text-emerald-600 text-sm font-semibold hover:bg-emerald-50 hover:border-emerald-300
            active:scale-98 transition-all"
        >
          + Add food item
        </button>
      ) : (
        <div className="bg-stone-50 rounded-2xl p-3 space-y-3 border border-stone-100">

          {/* Meal selector */}
          <div className="flex gap-1.5">
            {MEALS.map((m) => (
              <button
                key={m}
                onClick={() => setMeal(m)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  meal === m
                    ? 'bg-emerald-500 text-white shadow-sm'
                    : 'bg-white text-stone-500 hover:bg-stone-100'
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          {/* Food name with autocomplete */}
          <div className="relative">
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => { setName(e.target.value); setShowSuggestions(true); }}
              onFocus={() => name.length > 0 && setShowSuggestions(true)}
              placeholder="Food name…"
              className="w-full px-3 py-2.5 rounded-xl border border-stone-200 text-sm bg-white
                focus:outline-none focus:ring-2 focus:ring-emerald-300 text-stone-800 font-medium"
              autoFocus
            />
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-white rounded-xl shadow-float
                z-20 border border-stone-100 overflow-hidden">
                {suggestions.map((f) => (
                  <button
                    key={f}
                    onMouseDown={(e) => e.preventDefault()} // prevent blur before click
                    onClick={() => { setName(f); setShowSuggestions(false); }}
                    className="w-full text-left px-3 py-2.5 text-sm hover:bg-emerald-50
                      text-stone-700 hover:text-emerald-700 transition-colors"
                  >
                    {f}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Grams + action */}
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <input
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
              disabled={!name.trim() || !grams}
              className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40
                text-white text-sm font-bold rounded-xl transition-all active:scale-95"
            >
              Add
            </button>

            <button
              onClick={() => { setShowForm(false); setName(''); setGrams(''); setShowSuggestions(false); }}
              className="px-3 py-2.5 text-stone-400 hover:text-stone-600 text-lg leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
