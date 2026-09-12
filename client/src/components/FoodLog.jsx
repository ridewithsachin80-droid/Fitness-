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
import { useAIChat } from '../store/aiChatStore';
import { useVoiceInput } from '../hooks/useVoiceInput';

// ── Extended portion map ──────────────────────────────────────────────────────
// Sprint 12c: the pieces above the main component live in components/food/.
import { TYPICAL_GRAMS, smartGrams, PORTIONS, PortionPicker } from './food/portions.jsx';
import { TrafficBadge } from './food/TrafficBadge';
import { calcMacros } from './food/macros';
import { BarcodeScanner, hasBarcodeDetector } from './food/BarcodeScanner';
import { PrescribedMeals } from './food/PrescribedMeals';

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
        className="w-full flex items-center gap-3 bg-gradient-to-r from-gold/[0.14] to-gold-dark/[0.10] border border-gold/30 hover:border-gold/55 rounded-2xl px-4 py-3 transition-all active:scale-[0.99]">
        <span className="w-8 h-8 rounded-full bg-gradient-to-br from-gold to-gold-dark flex items-center justify-center text-sm flex-shrink-0 shadow-[0_0_14px_rgba(212,175,55,0.4)]">✨</span>
        <span className="text-left min-w-0">
          <span className="block text-sm font-bold text-white leading-tight">Log with AI Chat</span>
          <span className="block text-caption text-mute leading-tight truncate">Say your whole day — I'll fill the entire log</span>
        </span>
      </button>

      {/* Quick re-add strip — always visible when we have recent foods */}
      {recentFoods.length > 0 && !showForm && (
        <div>
          <p className="text-xs text-ghost font-semibold mb-2 tracking-wider">Quick re-add</p>
          <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            {recentFoods.slice(0,6).map((food, i) => {
              const kcal = food.per_100g?.calories ? Math.round(food.per_100g.calories * (food.last_g || 100) / 100) : null;
              return (
                <button key={i} onClick={() => { setShowForm(true); setTimeout(() => pickRecent(food), 100); }}
                  style={{ minHeight: 44, whiteSpace: 'nowrap', flexShrink: 0 }}
                  className="flex items-center gap-2 text-xs bg-surface border border-white/[0.10] hover:border-gold/40 rounded-xl px-3 py-2 transition-colors text-soft font-medium">
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
          <p className="text-xs font-bold text-ghost tracking-wider mb-1.5">
            Repeat into {meal}
          </p>
          <div className="flex flex-wrap gap-2">
            {yesterdayCount > 0 && (
              <button onClick={repeatYesterday} disabled={repeatBusy}
                style={{ minHeight: 36 }}
                className="px-3 rounded-xl text-xs font-semibold text-charcoal
                  bg-gradient-to-r from-gold-light via-gold to-gold-dark
                  active:scale-[0.98] disabled:opacity-50">
                {repeatBusy ? 'Adding…' : `Same as yesterday (${yesterdayCount})`}
              </button>
            )}
            {presets.map(p => (
              <span key={p.id}
                className="inline-flex items-center rounded-xl border border-gold/20
                  bg-gold/[0.08] overflow-hidden">
                <button onClick={() => addStoredItems(p.items, p.name)}
                  style={{ minHeight: 36 }}
                  className="px-3 text-xs font-semibold text-gold-light">
                  {p.name}
                  <span className="text-mid ml-1">
                    ({p.items?.length || 0})
                  </span>
                </button>
                <button onClick={() => removePreset(p.id)}
                  title={`Delete "${p.name}"`}
                  style={{ minWidth: 28, minHeight: 36 }}
                  className="text-lo hover:text-red-400 text-sm border-l border-gold/[0.18]">
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
              className="mt-2 text-caption font-semibold text-gold">
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
                className="flex-1 min-w-0 px-3 py-2 bg-charcoal border border-white/[0.10]
                  rounded-xl text-sm text-white outline-none
                  focus:border-gold/40" />
              <button onClick={savePreset} disabled={!presetName.trim()}
                style={{ minHeight: 38 }}
                className="px-3 text-xs font-bold text-charcoal rounded-xl
                  bg-gradient-to-r from-gold-light via-gold to-gold-dark
                  disabled:opacity-40">
                Save
              </button>
              <button onClick={() => setSavingPreset(false)}
                style={{ minHeight: 38 }}
                className="px-3 text-xs font-bold text-mid border border-white/[0.10] rounded-xl">
                Cancel
              </button>
            </div>
          )}
          {repeatNote && (
            <p className="text-caption text-mid mt-1.5 leading-relaxed">{repeatNote}</p>
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
              <span className="text-xs font-bold text-ghost tracking-wider">{m}</span>
              {mealItems.length > 0 && (
                <>
                  <span className="text-xs text-ghost">{mealItems.reduce((s,i)=>s+i.grams,0).toFixed(0)}g</span>
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
              <p className="text-xs text-ghost italic px-2 py-1">Nothing logged yet</p>
            ) : (
              <div className="space-y-1">
                {mealItems.map((item) => {
                  const n = calcMacros(item);
                  return (
                    <div key={item.id} className="py-2 px-3 rounded-xl bg-surface border border-white/[0.05]">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-medium text-soft truncate">{item.name}</span>
                          <span className="text-xs font-semibold text-gold-deep flex-shrink-0">{item.grams}g</span>
                        </div>
                        {/* Always-visible remove button */}
                        <button onClick={() => remove(item.id)}
                          style={{ minWidth: 32, minHeight: 32 }}
                          className="flex items-center justify-center rounded-full text-ghost hover:text-red-400 hover:bg-red-400/10 transition-all ml-2 flex-shrink-0"
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
            <span className="text-xs font-bold text-ghost tracking-wider">Day total</span>
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
          className="w-full py-3 rounded-2xl border-2 border-dashed border-gold/30 text-gold-deep text-sm font-semibold hover:bg-gold/5 hover:border-gold/50 active:scale-98 transition-all">
          + Add food item
        </button>
      ) : (
        <div className="bg-surface rounded-2xl p-3 space-y-3 border border-hair">

          {/* Meal selector */}
          <div className="flex gap-1.5 flex-wrap">
            {mealSlots.map((m) => (
              <button key={m} onClick={() => setMeal(m)}
                style={{ minHeight: 36 }}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  meal === m ? 'bg-gold text-charcoal shadow-sm' : 'bg-white/[0.05] text-mute hover:bg-white/[0.10]'
                }`}>{m}</button>
            ))}
          </div>

          {/* Recent foods inside form */}
          {recentFoods.length > 0 && !query && (
            <div>
              <p className="text-xs text-ghost font-medium mb-1.5">Recently used</p>
              <div className="flex flex-wrap gap-1.5">
                {recentFoods.slice(0,5).map((food, i) => {
                  const kcal = food.per_100g?.calories ? Math.round(food.per_100g.calories * (food.last_g || 100) / 100) : null;
                  return (
                    <button key={i} onClick={() => pickRecent(food)}
                      style={{ minHeight: 36 }}
                      className="flex items-center gap-1.5 text-xs bg-surface border border-white/[0.10] hover:border-gold/40 rounded-xl px-2.5 py-1.5 transition-colors text-soft font-medium">
                      <span className="truncate max-w-[100px]">{food.name}</span>
                      <span className="text-faint">{food.last_g}g</span>
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
                className="flex-1 px-3 py-2.5 rounded-xl border border-white/[0.12] text-sm bg-charcoal focus:outline-none focus:ring-2 focus:ring-gold/30 text-bright font-medium"
                autoFocus />
              {hasBarcodeDetector && (
                <button onClick={() => { haptic(15); setScanning(true); }}
                  style={{ width: 44, height: 44, minWidth: 44 }}
                  className="rounded-xl flex items-center justify-center border bg-white/[0.06] border-white/[0.1] text-faint hover:text-mute"
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
                    : 'bg-white/[0.06] border-white/[0.1] text-faint hover:text-mute'
                }`}
                title="Voice input">
                🎤
              </button>
              {searching && (
                <div className="absolute right-14 top-1/2 -translate-y-1/2">
                  <div className="w-4 h-4 border-2 border-gold/30 border-t-gold rounded-full animate-spin" />
                </div>
              )}
              {selected && !searching && (
                <span className="absolute right-14 top-1/2 -translate-y-1/2 text-gold-deep text-sm font-bold">✓</span>
              )}
            </div>
            {listening && (
              <div className="mt-1 text-xs text-red-400 font-medium px-1">🎤 Listening… tap again when done</div>
            )}
            {voice.transcribing && (
              <div className="mt-1 text-xs text-gold font-medium px-1">✨ Getting the exact words…</div>
            )}
            {voice.error && (
              <div className="mt-1 text-xs text-amber-400 font-medium px-1">{voice.error}</div>
            )}
            {scanMsg && (
              <div className="mt-1 text-xs text-gold font-medium px-1">{scanMsg}</div>
            )}
            {scanning && (
              <BarcodeScanner onFound={onBarcodeFound} onClose={() => setScanning(false)} />
            )}

            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-surface rounded-xl border border-white/[0.1] shadow-lg z-30 overflow-hidden"
                style={{ maxHeight: 240, overflowY: 'auto', overscrollBehavior: 'contain' }}>
                {suggestions.map((food) => (
                  <button key={food.id}
                    onMouseDown={(e) => e.preventDefault()}
                    onTouchStart={(e) => e.preventDefault()}
                    onClick={() => pickSuggestion(food)}
                    style={{ minHeight: 44 }}
                    className="w-full text-left px-3 py-2.5 hover:bg-gold/[0.08] active:bg-gold/15 transition-colors border-b border-white/[0.05] last:border-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-soft font-medium truncate">{food.name}</span>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {food.verified && (
                          <span className="text-xs bg-gold/[0.12] text-gold px-1.5 py-0.5 rounded font-semibold">✓</span>
                        )}
                        <span className="text-xs font-bold text-orange-400">{food.per_100g?.calories || 0} kcal</span>
                      </div>
                    </div>
                    {food.name_local && food.name_local !== food.name && (
                      <div className="text-xs text-faint mt-0.5">{food.name_local}</div>
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
                {lookupStatus === 'loading'  && <p className="text-xs text-faint px-1">Searching Open Food Facts…</p>}
                {lookupStatus === 'found'    && <p className="text-xs text-gold-deep px-1 font-semibold">✓ Found on Open Food Facts</p>}
                {lookupStatus === 'notfound' && <p className="text-xs text-faint px-1">Not found — searching AI…</p>}
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
                  <span className="text-xs font-semibold text-ok">✨ AI Food Identifier</span>
                  <button onClick={() => setShowAI(false)}
                    className="text-xs text-faint hover:text-soft">✕ close</button>
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
            <div className="bg-charcoal rounded-xl border border-gold/20 px-3 py-2">
              <p className="text-xs text-faint mb-1">Per 100g — {selected.name}</p>
              <div className="flex gap-3 flex-wrap">
                <span className="text-xs font-bold text-orange-400">{selected.per_100g.calories || 0} kcal</span>
                <span className="text-xs text-blue-400">P {selected.per_100g.protein || 0}g</span>
                <span className="text-xs text-amber-400">C {selected.per_100g.net_carbs ?? selected.per_100g.total_carbs ?? 0}g net</span>
                <span className="text-xs text-amber-400">F {selected.per_100g.fat || 0}g</span>
                {!selected.verified && <span className="text-xs text-faint italic">unverified</span>}
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
                className="w-full px-3 py-2.5 pr-8 rounded-xl border border-white/[0.12] text-sm bg-charcoal focus:outline-none focus:ring-2 focus:ring-gold/30 text-bright" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ghost">g</span>
            </div>
            <button onClick={add} disabled={!query.trim() || !grams}
              style={{ minHeight: 44 }}
              className="px-4 py-2.5 bg-gold hover:bg-gold disabled:opacity-40 text-charcoal text-sm font-bold rounded-xl transition-all active:scale-95">
              Add
            </button>
            <button onClick={closeForm}
              style={{ minWidth: 44, minHeight: 44 }}
              className="px-3 py-2.5 text-ghost hover:text-mute text-lg leading-none"
              aria-label="Close">×</button>
          </div>
        </div>
      )}
    </div>
  );
}
