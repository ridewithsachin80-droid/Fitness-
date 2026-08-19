/**
 * AIChatLog.jsx — Fittr-style AI chat for natural-language food logging.
 *
 * Member types "2 chapati, 1 bowl dal, 1 glass milk" (or uses the mic),
 * the server AI parses every item with grams + nutrition, and one tap
 * on "Add to log" appends everything to the day's food_items via the
 * same onChange the FoodLog uses — so autosave, NutritionSummary and
 * compliance all keep working exactly as before.
 *
 * Props:
 *   open        bool      — show/hide the full-screen chat
 *   onClose     fn()      — close the chat
 *   items       array     — current log.food array
 *   onChange    fn(arr)   — same handler FoodLog uses (update('food', v))
 *   currentMeal string    — meal slot currently selected in FoodLog
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import api from '../api/client';
import { useSettingsStore, haptic } from '../store/settingsStore';

// ── Speech recognition (same approach as FoodLog voice input) ────────────────
const SpeechRecognition =
  typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

const SUGGESTION_CHIPS = [
  '2 chapati and 1 bowl dal',
  '3 idli with sambar',
  '1 glass milk and 2 boiled eggs',
  '1 plate rice, chicken curry',
];

export default function AIChatLog({ open, onClose, items = [], onChange, currentMeal }) {
  const mealSlots = useSettingsStore(s => s.mealSlots);

  const [messages, setMessages] = useState([]);   // {role:'user'|'ai', text, foods?, workouts?, totals?, added?}
  const [input, setInput]       = useState('');
  const [busy, setBusy]         = useState(false);
  const [listening, setListening] = useState(false);

  const bottomRef = useRef(null);
  const inputRef  = useRef(null);
  const recogRef  = useRef(null);
  // Ref mirror of items — the "Add" button inside an old message must always
  // append to the LATEST food list, not the list captured when it rendered.
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 250);
  }, [open]);

  // ── Voice input ────────────────────────────────────────────────────────────
  const toggleVoice = useCallback(() => {
    if (!SpeechRecognition) return;
    if (listening) {
      recogRef.current?.stop();
      setListening(false);
      return;
    }
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

  // ── Send message → parse ───────────────────────────────────────────────────
  const send = useCallback(async (textOverride) => {
    const text = (textOverride ?? input).trim();
    if (!text || busy) return;

    setInput('');
    setMessages(m => [...m, { role: 'user', text }]);
    setBusy(true);
    haptic(10);

    try {
      const { data } = await api.post('/ai-chat/parse', { message: text, mealSlots });
      setMessages(m => [...m, {
        role: 'ai',
        text: data.reply,
        foods: data.foods || [],
        workouts: data.workouts || [],
        totals: data.totals,
        added: false,
      }]);
    } catch (err) {
      const msg = err.response?.data?.error || 'Something went wrong — please try again.';
      setMessages(m => [...m, { role: 'ai', text: msg, error: true }]);
    } finally {
      setBusy(false);
    }
  }, [input, busy, mealSlots]);

  // ── Add parsed foods to the daily log ──────────────────────────────────────
  const addToLog = useCallback((msgIndex) => {
    setMessages(prev => {
      const msg = prev[msgIndex];
      if (!msg || msg.added || !msg.foods?.length) return prev;

      const baseId = Date.now();
      const newItems = msg.foods.map((f, i) => ({
        id:       baseId + i,
        name:     f.name,
        grams:    f.grams,
        // AI-detected meal if it maps to a real slot, else the currently selected slot
        meal:     (f.meal && mealSlots.includes(f.meal)) ? f.meal : (currentMeal || mealSlots[0] || 'Meal 1'),
        food_id:  f.food_id || null,
        per_100g: f.per_100g && (f.per_100g.calories || 0) > 0 ? f.per_100g : null,
      }));

      onChange([...(itemsRef.current || []), ...newItems]);
      haptic(25);

      const next = [...prev];
      next[msgIndex] = { ...msg, added: true };
      return next;
    });
  }, [onChange, mealSlots, currentMeal]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-[#0d0d11] flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)' }}>

      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06] bg-[#111116]">
        <button onClick={onClose}
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
            <p className="text-[10px] text-[#4e4e5c] leading-tight">Type what you ate — I'll log it</p>
          </div>
        </div>
      </div>

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

        {/* Welcome card */}
        {messages.length === 0 && (
          <div className="bg-[#16161c] border border-white/[0.07] rounded-2xl p-4">
            <p className="text-sm font-semibold text-white mb-1.5">Hi! Tell me what you had 🍽</p>
            <p className="text-xs text-[#8e8e9a] leading-relaxed mb-3">
              Type your meals in plain words — with quantities — and I'll calculate
              calories, protein, carbs and fat, then add everything to your food log.
            </p>
            <div className="space-y-1.5 text-xs text-[#b6b6c2]">
              <p><span className="font-bold text-[#a78bfa]">Log</span> "2 chapati, 1 katori dal, salad"</p>
              <p><span className="font-bold text-[#a78bfa]">Log</span> "breakfast: 3 idli with sambar and coffee"</p>
              <p><span className="font-bold text-[#a78bfa]">Log</span> "1 scoop whey in 200ml milk"</p>
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
              <div className="max-w-[92%] w-full">
                <div className={`text-sm rounded-2xl rounded-bl-md px-4 py-3 border ${
                  m.error
                    ? 'bg-red-500/[0.08] border-red-500/25 text-red-300'
                    : 'bg-[#16161c] border-white/[0.07] text-[#d8d8de]'
                }`}>
                  <p className="leading-relaxed">{m.text}</p>

                  {/* Parsed food items */}
                  {m.foods?.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {m.foods.map((f, fi) => (
                        <div key={fi} className="bg-[#0d0d11] border border-white/[0.06] rounded-xl px-3 py-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-[13px] font-semibold text-white truncate">{f.name}</p>
                              <p className="text-[11px] text-[#4e4e5c]">
                                {f.qty_text ? `${f.qty_text} · ` : ''}{f.grams}g
                                {f.source === 'db-verified' && <span className="text-emerald-400"> · verified</span>}
                              </p>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className="text-[13px] font-bold text-orange-400">{f.macros?.cal ?? 0} kcal</p>
                              <p className="text-[10px] text-[#8e8e9a]">
                                P {f.macros?.pro ?? 0} · C {f.macros?.carb ?? 0} · F {f.macros?.fat ?? 0}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}

                      {/* Totals row */}
                      {m.totals && m.foods.length > 1 && (
                        <div className="flex items-center justify-between px-3 py-2 bg-[#7c5cfc]/[0.10] border border-[#7c5cfc]/25 rounded-xl">
                          <span className="text-[11px] font-bold text-[#a78bfa] uppercase tracking-wider">Total</span>
                          <span className="text-[13px] font-bold text-white">
                            {m.totals.cal} kcal
                            <span className="text-[10px] font-medium text-[#8e8e9a] ml-2">
                              P {m.totals.pro} · C {m.totals.carb} · F {m.totals.fat}
                            </span>
                          </span>
                        </div>
                      )}

                      {/* Add button */}
                      <button
                        onClick={() => addToLog(mi)}
                        disabled={m.added}
                        style={{ minHeight: 44 }}
                        className={`w-full rounded-xl text-sm font-bold transition-all ${
                          m.added
                            ? 'bg-emerald-500/[0.12] text-emerald-400 border border-emerald-500/25 cursor-default'
                            : 'bg-[#7c5cfc] text-white hover:bg-[#8b6dff] active:scale-[0.98] shadow-[0_2px_12px_rgba(124,92,252,0.35)]'
                        }`}>
                        {m.added
                          ? '✓ Added to food log'
                          : `Add ${m.foods.length} item${m.foods.length > 1 ? 's' : ''} to log`}
                      </button>
                    </div>
                  )}

                  {/* Detected workouts — info only */}
                  {m.workouts?.length > 0 && (
                    <div className="mt-3 space-y-1.5">
                      {m.workouts.map((w, wi) => (
                        <div key={wi} className="flex items-center justify-between bg-[#0d0d11] border border-white/[0.06] rounded-xl px-3 py-2">
                          <p className="text-[12px] text-[#d8d8de]">
                            💪 {w.name}{w.qty_text ? ` — ${w.qty_text}` : ''}
                          </p>
                          {w.calories_burned != null && (
                            <p className="text-[11px] font-semibold text-emerald-400">~{w.calories_burned} kcal</p>
                          )}
                        </div>
                      ))}
                      <p className="text-[10px] text-[#4e4e5c] px-1">
                        Workouts shown for reference — log sets in the Workout section.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        ))}

        {/* Typing indicator */}
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

      {/* ── Suggestion chips (only before first message) ── */}
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
              placeholder='Eg: 2 chapati and 1 bowl dal'
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
