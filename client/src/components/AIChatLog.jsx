/**
 * AIChatLog.jsx  (v2 — full-day logging, premium layout)
 *
 * One message logs the whole day:
 *   "weight 82.5, morning walk done, 2 chapati and dal for lunch,
 *    acv before meal 2, 1 litre water, took b12 and d3, slept 10:30 to 6:30"
 *
 * The AI parses it into weight, activity/ACV/supplement checkboxes, water,
 * sleep and food items. The reply shows grouped preview cards — every item
 * is a toggle chip the member can untick if misheard — then ONE "Apply to
 * today's log" tap writes everything through the log store and saves.
 * After applying: success card with what's still pending today + Undo.
 *
 * Self-sufficient: reads/writes useLogStore directly (log, protocol,
 * updateLog, saveLog) — no prop drilling. Open state lives in its own tiny
 * store (useAIChat) so both the FoodLog banner and the floating ✨ button
 * on DailyLog open the same instance.
 *
 * Mount ONCE per page (DailyLog does this). Open from anywhere with:
 *   import { useAIChat } from './AIChatLog';
 *   const openChat = useAIChat(s => s.openChat);
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { create } from 'zustand';
import api from '../api/client';
import { useLogStore } from '../store/logStore';
import { useSettingsStore, haptic } from '../store/settingsStore';
import { ACTIVITIES, ACV_ITEMS, SUPPLEMENTS } from '../constants';

// ── Shared open/close store — FoodLog banner + DailyLog FAB both use this ────
export const useAIChat = create((set) => ({
  open: false,
  openChat:  () => set({ open: true }),
  closeChat: () => set({ open: false }),
}));

// ── Speech recognition ───────────────────────────────────────────────────────
const SpeechRecognition =
  typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

const SUGGESTION_CHIPS = [
  'weight 82.5, morning walk done',
  '2 chapati, 1 bowl dal for lunch',
  'drank 1 litre water, took my supplements',
  'slept 10:30 to 6:30',
];

// ── Protocol derivation — same logic as DailyLog ─────────────────────────────
function deriveProtocolItems(protocol) {
  const overrides = protocol?.item_overrides || {};
  const applyOverride = (item) => {
    const ov = overrides[item.id];
    if (!ov) return item;
    const timing = [ov.fromTime, ov.toTime].filter(Boolean).join('–');
    const sub    = [ov.totalTime, timing].filter(Boolean).join(' · ') || ov.sub || item.sub || '';
    return { ...item, label: ov.label || item.label, sub };
  };
  const allActivities  = [...ACTIVITIES,  ...(protocol?.custom_activities  || [])].map(applyOverride);
  const allACV         = [...ACV_ITEMS,   ...(protocol?.custom_acv         || [])].map(applyOverride);
  const allSupplements = [...SUPPLEMENTS, ...(protocol?.custom_supplements || [])].map(applyOverride);
  return {
    activities:  allActivities.filter(a  => !protocol?.activities  || protocol.activities.includes(a.id)),
    acv:         allACV.filter(a         => !protocol?.acv         || protocol.acv.includes(a.id)),
    supplements: allSupplements.filter(s => !protocol?.supplements || protocol.supplements.includes(s.id)),
  };
}

// ── Small UI atoms ───────────────────────────────────────────────────────────
function GroupHeader({ icon, title, count }) {
  return (
    <div className="flex items-center gap-1.5 mb-1.5">
      <span className="text-xs">{icon}</span>
      <span className="text-[10px] font-bold text-[#8e8e9a] uppercase tracking-widest">{title}</span>
      {count != null && <span className="text-[10px] text-[#4e4e5c]">· {count}</span>}
    </div>
  );
}

/** Tappable include/exclude chip — purple when included, dimmed when excluded */
function ToggleChip({ on, onToggle, children }) {
  return (
    <button onClick={onToggle}
      style={{ minHeight: 36 }}
      className={`flex items-center gap-1.5 text-xs rounded-full px-3 py-1.5 border transition-all active:scale-95 ${
        on
          ? 'bg-[#7c5cfc]/[0.16] border-[#7c5cfc]/45 text-white font-semibold'
          : 'bg-white/[0.03] border-white/[0.08] text-[#4e4e5c] line-through'
      }`}>
      <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] flex-shrink-0 ${
        on ? 'bg-[#7c5cfc] text-white' : 'bg-white/[0.08] text-transparent'
      }`}>✓</span>
      {children}
    </button>
  );
}

export default function AIChatLog() {
  const open      = useAIChat(s => s.open);
  const closeChat = useAIChat(s => s.closeChat);

  const mealSlots = useSettingsStore(s => s.mealSlots);

  const [messages, setMessages]   = useState([]);
  const [input, setInput]         = useState('');
  const [busy, setBusy]           = useState(false);
  const [listening, setListening] = useState(false);

  const bottomRef = useRef(null);
  const inputRef  = useRef(null);
  const recogRef  = useRef(null);
  const undoRef   = useRef(null);   // snapshot of log fields before last apply

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 250);
  }, [open]);

  // ── Voice input ────────────────────────────────────────────────────────────
  const toggleVoice = useCallback(() => {
    if (!SpeechRecognition) return;
    if (listening) { recogRef.current?.stop(); setListening(false); return; }
    const r = new SpeechRecognition();
    recogRef.current = r;
    r.lang = 'en-IN';
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      const text = e.results[0][0].transcript;
      setInput(prev => (prev ? prev + ' ' + text : text));
      setListening(false);
    };
    r.onerror = () => setListening(false);
    r.onend   = () => setListening(false);
    setListening(true);
    haptic(15);
    r.start();
  }, [listening]);

  // ── Send → parse ───────────────────────────────────────────────────────────
  const send = useCallback(async (textOverride) => {
    const text = (textOverride ?? input).trim();
    if (!text || busy) return;

    setInput('');
    setMessages(m => [...m, { role: 'user', text }]);
    setBusy(true);
    haptic(10);

    try {
      const proto = deriveProtocolItems(useLogStore.getState().protocol);
      const { data } = await api.post('/ai-chat/parse', {
        message: text,
        context: {
          mealSlots,
          activities:    proto.activities.map(({ id, label, sub }) => ({ id, label, sub })),
          acv:           proto.acv.map(({ id, label, sub }) => ({ id, label, sub })),
          supplements:   proto.supplements.map(({ id, label, sub }) => ({ id, label, sub })),
          waterTargetMl: useLogStore.getState().protocol?.water_target || 3000,
        },
      });

      // Every parsed thing starts INCLUDED — member unticks anything misheard
      setMessages(m => [...m, {
        role: 'ai',
        text: data.reply,
        parsed: {
          weight_kg:    data.weight_kg,
          weightOn:     data.weight_kg != null,
          activities:   (data.activities  || []).map(a => ({ ...a, on: true })),
          acv:          (data.acv         || []).map(a => ({ ...a, on: true })),
          supplements:  (data.supplements || []).map(s => ({ ...s, on: true })),
          water_ml_add: data.water_ml_add,
          waterOn:      data.water_ml_add != null,
          sleep:        data.sleep,
          sleepOn:      !!data.sleep,
          foods:        (data.foods || []).map(f => ({ ...f, on: true })),
          workouts:     data.workouts || [],
          totals:       data.totals,
        },
        applied: false,
      }]);
    } catch (err) {
      const msg = err.response?.data?.error || 'Something went wrong — please try again.';
      setMessages(m => [...m, { role: 'ai', text: msg, error: true }]);
    } finally {
      setBusy(false);
    }
  }, [input, busy, mealSlots]);

  // ── Toggle helpers on a message's parsed preview ───────────────────────────
  const patchParsed = useCallback((mi, patchFn) => {
    setMessages(prev => {
      const next = [...prev];
      const msg = next[mi];
      if (!msg?.parsed || msg.applied) return prev;
      next[mi] = { ...msg, parsed: patchFn(msg.parsed) };
      return next;
    });
  }, []);

  const toggleListItem = (mi, key, idx) =>
    patchParsed(mi, p => ({
      ...p,
      [key]: p[key].map((it, i) => (i === idx ? { ...it, on: !it.on } : it)),
    }));

  // ── What's still pending after applying — the "coach nudge" ────────────────
  const computePending = useCallback((newLog) => {
    const proto  = deriveProtocolItems(useLogStore.getState().protocol);
    const target = useLogStore.getState().protocol?.water_target || 3000;
    const pending = [];

    if (!newLog.weight) pending.push('morning weight');
    const actLeft = proto.activities.filter(a => !newLog.activities?.[a.id]).length;
    if (actLeft > 0) pending.push(`${actLeft} activit${actLeft > 1 ? 'ies' : 'y'}`);
    const acvLeft = proto.acv.filter(a => !newLog.acv?.[a.id]).length;
    if (acvLeft > 0) pending.push(`${acvLeft} ACV dose${acvLeft > 1 ? 's' : ''}`);
    const suppLeft = proto.supplements.filter(s => !newLog.supplements?.[s.id]).length;
    if (suppLeft > 0) pending.push(`${suppLeft} supplement${suppLeft > 1 ? 's' : ''}`);
    if ((newLog.water || 0) < target) pending.push(`water (${((target - (newLog.water || 0)) / 1000).toFixed(1)}L to go)`);
    if (!newLog.food?.length) pending.push('food log');
    if (!newLog.sleep?.bedtime || !newLog.sleep?.waketime) pending.push('sleep times');

    return pending.slice(0, 3);
  }, []);

  // ── Apply everything included to today's log ───────────────────────────────
  const applyAll = useCallback(async (mi) => {
    const msg = messages[mi];
    if (!msg?.parsed || msg.applied) return;
    const p = msg.parsed;

    const { log: cur, updateLog, saveLog } = useLogStore.getState();

    // Snapshot for undo
    undoRef.current = {
      weight: cur.weight, activities: cur.activities, acv: cur.acv,
      supplements: cur.supplements, water: cur.water, sleep: cur.sleep,
      food: cur.food,
    };

    const newLog = { ...cur };

    if (p.weightOn && p.weight_kg != null) {
      newLog.weight = String(p.weight_kg);
      updateLog('weight', newLog.weight);
    }
    const onIds = (list) => list.filter(i => i.on).map(i => i.id);
    if (onIds(p.activities).length) {
      newLog.activities = { ...cur.activities };
      onIds(p.activities).forEach(id => { newLog.activities[id] = true; });
      updateLog('activities', newLog.activities);
    }
    if (onIds(p.acv).length) {
      newLog.acv = { ...cur.acv };
      onIds(p.acv).forEach(id => { newLog.acv[id] = true; });
      updateLog('acv', newLog.acv);
    }
    if (onIds(p.supplements).length) {
      newLog.supplements = { ...cur.supplements };
      onIds(p.supplements).forEach(id => { newLog.supplements[id] = true; });
      updateLog('supplements', newLog.supplements);
    }
    if (p.waterOn && p.water_ml_add) {
      newLog.water = Math.min(10000, (cur.water || 0) + p.water_ml_add);
      updateLog('water', newLog.water);
    }
    if (p.sleepOn && p.sleep) {
      newLog.sleep = {
        ...cur.sleep,
        ...(p.sleep.bedtime  ? { bedtime:  p.sleep.bedtime }  : {}),
        ...(p.sleep.waketime ? { waketime: p.sleep.waketime } : {}),
      };
      updateLog('sleep', newLog.sleep);
    }
    const foodsOn = p.foods.filter(f => f.on);
    if (foodsOn.length) {
      const baseId = Date.now();
      const newItems = foodsOn.map((f, i) => ({
        id:       baseId + i,
        name:     f.name,
        grams:    f.grams,
        meal:     (f.meal && mealSlots.includes(f.meal)) ? f.meal : (mealSlots[0] || 'Meal 1'),
        food_id:  f.food_id || null,
        per_100g: f.per_100g && (f.per_100g.calories || 0) > 0 ? f.per_100g : null,
      }));
      newLog.food = [...(cur.food || []), ...newItems];
      updateLog('food', newLog.food);
    }

    haptic(30);
    saveLog().catch(() => {});

    setMessages(prev => {
      const next = [...prev];
      next[mi] = { ...next[mi], applied: true, pending: computePending(newLog) };
      return next;
    });
  }, [messages, mealSlots, computePending]);

  // ── Undo last apply ────────────────────────────────────────────────────────
  const undo = useCallback((mi) => {
    const snap = undoRef.current;
    if (!snap) return;
    const { updateLog, saveLog } = useLogStore.getState();
    Object.entries(snap).forEach(([field, val]) => updateLog(field, val));
    undoRef.current = null;
    haptic(20);
    saveLog().catch(() => {});
    setMessages(prev => {
      const next = [...prev];
      next[mi] = { ...next[mi], applied: false, undone: true, pending: null };
      return next;
    });
  }, []);

  if (!open) return null;

  // Count of included things across a parsed preview
  const countIncluded = (p) =>
    (p.weightOn && p.weight_kg != null ? 1 : 0) +
    p.activities.filter(a => a.on).length +
    p.acv.filter(a => a.on).length +
    p.supplements.filter(s => s.on).length +
    (p.waterOn && p.water_ml_add ? 1 : 0) +
    (p.sleepOn && p.sleep ? 1 : 0) +
    p.foods.filter(f => f.on).length;

  return (
    <div className="fixed inset-0 z-[70] bg-[#0d0d11] flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)' }}>

      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06] bg-[#111116]">
        <button onClick={closeChat}
          style={{ minWidth: 44, minHeight: 44 }}
          className="flex items-center justify-center rounded-full text-[#8e8e9a] hover:text-white hover:bg-white/[0.06] transition-colors">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#7c5cfc] to-[#4c2fd8] flex items-center justify-center text-sm shadow-[0_0_16px_rgba(124,92,252,0.45)]">✨</div>
          <div>
            <p className="text-sm font-bold text-white leading-tight">FitLife AI</p>
            <p className="text-[10px] text-[#4e4e5c] leading-tight">Log your whole day in one message</p>
          </div>
        </div>
      </div>

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

        {messages.length === 0 && (
          <div className="bg-[#16161c] border border-white/[0.07] rounded-2xl p-4">
            <p className="text-sm font-semibold text-white mb-1.5">Hi! Tell me about your day 🌤</p>
            <p className="text-xs text-[#8e8e9a] leading-relaxed mb-3">
              Weight, walks, meals, ACV, water, supplements, sleep — say it all in
              one message and I'll fill your entire log. Review, then tap Apply.
            </p>
            <div className="bg-[#0d0d11] border border-white/[0.06] rounded-xl px-3 py-2.5">
              <p className="text-[11px] text-[#b6b6c2] leading-relaxed italic">
                "weight 82.5, morning walk done, 2 chapati and dal for lunch,
                acv before meal 2, drank 1 litre water, took my supplements,
                slept 10:30 to 6:30"
              </p>
            </div>
          </div>
        )}

        {messages.map((m, mi) => (
          m.role === 'user' ? (
            <div key={mi} className="flex justify-end">
              <div className="max-w-[85%] bg-[#7c5cfc] text-white text-sm rounded-2xl rounded-br-md px-4 py-2.5 shadow-sm">
                {m.text}
              </div>
            </div>
          ) : (
            <div key={mi} className="flex justify-start">
              <div className="max-w-[94%] w-full">
                <div className={`text-sm rounded-2xl rounded-bl-md px-4 py-3 border ${
                  m.error
                    ? 'bg-red-500/[0.08] border-red-500/25 text-red-300'
                    : 'bg-[#16161c] border-white/[0.07] text-[#d8d8de]'
                }`}>
                  <p className="leading-relaxed">{m.text}</p>

                  {m.parsed && countIncluded(m.parsed) + m.parsed.workouts.length > 0 && (
                    <div className="mt-3 space-y-3">

                      {/* ⚖ Weight */}
                      {m.parsed.weight_kg != null && (
                        <div>
                          <GroupHeader icon="⚖️" title="Morning weight" />
                          <ToggleChip on={m.parsed.weightOn}
                            onToggle={() => patchParsed(mi, p => ({ ...p, weightOn: !p.weightOn }))}>
                            {m.parsed.weight_kg} kg
                          </ToggleChip>
                        </div>
                      )}

                      {/* 🏃 Activities */}
                      {m.parsed.activities.length > 0 && (
                        <div>
                          <GroupHeader icon="🏃" title="Activities" count={m.parsed.activities.filter(a => a.on).length} />
                          <div className="flex flex-wrap gap-1.5">
                            {m.parsed.activities.map((a, i) => (
                              <ToggleChip key={a.id} on={a.on} onToggle={() => toggleListItem(mi, 'activities', i)}>
                                {a.label}
                              </ToggleChip>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 🧃 ACV */}
                      {m.parsed.acv.length > 0 && (
                        <div>
                          <GroupHeader icon="🧃" title="ACV" count={m.parsed.acv.filter(a => a.on).length} />
                          <div className="flex flex-wrap gap-1.5">
                            {m.parsed.acv.map((a, i) => (
                              <ToggleChip key={a.id} on={a.on} onToggle={() => toggleListItem(mi, 'acv', i)}>
                                {a.label}
                              </ToggleChip>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 💊 Supplements */}
                      {m.parsed.supplements.length > 0 && (
                        <div>
                          <GroupHeader icon="💊" title="Supplements" count={m.parsed.supplements.filter(s => s.on).length} />
                          <div className="flex flex-wrap gap-1.5">
                            {m.parsed.supplements.map((s, i) => (
                              <ToggleChip key={s.id} on={s.on} onToggle={() => toggleListItem(mi, 'supplements', i)}>
                                {s.label}
                              </ToggleChip>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 💧 Water */}
                      {m.parsed.water_ml_add != null && (
                        <div>
                          <GroupHeader icon="💧" title="Water" />
                          <ToggleChip on={m.parsed.waterOn}
                            onToggle={() => patchParsed(mi, p => ({ ...p, waterOn: !p.waterOn }))}>
                            +{m.parsed.water_ml_add >= 1000
                              ? `${(m.parsed.water_ml_add / 1000).toFixed(m.parsed.water_ml_add % 1000 ? 2 : 0)}L`
                              : `${m.parsed.water_ml_add}ml`}
                          </ToggleChip>
                        </div>
                      )}

                      {/* 🌙 Sleep */}
                      {m.parsed.sleep && (
                        <div>
                          <GroupHeader icon="🌙" title="Sleep" />
                          <ToggleChip on={m.parsed.sleepOn}
                            onToggle={() => patchParsed(mi, p => ({ ...p, sleepOn: !p.sleepOn }))}>
                            {m.parsed.sleep.bedtime || '—'} → {m.parsed.sleep.waketime || '—'}
                          </ToggleChip>
                        </div>
                      )}

                      {/* 🥗 Foods */}
                      {m.parsed.foods.length > 0 && (
                        <div>
                          <GroupHeader icon="🥗" title="Food" count={m.parsed.foods.filter(f => f.on).length} />
                          <div className="space-y-1.5">
                            {m.parsed.foods.map((f, fi) => (
                              <button key={fi} onClick={() => toggleListItem(mi, 'foods', fi)}
                                className={`w-full text-left bg-[#0d0d11] border rounded-xl px-3 py-2.5 transition-all active:scale-[0.99] ${
                                  f.on ? 'border-white/[0.08]' : 'border-white/[0.04] opacity-40'
                                }`}>
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] flex-shrink-0 ${
                                      f.on ? 'bg-[#7c5cfc] text-white' : 'bg-white/[0.08] text-transparent'
                                    }`}>✓</span>
                                    <div className="min-w-0">
                                      <p className={`text-[13px] font-semibold truncate ${f.on ? 'text-white' : 'text-[#8e8e9a] line-through'}`}>
                                        {f.name}
                                      </p>
                                      <p className="text-[11px] text-[#4e4e5c]">
                                        {f.qty_text ? `${f.qty_text} · ` : ''}{f.grams}g · {f.meal || 'Meal 1'}
                                        {f.source === 'db-verified' && <span className="text-emerald-400"> · verified</span>}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="text-right flex-shrink-0">
                                    <p className="text-[13px] font-bold text-orange-400">{f.macros?.cal ?? 0} kcal</p>
                                    <p className="text-[10px] text-[#8e8e9a]">
                                      P {f.macros?.pro ?? 0} · C {f.macros?.carb ?? 0} · F {f.macros?.fat ?? 0}
                                    </p>
                                  </div>
                                </div>
                              </button>
                            ))}
                            {m.parsed.totals && m.parsed.foods.filter(f => f.on).length > 1 && (
                              <div className="flex items-center justify-between px-3 py-2 bg-[#7c5cfc]/[0.10] border border-[#7c5cfc]/25 rounded-xl">
                                <span className="text-[11px] font-bold text-[#a78bfa] uppercase tracking-wider">Food total</span>
                                <span className="text-[13px] font-bold text-white">
                                  {m.parsed.foods.filter(f => f.on).reduce((s, f) => s + (f.macros?.cal || 0), 0)} kcal
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* 💪 Workouts — info only */}
                      {m.parsed.workouts.length > 0 && (
                        <div>
                          <GroupHeader icon="💪" title="Workouts noted" />
                          <div className="space-y-1.5">
                            {m.parsed.workouts.map((w, wi) => (
                              <div key={wi} className="flex items-center justify-between bg-[#0d0d11] border border-white/[0.06] rounded-xl px-3 py-2">
                                <p className="text-[12px] text-[#d8d8de]">
                                  {w.name}{w.qty_text ? ` — ${w.qty_text}` : ''}
                                </p>
                                {w.calories_burned != null && (
                                  <p className="text-[11px] font-semibold text-emerald-400">~{w.calories_burned} kcal</p>
                                )}
                              </div>
                            ))}
                            <p className="text-[10px] text-[#4e4e5c] px-1">
                              Log sets & reps in the Workout section.
                            </p>
                          </div>
                        </div>
                      )}

                      {/* ── Apply / Applied / Undo ── */}
                      {countIncluded(m.parsed) > 0 && !m.applied && !m.undone && (
                        <button onClick={() => applyAll(mi)}
                          style={{ minHeight: 48 }}
                          className="w-full rounded-xl text-sm font-bold bg-gradient-to-r from-[#7c5cfc] to-[#6344e8] text-white hover:from-[#8b6dff] hover:to-[#7c5cfc] active:scale-[0.98] shadow-[0_2px_16px_rgba(124,92,252,0.4)] transition-all">
                          Apply {countIncluded(m.parsed)} item{countIncluded(m.parsed) > 1 ? 's' : ''} to today's log
                        </button>
                      )}

                      {m.applied && (
                        <div className="bg-emerald-500/[0.08] border border-emerald-500/25 rounded-xl px-3.5 py-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="text-[13px] font-bold text-emerald-400">✓ Applied & saved</p>
                            <button onClick={() => undo(mi)}
                              className="text-[11px] font-semibold text-[#8e8e9a] hover:text-white underline underline-offset-2 transition-colors">
                              Undo
                            </button>
                          </div>
                          {m.pending?.length > 0 ? (
                            <p className="text-[11px] text-[#b6b6c2] leading-relaxed">
                              Still pending today: {m.pending.join(' · ')}
                            </p>
                          ) : (
                            <p className="text-[11px] text-[#b6b6c2]">Everything's logged for today — great job! 🎉</p>
                          )}
                        </div>
                      )}

                      {m.undone && (
                        <p className="text-[11px] text-[#8e8e9a] text-center">Changes reverted.</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        ))}

        {busy && (
          <div className="flex justify-start">
            <div className="bg-[#16161c] border border-white/[0.07] rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#7c5cfc] animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-[#7c5cfc] animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-[#7c5cfc] animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Suggestion chips ── */}
      {messages.length === 0 && (
        <div className="px-4 pb-2 flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {SUGGESTION_CHIPS.map((chip, i) => (
            <button key={i} onClick={() => send(chip)}
              style={{ whiteSpace: 'nowrap', flexShrink: 0, minHeight: 36 }}
              className="text-xs bg-[#1a1a20] border border-white/[0.10] hover:border-[rgba(124,92,252,0.4)] rounded-full px-3.5 py-1.5 text-[#b6b6c2] transition-colors">
              {chip}
            </button>
          ))}
        </div>
      )}

      {/* ── Input bar ── */}
      <div className="px-4 py-3 border-t border-white/[0.06] bg-[#111116]"
        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
        <div className="flex items-end gap-2">
          <div className="flex-1 flex items-center bg-[#1a1a20] border border-white/[0.10] rounded-2xl px-3">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
              placeholder="Eg: weight 82.5, walk done, 2 chapati for lunch"
              className="flex-1 bg-transparent text-sm text-white placeholder-[#4e4e5c] py-3 outline-none min-w-0"
            />
            {SpeechRecognition && (
              <button onClick={toggleVoice}
                style={{ minWidth: 40, minHeight: 40 }}
                className={`flex items-center justify-center rounded-full transition-colors flex-shrink-0 ${
                  listening ? 'text-red-400 animate-pulse' : 'text-[#8e8e9a] hover:text-[#a78bfa]'
                }`}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              </button>
            )}
          </div>
          <button
            onClick={() => send()}
            disabled={!input.trim() || busy}
            style={{ minWidth: 48, minHeight: 48 }}
            className={`flex items-center justify-center rounded-full transition-all flex-shrink-0 ${
              input.trim() && !busy
                ? 'bg-[#7c5cfc] text-white shadow-[0_2px_12px_rgba(124,92,252,0.4)] active:scale-95'
                : 'bg-white/[0.05] text-[#4e4e5c]'
            }`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
