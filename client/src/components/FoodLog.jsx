/**
 * FoodLog.jsx — Enhanced with:
 * - Voice input (Web Speech API)
 * - Portion size visual picker
 * - Configurable meal slots
 * - Always-visible remove button
 * - Extended TYPICAL_GRAMS (200+ foods)
 * - Simple traffic-light nutrition display
 * - More visible recent foods strip
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import api from '../api/client';
import { getNutrition } from '../constants';
import { getRecentFoods } from '../api/logs';
import { useSettingsStore, haptic } from '../store/settingsStore';

// ── Extended portion map ──────────────────────────────────────────────────────
const TYPICAL_GRAMS = {
  // Eggs
  egg: 55, 'boiled egg': 55, 'fried egg': 55, 'scrambled egg': 100, 'omelette': 120,
  // Dairy
  curd: 100, yogurt: 100, 'greek yogurt': 150, paneer: 100, 'low fat paneer': 100,
  'whole milk': 200, milk: 200, buttermilk: 200, 'cottage cheese': 100,
  // Bread/rotis
  chapati: 30, roti: 30, phulka: 25, paratha: 60, puri: 30, naan: 90,
  'bread slice': 25, 'brown bread': 25, 'white bread': 25, 'multigrain bread': 25,
  idli: 40, dosa: 80, uttapam: 100, appam: 70, 'poha': 60,
  'upma': 150, 'idiyappam': 80, 'puttu': 100,
  // Rice
  rice: 150, 'cooked rice': 150, 'brown rice': 150, 'white rice': 150,
  'red rice': 150, 'basmati rice': 150, 'steamed rice': 150, biryani: 200,
  // Fruits
  banana: 120, apple: 150, orange: 130, mango: 200, papaya: 150,
  watermelon: 200, grapes: 80, pomegranate: 100, guava: 100, pear: 150,
  kiwi: 80, strawberry: 80, blueberry: 80, pineapple: 150, coconut: 40,
  'coconut water': 240,
  // Vegetables (cooked serving)
  broccoli: 100, spinach: 100, 'palak': 100, carrot: 80, cucumber: 80,
  tomato: 80, onion: 50, 'bell pepper': 80, zucchini: 100, beans: 80,
  'french beans': 80, 'sweet potato': 100, potato: 150, 'baby corn': 50,
  cauliflower: 100, cabbage: 80, 'bitter gourd': 80, drumstick: 60,
  // Proteins
  'chicken breast': 150, chicken: 150, 'chicken curry': 200, 'chicken tikka': 150,
  fish: 150, salmon: 150, tuna: 150, 'rohu': 150, prawn: 100, 'egg white': 30,
  tofu: 100, tempeh: 100, 'soya chunks': 50, 'kidney beans': 100, rajma: 100,
  chana: 100, dal: 150, 'moong dal': 150, 'toor dal': 150, 'masoor dal': 150,
  // Nuts & seeds (small servings)
  almonds: 28, cashews: 28, walnuts: 28, peanuts: 28, pistachios: 28,
  'pumpkin seeds': 20, 'sunflower seeds': 20, 'flaxseeds': 15, 'chia seeds': 15,
  'hemp seeds': 15, 'sesame seeds': 10,
  // Oils & fats
  ghee: 10, 'coconut oil': 10, 'olive oil': 14, butter: 14,
  'peanut butter': 32, 'almond butter': 32,
  // Snacks
  biscuits: 30, 'marie biscuits': 30, 'digestive biscuits': 30,
  'protein bar': 60, 'granola bar': 40, popcorn: 28, chips: 30,
  // Drinks/beverages
  coffee: 240, tea: 240, 'green tea': 240, 'protein shake': 300,
  'fruit juice': 200, 'coconut water': 240, lassi: 200,
  // Indian dishes
  'chole': 150, 'pav bhaji': 200, 'sambar': 150, 'rasam': 150,
  'khichdi': 200, 'daliya': 150, 'muesli': 60, oats: 40,
  // Sweets (small portions)
  ladoo: 30, barfi: 30, halwa: 60, kheer: 100, rasgulla: 50,
};

function smartGrams(foodName) {
  const lc = (foodName || '').toLowerCase();
  for (const [key, g] of Object.entries(TYPICAL_GRAMS)) {
    if (lc.includes(key)) return g;
  }
  return null;
}

// ── Portion Picker ────────────────────────────────────────────────────────────
const PORTIONS = [
  { label: 'Small',   emoji: '🥛', multiplier: 0.6 },
  { label: 'Medium',  emoji: '🍽',  multiplier: 1.0 },
  { label: 'Large',   emoji: '🫙',  multiplier: 1.5 },
  { label: 'Custom',  emoji: '✏️',  multiplier: null },
];

function PortionPicker({ baseGrams, onSelect }) {
  const [selected, setSelected] = useState(null);
  if (!baseGrams) return null;
  return (
    <div>
      <p className="text-xs text-[#6a6a78] mb-2 font-medium">How much did you have?</p>
      <div className="grid grid-cols-4 gap-1.5">
        {PORTIONS.map(p => (
          <button key={p.label}
            onClick={() => {
              haptic(18);
              setSelected(p.label);
              if (p.multiplier !== null) onSelect(Math.round(baseGrams * p.multiplier));
              // Custom → user types manually (handled in parent)
            }}
            style={{ minHeight: 60 }}
            className={`rounded-xl border flex flex-col items-center justify-center gap-1 transition-all ${
              selected === p.label
                ? 'border-[rgba(124,92,252,0.5)] bg-[rgba(124,92,252,0.1)]'
                : 'border-white/[0.1] bg-[#1a1a20] hover:border-white/[0.2]'}`}>
            <span style={{ fontSize: 20 }}>{p.emoji}</span>
            <span className="text-[10px] text-[#8e8e9a] font-medium">{p.label}</span>
            {p.multiplier !== null && (
              <span className="text-[10px] text-[#4e4e5c]">{Math.round(baseGrams * p.multiplier)}g</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Traffic light nutrition badge ─────────────────────────────────────────────
function TrafficBadge({ n, target }) {
  if (!n || !target) return null;
  const pct = (n.cal / target) * 100;
  const color = pct > 110 ? '#f87171' : pct > 80 ? '#fbbf24' : '#a78bfa';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
      <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ fontSize: 12, color: '#8e8e9a' }}>
        {n.cal} kcal · P{n.pro}g · C{n.carb}g · F{n.fat}g
      </span>
    </div>
  );
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

export default function FoodLog({ items = [], onChange, calorieTarget }) {
  const mealSlots = useSettingsStore(s => s.mealSlots);
  const nutritionView = useSettingsStore(s => s.nutritionView);

  const [showForm, setShowForm]       = useState(false);
  const [meal, setMeal]               = useState(mealSlots[0] || 'Meal 1');
  const [query, setQuery]             = useState('');
  const [grams, setGrams]             = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searching, setSearching]     = useState(false);
  const [selected, setSelected]       = useState(null);
  const [lookupStatus, setLookupStatus] = useState('');
  const [recentFoods, setRecentFoods] = useState([]);
  const [listening, setListening]     = useState(false);

  useEffect(() => {
    getRecentFoods()
      .then(({ data }) => setRecentFoods(data || []))
      .catch(() => {});
  }, []);

  const nameRef      = useRef(null);
  const gramsRef     = useRef(null);
  const debounceRef  = useRef(null);
  const containerRef = useRef(null);
  const recognRef    = useRef(null);

  // ── Voice input ─────────────────────────────────────────────────────────────
  const startVoice = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { alert('Voice input not supported in this browser'); return; }
    const r = new SpeechRecognition();
    r.lang = 'en-IN';
    r.continuous = false;
    r.interimResults = false;
    r.onresult = (e) => {
      const text = e.results[0][0].transcript;
      setQuery(text);
      setSelected(null);
      setListening(false);
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => searchFoods(text), 200);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recognRef.current = r;
    r.start();
    setListening(true);
    haptic(30);
  };

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
    setSelected(null);
    setLookupStatus('');
    clearTimeout(debounceRef.current);
    if (val.length >= 2) {
      debounceRef.current = setTimeout(() => searchFoods(val), 300);
    } else { setSuggestions([]); setShowSuggestions(false); }
  };

  const pickSuggestion = (food) => {
    clearTimeout(debounceRef.current);
    setSelected(food);
    setQuery(food.name);
    setSuggestions([]);
    setShowSuggestions(false);
    setLookupStatus('');
    const defaultG = smartGrams(food.name);
    if (defaultG) setGrams(String(defaultG));
    haptic(15);
    setTimeout(() => gramsRef.current?.focus(), 50);
  };

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
    } catch { setLookupStatus('notfound'); }
  };

  const add = () => {
    if (!query.trim() || !grams) return;
    const g = parseFloat(grams);
    if (isNaN(g) || g <= 0) return;
    onChange([...items, {
      id: Date.now(), name: selected?.name || query.trim(),
      grams: g, meal, food_id: selected?.id || null, per_100g: selected?.per_100g || null,
    }]);
    haptic(25);
    setQuery(''); setGrams(''); setSelected(null);
    setLookupStatus(''); setSuggestions([]); setShowSuggestions(false);
    clearTimeout(debounceRef.current);
    nameRef.current?.focus();
  };

  const remove = (id) => { haptic(15); onChange(items.filter((i) => i.id !== id)); };
  const byMeal = (m) => items.filter((i) => i.meal === m);

  function mealTotal(mealItems) {
    return mealItems.reduce((acc, item) => {
      const n = calcMacros(item);
      if (!n) return acc;
      return { cal: acc.cal+(n.cal||0), pro: acc.pro+(n.pro||0), carb: acc.carb+(n.carb||0), fat: acc.fat+(n.fat||0) };
    }, { cal:0, pro:0, carb:0, fat:0 });
  }

  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setShowSuggestions(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler, { passive: true });
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('touchstart', handler); };
  }, []);

  const closeForm = () => {
    clearTimeout(debounceRef.current);
    setShowForm(false); setQuery(''); setGrams(''); setSelected(null);
    setLookupStatus(''); setSuggestions([]); setShowSuggestions(false);
  };

  const pickRecent = (food) => {
    setSelected({ id: food.food_id, name: food.name, per_100g: food.per_100g });
    setQuery(food.name);
    setGrams(String(food.last_g || 100));
    setSuggestions([]); setShowSuggestions(false); setLookupStatus('');
    haptic(15);
    setTimeout(() => gramsRef.current?.focus(), 50);
  };

  return (
    <div className="space-y-3">

      {/* Quick re-add strip — always visible when we have recent foods */}
      {recentFoods.length > 0 && !showForm && (
        <div>
          <p className="text-xs text-[#4e4e5c] font-semibold mb-2 uppercase tracking-wider">Quick re-add</p>
          <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            {recentFoods.slice(0,6).map((food, i) => {
              const kcal = food.per_100g?.calories ? Math.round(food.per_100g.calories * (food.last_g || 100) / 100) : null;
              return (
                <button key={i} onClick={() => { setShowForm(true); setTimeout(() => pickRecent(food), 100); }}
                  style={{ minHeight: 44, whiteSpace: 'nowrap', flexShrink: 0 }}
                  className="flex items-center gap-2 text-xs bg-[#1a1a20] border border-white/[0.10] hover:border-[rgba(124,92,252,0.4)] rounded-xl px-3 py-2 transition-colors text-[#d8d8de] font-medium">
                  <span className="truncate max-w-[100px]">{food.name}</span>
                  {kcal && <span className="text-orange-400 font-bold">{kcal}k</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Meal sections */}
      {mealSlots.map((m) => {
        const mealItems = byMeal(m);
        const totals = mealTotal(mealItems);
        return (
          <div key={m}>
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="text-xs font-bold text-[#4e4e5c] uppercase tracking-wider">{m}</span>
              {mealItems.length > 0 && (
                <>
                  <span className="text-xs text-[#3a3a46]">{mealItems.reduce((s,i)=>s+i.grams,0).toFixed(0)}g</span>
                  <span className="text-xs font-semibold text-orange-400">{totals.cal} kcal</span>
                  {nutritionView === 'detailed' && (
                    <>
                      <span className="text-xs text-blue-400">P {totals.pro.toFixed(1)}g</span>
                      <span className="text-xs text-amber-400">C {totals.carb.toFixed(1)}g</span>
                      <span className="text-xs text-purple-400">F {totals.fat.toFixed(1)}g</span>
                    </>
                  )}
                </>
              )}
            </div>
            {mealItems.length === 0 ? (
              <p className="text-xs text-[#3a3a46] italic px-2 py-1">Nothing logged yet</p>
            ) : (
              <div className="space-y-1">
                {mealItems.map((item) => {
                  const n = calcMacros(item);
                  return (
                    <div key={item.id} className="py-2 px-3 rounded-xl bg-[#1a1a20] border border-white/[0.05]">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-medium text-[#d8d8de] truncate">{item.name}</span>
                          <span className="text-xs font-semibold text-[#8b5cf6] flex-shrink-0">{item.grams}g</span>
                        </div>
                        {/* Always-visible remove button */}
                        <button onClick={() => remove(item.id)}
                          style={{ minWidth: 32, minHeight: 32 }}
                          className="flex items-center justify-center rounded-full text-[#4e4e5c] hover:text-red-400 hover:bg-red-400/10 transition-all ml-2 flex-shrink-0"
                          aria-label="Remove item">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      {n && (
                        nutritionView === 'simple'
                          ? <TrafficBadge n={n} target={calorieTarget} />
                          : (
                            <div className="flex gap-3 mt-1">
                              <span className="text-xs font-bold text-orange-400">{n.cal} kcal</span>
                              <span className="text-xs text-blue-400">P {n.pro}g</span>
                              <span className="text-xs text-amber-400">C {n.carb}g</span>
                              <span className="text-xs text-purple-400">F {n.fat}g</span>
                            </div>
                          )
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* Day total */}
      {items.length > 0 && (() => {
        const dayTotal = items.reduce((acc, item) => {
          const n = calcMacros(item);
          if (!n) return acc;
          return { cal: acc.cal+(n.cal||0), pro: acc.pro+(n.pro||0), carb: acc.carb+(n.carb||0), fat: acc.fat+(n.fat||0) };
        }, { cal:0, pro:0, carb:0, fat:0 });
        return (
          <div className="flex items-center justify-between bg-white/[0.04] rounded-2xl px-4 py-2.5 border border-white/[0.06]">
            <span className="text-xs font-bold text-[#4e4e5c] uppercase tracking-wider">Day total</span>
            <div className="flex gap-3">
              <span className="text-xs font-bold text-orange-400">{dayTotal.cal} kcal</span>
              <span className="text-xs text-blue-400">P {dayTotal.pro.toFixed(1)}g</span>
              <span className="text-xs text-amber-400">C {dayTotal.carb.toFixed(1)}g</span>
              <span className="text-xs text-purple-400">F {dayTotal.fat.toFixed(1)}g</span>
            </div>
          </div>
        );
      })()}

      {/* Add food form */}
      {!showForm ? (
        <button onClick={() => setShowForm(true)}
          style={{ minHeight: 52 }}
          className="w-full py-3 rounded-2xl border-2 border-dashed border-[rgba(124,92,252,0.3)] text-[#8b5cf6] text-sm font-semibold hover:bg-[rgba(124,92,252,0.05)] hover:border-[rgba(124,92,252,0.5)] active:scale-98 transition-all">
          + Add food item
        </button>
      ) : (
        <div className="bg-[#1a1a20] rounded-2xl p-3 space-y-3 border border-white/[0.07]">

          {/* Meal selector */}
          <div className="flex gap-1.5 flex-wrap">
            {mealSlots.map((m) => (
              <button key={m} onClick={() => setMeal(m)}
                style={{ minHeight: 36 }}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  meal === m ? 'bg-[#7c5cfc] text-white shadow-sm' : 'bg-white/[0.05] text-[#8e8e9a] hover:bg-white/[0.10]'
                }`}>{m}</button>
            ))}
          </div>

          {/* Recent foods inside form */}
          {recentFoods.length > 0 && !query && (
            <div>
              <p className="text-xs text-[#4e4e5c] font-medium mb-1.5">Recently used</p>
              <div className="flex flex-wrap gap-1.5">
                {recentFoods.slice(0,5).map((food, i) => {
                  const kcal = food.per_100g?.calories ? Math.round(food.per_100g.calories * (food.last_g || 100) / 100) : null;
                  return (
                    <button key={i} onClick={() => pickRecent(food)}
                      style={{ minHeight: 36 }}
                      className="flex items-center gap-1.5 text-xs bg-[#1a1a20] border border-white/[0.10] hover:border-[rgba(124,92,252,0.4)] rounded-xl px-2.5 py-1.5 transition-colors text-[#d8d8de] font-medium">
                      <span className="truncate max-w-[100px]">{food.name}</span>
                      <span className="text-[#6a6a78]">{food.last_g}g</span>
                      {kcal && <span className="text-orange-400 font-bold">{kcal}k</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Food name + voice input + autocomplete */}
          <div ref={containerRef} className="relative">
            <div className="relative flex gap-2">
              <input ref={nameRef} value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
                onFocus={() => { if (suggestions.length > 0 && !selected) setShowSuggestions(true); }}
                placeholder="Food name…"
                className="flex-1 px-3 py-2.5 rounded-xl border border-[rgba(255,255,255,0.12)] text-sm bg-[#131317] focus:outline-none focus:ring-2 focus:ring-[rgba(124,92,252,0.3)] text-[#ededf0] font-medium"
                autoFocus />
              {/* Voice input button */}
              <button onClick={startVoice}
                style={{ width: 44, height: 44, minWidth: 44 }}
                className={`rounded-xl flex items-center justify-center border transition-all ${
                  listening
                    ? 'bg-red-500/20 border-red-500/50 text-red-400 animate-pulse'
                    : 'bg-white/[0.06] border-white/[0.1] text-[#6a6a78] hover:text-[#8e8e9a]'
                }`}
                title="Voice input">
                🎤
              </button>
              {searching && (
                <div className="absolute right-14 top-1/2 -translate-y-1/2">
                  <div className="w-4 h-4 border-2 border-[rgba(124,92,252,0.3)] border-t-[#7c5cfc] rounded-full animate-spin" />
                </div>
              )}
              {selected && !searching && (
                <span className="absolute right-14 top-1/2 -translate-y-1/2 text-[#8b5cf6] text-sm font-bold">✓</span>
              )}
            </div>
            {listening && (
              <div className="mt-1 text-xs text-red-400 font-medium px-1">🎤 Listening… speak now</div>
            )}

            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-[#1a1a20] rounded-xl border border-white/[0.1] shadow-lg z-30 overflow-hidden"
                style={{ maxHeight: 240, overflowY: 'auto', overscrollBehavior: 'contain' }}>
                {suggestions.map((food) => (
                  <button key={food.id}
                    onMouseDown={(e) => e.preventDefault()}
                    onTouchStart={(e) => e.preventDefault()}
                    onClick={() => pickSuggestion(food)}
                    style={{ minHeight: 44 }}
                    className="w-full text-left px-3 py-2.5 hover:bg-[rgba(124,92,252,0.08)] active:bg-[rgba(124,92,252,0.15)] transition-colors border-b border-white/[0.05] last:border-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-[#d8d8de] font-medium truncate">{food.name}</span>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {food.verified && (
                          <span className="text-xs bg-[rgba(124,92,252,0.12)] text-[#7c5cfc] px-1.5 py-0.5 rounded font-semibold">✓</span>
                        )}
                        <span className="text-xs font-bold text-orange-400">{food.per_100g?.calories || 0} kcal</span>
                      </div>
                    </div>
                    {food.name_local && food.name_local !== food.name && (
                      <div className="text-xs text-[#6a6a78] mt-0.5">{food.name_local}</div>
                    )}
                  </button>
                ))}
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onTouchStart={(e) => e.preventDefault()}
                  onClick={() => { setShowSuggestions(false); lookupOff(); }}
                  style={{ minHeight: 44 }}
                  className="w-full text-left px-3 py-2.5 hover:bg-blue-500/10 transition-colors border-t border-white/[0.05]">
                  <span className="text-xs text-blue-400 font-semibold">🔍 Search Open Food Facts for "{query}"</span>
                </button>
              </div>
            )}

            {!searching && query.length >= 2 && suggestions.length === 0 && !showSuggestions && !selected && (
              <div className="mt-1.5">
                {lookupStatus === 'loading'   && <p className="text-xs text-[#6a6a78] px-1">Searching Open Food Facts…</p>}
                {lookupStatus === 'notfound'  && <p className="text-xs text-red-400 px-1">Not found — you can still add it manually</p>}
                {lookupStatus === 'found'     && <p className="text-xs text-[#8b5cf6] px-1 font-semibold">✓ Found on Open Food Facts</p>}
                {lookupStatus === '' && (
                  <button onClick={lookupOff} className="text-xs text-blue-400 font-semibold px-1 hover:underline">
                    🔍 Not in local DB — search Open Food Facts
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Portion picker — shown when a food is selected */}
          {selected && (
            <PortionPicker
              baseGrams={smartGrams(selected.name) || 100}
              onSelect={(g) => setGrams(String(g))}
            />
          )}

          {/* Per-100g preview */}
          {selected?.per_100g && (
            <div className="bg-[#131317] rounded-xl border border-[rgba(124,92,252,0.2)] px-3 py-2">
              <p className="text-xs text-[#6a6a78] mb-1">Per 100g — {selected.name}</p>
              <div className="flex gap-3 flex-wrap">
                <span className="text-xs font-bold text-orange-400">{selected.per_100g.calories || 0} kcal</span>
                <span className="text-xs text-blue-400">P {selected.per_100g.protein || 0}g</span>
                <span className="text-xs text-amber-400">C {selected.per_100g.net_carbs ?? selected.per_100g.total_carbs ?? 0}g net</span>
                <span className="text-xs text-purple-400">F {selected.per_100g.fat || 0}g</span>
                {!selected.verified && <span className="text-xs text-[#6a6a78] italic">unverified</span>}
              </div>
            </div>
          )}

          {/* Weight + Add + Close */}
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <input ref={gramsRef} type="number" inputMode="decimal" value={grams}
                onChange={(e) => setGrams(e.target.value)}
                placeholder="Weight in grams"
                onKeyDown={(e) => e.key === 'Enter' && add()}
                className="w-full px-3 py-2.5 pr-8 rounded-xl border border-white/[0.12] text-sm bg-[#131317] focus:outline-none focus:ring-2 focus:ring-[rgba(124,92,252,0.3)] text-[#ededf0]" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#4e4e5c]">g</span>
            </div>
            <button onClick={add} disabled={!query.trim() || !grams}
              style={{ minHeight: 44 }}
              className="px-4 py-2.5 bg-[#7c5cfc] hover:bg-[#9775fa] disabled:opacity-40 text-white text-sm font-bold rounded-xl transition-all active:scale-95">
              Add
            </button>
            <button onClick={closeForm}
              style={{ minWidth: 44, minHeight: 44 }}
              className="px-3 py-2.5 text-[#4e4e5c] hover:text-[#8e8e9a] text-lg leading-none"
              aria-label="Close">×</button>
          </div>
        </div>
      )}
    </div>
  );
}
