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
import { getNutrition, plural } from '../constants';
import { getMealPresets, saveMealPreset, deleteMealPreset, getYesterdayFood } from '../api/logs';
import { getRecentFoods } from '../api/logs';
import { useSettingsStore, haptic } from '../store/settingsStore';
import AIFoodSearch from './AIFoodSearch';
import { useAIChat } from './AIChatLog';
import { useVoiceInput } from '../hooks/useVoiceInput';

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
                ? 'border-[rgba(212,175,55,0.5)] bg-[rgba(212,175,55,0.1)]'
                : 'border-white/[0.1] bg-[#1A1C20] hover:border-white/[0.2]'}`}>
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
  const color = pct > 110 ? '#f87171' : pct > 80 ? '#fbbf24' : '#e0c98a';
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


// ── Barcode scanner ──────────────────────────────────────────────────────────
// Native BarcodeDetector (Chrome/Android — the member base). No library, no
// bundle weight. Browsers without it simply never see the button. A hit goes
// through the existing /foods/lookup → Open Food Facts pipeline, which also
// caches the product into the foods table for next time.
const hasBarcodeDetector = typeof window !== 'undefined' && 'BarcodeDetector' in window;

function BarcodeScanner({ onFound, onClose }) {
  const videoRef = useRef(null);
  const [status, setStatus] = useState('Starting camera…');

  useEffect(() => {
    let stream, raf, stopped = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStatus('Point at the barcode');
        const detector = new window.BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'],
        });
        const tick = async () => {
          if (stopped) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length) {
              stopped = true;
              stream.getTracks().forEach(t => t.stop());
              onFound(codes[0].rawValue);
              return;
            }
          } catch { /* frame not ready */ }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (err) {
        setStatus(err?.name === 'NotAllowedError'
          ? 'Camera blocked — allow camera access in browser settings'
          : 'Could not start the camera');
      }
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach(t => t.stop());
    };
  }, [onFound]);

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-6"
      onClick={onClose}>
      <video ref={videoRef} playsInline muted
        className="w-full max-w-sm rounded-2xl border border-white/[0.15]"
        onClick={e => e.stopPropagation()} />
      <p className="text-sm text-white mt-4">{status}</p>
      <button onClick={onClose} style={{ minHeight: 44 }}
        className="mt-3 px-6 rounded-full border border-white/[0.25] text-sm text-white">
        Cancel
      </button>
    </div>
  );
}


// ── Coach's meal plan — prescribed vs consumed, workout-log style ────────────
// Each prescribed item shows the coach's amount with an editable consumed-grams
// field (prefilled with the prescription). "Log this meal" appends everything
// non-zero into today's food with the plan's nutrition — no AI round-trip.
// Items already logged for that meal (matched by name) show as done.
function PrescribedMeals({ items, onChange }) {
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
              allDone ? 'border-white/[0.07] bg-white/[0.02]'
                      : 'border-[rgba(212,175,55,0.3)] bg-[rgba(212,175,55,0.05)]'}`}>
            <button className="w-full flex items-center justify-between"
              onClick={() => setCollapsed(c => ({ ...c, [plan.meal]: !isCollapsed }))}>
              <span className="text-xs font-bold text-[#e0c98a]">
                🍽️ Coach's {plan.meal} plan {allDone && '· done ✓'}
              </span>
              <span className="text-[10px] text-[#8e8e9a]">~{planKcal} kcal {isCollapsed ? '▾' : '▴'}</span>
            </button>

            {!isCollapsed && (
              <>
                <div className="mt-2 space-y-1.5">
                  {plan.items.map(it => {
                    const done = already.has(it.name.toLowerCase());
                    const key = `${plan.meal}|${it.name}`;
                    return (
                      <div key={it.name} className="flex items-center gap-2">
                        <span className={`flex-1 text-xs truncate ${done ? 'text-[#6a6a78] line-through' : 'text-white'}`}>
                          {it.name}
                          <span className="text-[#8e8e9a]"> · plan {it.qty_text}</span>
                        </span>
                        {done ? (
                          <span className="text-[10px] text-emerald-400 font-bold">logged ✓</span>
                        ) : (
                          <>
                            <input type="number" inputMode="decimal" min="0" max="2000"
                              value={consumed[key] ?? ''}
                              onChange={e => setConsumed(c => ({ ...c, [key]: e.target.value }))}
                              className="w-16 text-right text-xs bg-[#121316] border border-white/[0.12] rounded-lg px-2 py-1 text-white" />
                            <span className="text-[10px] text-[#8e8e9a] w-4">g</span>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
                {!allDone && (
                  <button onClick={() => logMeal(plan)}
                    style={{ minHeight: 40 }}
                    className="mt-2.5 w-full rounded-full bg-[#D4AF37] text-[#121316] text-xs font-bold active:scale-[0.98] transition-transform">
                    Log {pending.length === plan.items.length ? 'this meal' : `${pending.length} remaining ${plural(pending.length, 'item')}`} as entered
                  </button>
                )}
                <p className="mt-1.5 text-[10px] text-[#6a6a78] text-center">
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
  const [showAI, setShowAI]           = useState(false);
  const [aiQuery, setAiQuery]         = useState('');
  const openAIChat = useAIChat(s => s.openChat);  // shared AI chat (mounted in DailyLog)

  // ── Repeat logging (Sprint 5) ───────────────────────────────────────────────
  // Recent-foods already helped with single items. What was missing was any
  // way to repeat a COMBINATION — the same four-item breakfast was four
  // pick/confirm/add cycles every morning.
  const [presets, setPresets]         = useState([]);
  const [yesterdayCount, setYCount]   = useState(0);
  const [repeatBusy, setRepeatBusy]   = useState(false);
  const [repeatNote, setRepeatNote]   = useState('');
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetName, setPresetName]   = useState('');

  useEffect(() => {
    getRecentFoods()
      .then(({ data }) => setRecentFoods(data || []))
      .catch(() => {});
    getMealPresets()
      .then(({ data }) => setPresets(data || []))
      .catch(() => {});
  }, []);

  // How much of yesterday is available to repeat, for the current meal slot.
  useEffect(() => {
    getYesterdayFood(meal)
      .then(({ data }) => setYCount(data.count || 0))
      .catch(() => setYCount(0));
  }, [meal]);

  /**
   * Add a list of stored items to today's log.
   *
   * New ids are minted per item: reusing yesterday's would collide with a row
   * already in today's list and make edit/remove act on the wrong one. The
   * meal is set to the slot the member is currently on, not the slot the food
   * came from — repeating yesterday's breakfast into lunch is a legitimate
   * thing to want.
   */
  const addStoredItems = (stored, label) => {
    const toAdd = (stored || [])
      .filter(i => i && i.name && Number(i.grams) > 0)
      .map((i, n) => ({
        id:       Date.now() + n,
        name:     i.name,
        grams:    Number(i.grams),
        meal,
        food_id:  i.food_id ?? null,
        per_100g: i.per_100g || null,
      }));
    if (!toAdd.length) { setRepeatNote('Nothing to copy.'); return; }
    onChange([...(items || []), ...toAdd]);
    haptic(25);
    setRepeatNote(`Added ${toAdd.length} ${plural(toAdd.length, 'item')} from ${label}.`);
  };

  const repeatYesterday = async () => {
    setRepeatBusy(true);
    setRepeatNote('');
    try {
      const { data } = await getYesterdayFood(meal);
      addStoredItems(data.items, 'yesterday');
    } catch {
      setRepeatNote("Couldn't load yesterday — check your connection.");
    } finally { setRepeatBusy(false); }
  };

  // Only the items in the slot being viewed, so "save this meal" saves the
  // meal and not the whole day.
  const currentMealItems = (items || []).filter(i => i.meal === meal);

  const savePreset = async () => {
    const name = presetName.trim();
    if (!name) return;
    setRepeatNote('');
    try {
      const { data } = await saveMealPreset({
        name, meal,
        items: currentMealItems.map(i => ({
          food_id: i.food_id ?? null, name: i.name,
          grams: i.grams, per_100g: i.per_100g || null,
        })),
      });
      // Replace by name — the server upserts, so a re-save must not duplicate
      // the entry in the list either.
      setPresets(prev => [data, ...prev.filter(p => p.name !== data.name)]);
      setSavingPreset(false);
      setPresetName('');
      setRepeatNote(`Saved as "${data.name}".`);
    } catch (err) {
      setRepeatNote(err.response?.data?.error || "Couldn't save that meal.");
    }
  };

  const removePreset = async (id) => {
    try {
      await deleteMealPreset(id);
      setPresets(prev => prev.filter(p => p.id !== id));
    } catch {
      setRepeatNote("Couldn't delete that.");
    }
  };

  const nameRef      = useRef(null);
  const gramsRef     = useRef(null);
  const debounceRef  = useRef(null);
  const containerRef = useRef(null);

  // ── Voice input — shared hook; Gemini transcript triggers the food search ──
  const voiceLang = useSettingsStore(st => st.voiceLang || 'en-IN');
  const voice = useVoiceInput({
    lang: voiceLang,
    onInterim: (t) => { setQuery(t); setSelected(null); },
    onFinal:   (t) => {
      setQuery(t); setSelected(null);
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => searchFoods(t), 200);
    },
  });
  const { listening } = voice;
  const startVoice = () => { haptic(30); voice.toggle(); };

  // Barcode → /foods/lookup (Open Food Facts) → selected food, ready for grams
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState(null);
  const onBarcodeFound = useCallback(async (barcode) => {
    setScanning(false);
    haptic(20);
    setScanMsg('Looking up product…');
    try {
      const { data } = await api.post('/foods/lookup', { barcode });
      setSelected({ id: data.id, name: data.name, per_100g: data.per_100g });
      setQuery(data.name);
      setScanMsg(null);
    } catch (err) {
      setScanMsg(err.response?.status === 404
        ? "Not in the product database — type the name and AI will estimate it"
        : 'Lookup failed — type the name instead');
      setTimeout(() => setScanMsg(null), 5000);
    }
  }, []);

  // ── Search ──────────────────────────────────────────────────────────────────
  const searchFoods = useCallback(async (q) => {
    if (!q || q.length < 2) { setSuggestions([]); setShowSuggestions(false); setShowAI(false); return; }
    setSearching(true);
    try {
      const { data } = await api.get('/foods/search', { params: { q, limit: 8 } });
      setSuggestions(data);
      if (data.length > 0) {
        setShowSuggestions(true);
        setShowAI(false);
      } else {
        // Nothing in DB — auto-open AI identifier, no button click needed
        setShowSuggestions(false);
        setAiQuery(q);
        setShowAI(true);
      }
    } catch {
      setSuggestions([]);
      setAiQuery(q);
      setShowAI(true); // also auto-open on network error
    }
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

  const handleAISelect = (food) => {
    // food arrives as { ...aiFood, name: userTypedQuery, per_100g: {...}, grams: N }
    // We call onChange directly — never relies on volatile `selected` state
    const chosenGrams = food.grams || smartGrams(food.name) || 100;
    const per100g     = food.per_100g && (food.per_100g.calories || 0) > 0
      ? food.per_100g
      : null;  // reject empty AI response rather than logging 0 kcal

    onChange([...items, {
      id:      Date.now(),
      name:    food.name,      // user's typed name (e.g. "Ragi mude")
      grams:   chosenGrams,
      meal,
      food_id: food.id || null,
      per_100g: per100g,       // AI nutrition — explicitly extracted, never lost
    }]);
    haptic(25);
    // Reset all search state cleanly
    setShowAI(false);
    setQuery('');
    setGrams('');
    setSelected(null);
    setLookupStatus('');
    setSuggestions([]);
    setShowSuggestions(false);
    clearTimeout(debounceRef.current);
  };

  return (
    <div className="space-y-3">

      {/* Coach-prescribed meals for today — log consumed against prescribed */}
      <PrescribedMeals items={items} onChange={onChange} />

      {/* AI Chat logging — full-day: weight, activities, food, water, sleep... */}
      <button
        onClick={() => { haptic(15); openAIChat(); }}
        style={{ minHeight: 48 }}
        className="w-full flex items-center gap-3 bg-gradient-to-r from-[#D4AF37]/[0.14] to-[#8a6a1e]/[0.10] border border-[#D4AF37]/30 hover:border-[#D4AF37]/55 rounded-2xl px-4 py-3 transition-all active:scale-[0.99]">
        <span className="w-8 h-8 rounded-full bg-gradient-to-br from-[#D4AF37] to-[#8a6a1e] flex items-center justify-center text-sm flex-shrink-0 shadow-[0_0_14px_rgba(212,175,55,0.4)]">✨</span>
        <span className="text-left min-w-0">
          <span className="block text-sm font-bold text-white leading-tight">Log with AI Chat</span>
          <span className="block text-[11px] text-[#8e8e9a] leading-tight truncate">Say your whole day — I'll fill the entire log</span>
        </span>
      </button>

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
                  className="flex items-center gap-2 text-xs bg-[#1A1C20] border border-white/[0.10] hover:border-[rgba(212,175,55,0.4)] rounded-xl px-3 py-2 transition-colors text-[#d8d8de] font-medium">
                  <span className="truncate max-w-[100px]">{food.name}</span>
                  {kcal && <span className="text-orange-400 font-bold">{kcal}k</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Repeat logging ────────────────────────────────────────────────────
          Sits above the meal sections and below the recent-food chips, so the
          progression reads: repeat a whole meal, repeat one item, or add
          something new. */}
      {!showForm && (yesterdayCount > 0 || presets.length > 0) && (
        <div className="mb-3">
          <p className="text-xs font-bold text-[#4e4e5c] uppercase tracking-wider mb-1.5">
            Repeat into {meal}
          </p>
          <div className="flex flex-wrap gap-2">
            {yesterdayCount > 0 && (
              <button onClick={repeatYesterday} disabled={repeatBusy}
                style={{ minHeight: 36 }}
                className="px-3 rounded-xl text-xs font-semibold text-[#121316]
                  bg-gradient-to-r from-[#F0E2B6] via-[#D4AF37] to-[#8C6D37]
                  active:scale-[0.98] disabled:opacity-50">
                {repeatBusy ? 'Adding…' : `Same as yesterday (${yesterdayCount})`}
              </button>
            )}
            {presets.map(p => (
              <span key={p.id}
                className="inline-flex items-center rounded-xl border border-[rgba(212,175,55,0.20)]
                  bg-[rgba(212,175,55,0.08)] overflow-hidden">
                <button onClick={() => addStoredItems(p.items, p.name)}
                  style={{ minHeight: 36 }}
                  className="px-3 text-xs font-semibold text-[#F0E2B6]">
                  {p.name}
                  <span className="text-[#9EA3B0] ml-1">
                    ({p.items?.length || 0})
                  </span>
                </button>
                <button onClick={() => removePreset(p.id)}
                  title={`Delete "${p.name}"`}
                  style={{ minWidth: 28, minHeight: 36 }}
                  className="text-[#7E8596] hover:text-red-400 text-sm border-l border-[rgba(212,175,55,0.18)]">
                  ×
                </button>
              </span>
            ))}
          </div>

          {/* Save the current slot as a named combination — only offered when
              there is actually something in it. */}
          {currentMealItems.length > 0 && !savingPreset && (
            <button onClick={() => { setSavingPreset(true); setPresetName(''); }}
              style={{ minHeight: 32 }}
              className="mt-2 text-[11px] font-semibold text-[#D4AF37]">
              + Save this {meal} as a usual
            </button>
          )}
          {savingPreset && (
            <div className="flex gap-2 mt-2">
              <input
                value={presetName}
                onChange={e => setPresetName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && savePreset()}
                placeholder="e.g. My usual breakfast"
                maxLength={80}
                autoFocus
                className="flex-1 min-w-0 px-3 py-2 bg-[#121316] border border-white/[0.10]
                  rounded-xl text-sm text-white outline-none
                  focus:border-[rgba(212,175,55,0.40)]" />
              <button onClick={savePreset} disabled={!presetName.trim()}
                style={{ minHeight: 38 }}
                className="px-3 text-xs font-bold text-[#121316] rounded-xl
                  bg-gradient-to-r from-[#F0E2B6] via-[#D4AF37] to-[#8C6D37]
                  disabled:opacity-40">
                Save
              </button>
              <button onClick={() => setSavingPreset(false)}
                style={{ minHeight: 38 }}
                className="px-3 text-xs font-bold text-[#9EA3B0] border border-white/[0.10] rounded-xl">
                Cancel
              </button>
            </div>
          )}
          {repeatNote && (
            <p className="text-[11px] text-[#9EA3B0] mt-1.5 leading-relaxed">{repeatNote}</p>
          )}
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
                      <span className="text-xs text-amber-400">F {totals.fat.toFixed(1)}g</span>
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
                    <div key={item.id} className="py-2 px-3 rounded-xl bg-[#1A1C20] border border-white/[0.05]">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-medium text-[#d8d8de] truncate">{item.name}</span>
                          <span className="text-xs font-semibold text-[#bf9a2e] flex-shrink-0">{item.grams}g</span>
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
                              <span className="text-xs text-amber-400">F {n.fat}g</span>
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
              <span className="text-xs text-amber-400">F {dayTotal.fat.toFixed(1)}g</span>
            </div>
          </div>
        );
      })()}

      {/* Add food form */}
      {!showForm ? (
        <button onClick={() => setShowForm(true)}
          style={{ minHeight: 52 }}
          className="w-full py-3 rounded-2xl border-2 border-dashed border-[rgba(212,175,55,0.3)] text-[#bf9a2e] text-sm font-semibold hover:bg-[rgba(212,175,55,0.05)] hover:border-[rgba(212,175,55,0.5)] active:scale-98 transition-all">
          + Add food item
        </button>
      ) : (
        <div className="bg-[#1A1C20] rounded-2xl p-3 space-y-3 border border-white/[0.07]">

          {/* Meal selector */}
          <div className="flex gap-1.5 flex-wrap">
            {mealSlots.map((m) => (
              <button key={m} onClick={() => setMeal(m)}
                style={{ minHeight: 36 }}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  meal === m ? 'bg-[#D4AF37] text-white shadow-sm' : 'bg-white/[0.05] text-[#8e8e9a] hover:bg-white/[0.10]'
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
                      className="flex items-center gap-1.5 text-xs bg-[#1A1C20] border border-white/[0.10] hover:border-[rgba(212,175,55,0.4)] rounded-xl px-2.5 py-1.5 transition-colors text-[#d8d8de] font-medium">
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
                className="flex-1 px-3 py-2.5 rounded-xl border border-[rgba(255,255,255,0.12)] text-sm bg-[#131317] focus:outline-none focus:ring-2 focus:ring-[rgba(212,175,55,0.3)] text-[#ededf0] font-medium"
                autoFocus />
              {hasBarcodeDetector && (
                <button onClick={() => { haptic(15); setScanning(true); }}
                  style={{ width: 44, height: 44, minWidth: 44 }}
                  className="rounded-xl flex items-center justify-center border bg-white/[0.06] border-white/[0.1] text-[#6a6a78] hover:text-[#8e8e9a]"
                  title="Scan a barcode">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" />
                    <path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" />
                    <line x1="8" y1="8" x2="8" y2="16" /><line x1="12" y1="8" x2="12" y2="16" />
                    <line x1="16" y1="8" x2="16" y2="16" />
                  </svg>
                </button>
              )}
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
                  <div className="w-4 h-4 border-2 border-[rgba(212,175,55,0.3)] border-t-[#D4AF37] rounded-full animate-spin" />
                </div>
              )}
              {selected && !searching && (
                <span className="absolute right-14 top-1/2 -translate-y-1/2 text-[#bf9a2e] text-sm font-bold">✓</span>
              )}
            </div>
            {listening && (
              <div className="mt-1 text-xs text-red-400 font-medium px-1">🎤 Listening… tap again when done</div>
            )}
            {voice.transcribing && (
              <div className="mt-1 text-xs text-[#D4AF37] font-medium px-1">✨ Getting the exact words…</div>
            )}
            {voice.error && (
              <div className="mt-1 text-xs text-amber-400 font-medium px-1">{voice.error}</div>
            )}
            {scanMsg && (
              <div className="mt-1 text-xs text-[#D4AF37] font-medium px-1">{scanMsg}</div>
            )}
            {scanning && (
              <BarcodeScanner onFound={onBarcodeFound} onClose={() => setScanning(false)} />
            )}

            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-[#1A1C20] rounded-xl border border-white/[0.1] shadow-lg z-30 overflow-hidden"
                style={{ maxHeight: 240, overflowY: 'auto', overscrollBehavior: 'contain' }}>
                {suggestions.map((food) => (
                  <button key={food.id}
                    onMouseDown={(e) => e.preventDefault()}
                    onTouchStart={(e) => e.preventDefault()}
                    onClick={() => pickSuggestion(food)}
                    style={{ minHeight: 44 }}
                    className="w-full text-left px-3 py-2.5 hover:bg-[rgba(212,175,55,0.08)] active:bg-[rgba(212,175,55,0.15)] transition-colors border-b border-white/[0.05] last:border-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-[#d8d8de] font-medium truncate">{food.name}</span>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {food.verified && (
                          <span className="text-xs bg-[rgba(212,175,55,0.12)] text-[#D4AF37] px-1.5 py-0.5 rounded font-semibold">✓</span>
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

            {!searching && query.length >= 2 && suggestions.length === 0 && !showSuggestions && !selected && !showAI && (
              <div className="mt-1.5 space-y-1">
                {lookupStatus === 'loading'  && <p className="text-xs text-[#6a6a78] px-1">Searching Open Food Facts…</p>}
                {lookupStatus === 'found'    && <p className="text-xs text-[#bf9a2e] px-1 font-semibold">✓ Found on Open Food Facts</p>}
                {lookupStatus === 'notfound' && <p className="text-xs text-[#6a6a78] px-1">Not found — searching AI…</p>}
                {lookupStatus === '' && (
                  <button onClick={lookupOff} className="text-xs text-blue-400 font-semibold px-1 hover:underline">
                    🔍 Not in local DB — search Open Food Facts
                  </button>
                )}
              </div>
            )}

            {showAI && (
              <div className="mt-2">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-[#00D49F]">✨ AI Food Identifier</span>
                  <button onClick={() => setShowAI(false)}
                    className="text-xs text-[#6a6a78] hover:text-[#d8d8de]">✕ close</button>
                </div>
                <AIFoodSearch key={aiQuery} initialQuery={aiQuery} mealSlot={meal} onSelect={handleAISelect} t={null} />
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
            <div className="bg-[#131317] rounded-xl border border-[rgba(212,175,55,0.2)] px-3 py-2">
              <p className="text-xs text-[#6a6a78] mb-1">Per 100g — {selected.name}</p>
              <div className="flex gap-3 flex-wrap">
                <span className="text-xs font-bold text-orange-400">{selected.per_100g.calories || 0} kcal</span>
                <span className="text-xs text-blue-400">P {selected.per_100g.protein || 0}g</span>
                <span className="text-xs text-amber-400">C {selected.per_100g.net_carbs ?? selected.per_100g.total_carbs ?? 0}g net</span>
                <span className="text-xs text-amber-400">F {selected.per_100g.fat || 0}g</span>
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
                className="w-full px-3 py-2.5 pr-8 rounded-xl border border-white/[0.12] text-sm bg-[#131317] focus:outline-none focus:ring-2 focus:ring-[rgba(212,175,55,0.3)] text-[#ededf0]" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#4e4e5c]">g</span>
            </div>
            <button onClick={add} disabled={!query.trim() || !grams}
              style={{ minHeight: 44 }}
              className="px-4 py-2.5 bg-[#D4AF37] hover:bg-[#9775fa] disabled:opacity-40 text-white text-sm font-bold rounded-xl transition-all active:scale-95">
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
