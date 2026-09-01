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
import { useVoiceComposer } from './VoiceComposer';
import { ACTIVITIES, ACV_ITEMS, SUPPLEMENTS, today, plural } from '../constants';
import DaySummary from './DaySummary';
import { isScaleWeightRow, routeLabRows } from '../utils/labRouting';

// ── Shared chat store — FoodLog banner + DailyLog FAB both use this ─────────
//
// The conversation lives HERE, not in component state. AIChatLog is mounted
// inside DailyLog, so tapping Progress unmounts it — and with `messages` in
// useState that destroyed the whole exchange, including any preview card the
// member had not applied yet. They then had to re-dictate the entire day.
//
// setMessages/setInput accept either a value or an updater function so every
// existing call site (`setMessages(m => [...m, x])`) works unchanged.
export const useAIChat = create((set, get) => ({
  open: false,
  openChat:  () => set({ open: true }),
  closeChat: () => set({ open: false }),

  messages: [],
  input: '',
  // The day the conversation belongs to. A preview parsed last night must not
  // be applicable to today's log after the date rolls over.
  dayKey: null,

  setMessages: (next) =>
    set((s) => ({ messages: typeof next === 'function' ? next(s.messages) : next })),
  setInput: (next) =>
    set((s) => ({ input: typeof next === 'function' ? next(s.input) : next })),

  /** Wipe the transcript — on logout, or when the day has rolled over. */
  resetChat: () => {
    undoSnap.current = null;
    workoutUndoSnap.current = null;
    set({ messages: [], input: '', dayKey: null });
  },

  /** Called when the panel opens; clears a conversation left over from a previous day. */
  ensureFreshDay: (todayKey) => {
    if (get().dayKey && get().dayKey !== todayKey) get().resetChat();
    set({ dayKey: todayKey });
  },
}));

// ── Pre-apply snapshots for Undo ─────────────────────────────────────────────
// Module-level rather than useRef for the same reason as the messages above:
// the component unmounts on navigation but the "Applied ✓ · Undo" card now
// survives, so the snapshot behind that Undo button has to survive with it.
// Without this, Undo would render as an active button and silently do nothing.
//
// Safe across accounts: authStore.logout() sets window.location.href, which is
// a full document load — this module is re-evaluated and both snapshots reset.
const undoSnap        = { current: null };
const workoutUndoSnap = { current: null };

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
      <span className="text-[10px] font-bold text-[#9EA3B0] uppercase tracking-widest">{title}</span>
      {count != null && <span className="text-[10px] text-[#7E8596]">· {count}</span>}
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
          ? 'bg-[#D4AF37]/[0.16] border-[#D4AF37]/45 text-white font-semibold'
          : 'bg-white/[0.03] border-white/[0.08] text-[#7E8596] line-through'
      }`}>
      <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] flex-shrink-0 ${
        on ? 'bg-[#D4AF37] text-[#121316]' : 'bg-white/[0.08] text-transparent'
      }`}>✓</span>
      {children}
    </button>
  );
}

export default function AIChatLog() {
  const open      = useAIChat(s => s.open);
  const closeChat = useAIChat(s => s.closeChat);

  const mealSlots = useSettingsStore(s => s.mealSlots);

  // Conversation state comes from the store (see useAIChat above) so it
  // survives the member navigating away from Today and back.
  const messages    = useAIChat(s => s.messages);
  const setMessages = useAIChat(s => s.setMessages);
  const input       = useAIChat(s => s.input);
  const setInput    = useAIChat(s => s.setInput);

  // Transient UI state stays local — a half-finished upload is not worth
  // resuming across a navigation, and leaving `busy` true in the store would
  // strand the composer permanently if the member navigated mid-request.
  const [busy, setBusy]           = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileRef = useRef(null);
  const labRef  = useRef(null);
  const [labBusy, setLabBusy] = useState(false);

  const bottomRef = useRef(null);
  const inputRef  = useRef(null);
  const recogRef  = useRef(null);
  const undoRef        = undoSnap;         // module-level, see above
  const workoutUndoRef = workoutUndoSnap;  // module-level, see above

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 250);
  }, [open]);

  // Drop a conversation carried over from a previous day before it can be
  // applied to today's log.
  useEffect(() => {
    if (open) useAIChat.getState().ensureFreshDay(today());
  }, [open]);

  // Returning to Today with an existing conversation should land at the
  // bottom, not at the top of a long scrollback.
  useEffect(() => {
    if (open && messages.length) {
      setTimeout(() => bottomRef.current?.scrollIntoView({ block: 'end' }), 0);
    }
  }, [open]);

  // ── Voice input ────────────────────────────────────────────────────────────
  // Dictation lives in its own review card above the input (useVoiceComposer):
  // 3s of silence auto-stops into a Send button; the mic appends more takes.
  // The typing box below is untouched by voice.
  const vc = useVoiceComposer({ onSend: (t) => send(t) });

  // ── Photo food logging ─────────────────────────────────────────────────────
  // Phone photos are 3–8 MB; we downscale to 1280px and re-encode at 0.8 JPEG
  // before upload. That keeps the request small, the AI just as accurate, and
  // avoids members on patchy mobile data waiting on a huge upload.
  const downscale = (file) => new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; };
    reader.onerror = () => reject(new Error('Could not read the photo'));
    img.onload = () => {
      const MAX = 1280;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      resolve(dataUrl.split(',')[1]);
    };
    img.onerror = () => reject(new Error('That file is not a readable image'));
    reader.readAsDataURL(file);
  });

  // `silent` is set when we are re-routing a file the member already sent via
  // the report button — a second "📷 Photo" bubble would be confusing.
  // sendPhoto and sendLabReport can each hand a file to the other, so one side
  // goes through a ref to avoid a circular useCallback dependency.
  const sendLabReportRef = useRef(null);

  const sendPhoto = useCallback(async (file, { silent = false } = {}) => {
    if (!file || photoBusy) return;
    setPhotoBusy(true);
    haptic(10);
    if (!silent) setMessages(m => [...m, { role: 'user', text: '📷 Photo attached' }]);
    try {
      const base64 = await downscale(file);
      const { data } = await api.post('/ai-chat/photo', {
        image: base64,
        mimeType: 'image/jpeg',
        mealSlots,
      }, { timeout: 60000 });   // vision is slower than chat; 35s was too tight

      // A lab report reached the camera button — send it to the reader instead.
      if (data.route_to === 'lab') {
        setMessages(m => [...m, { role: 'ai', text: data.reply }]);
        setPhotoBusy(false);
        return sendLabReportRef.current?.(file, { silent: true });
      }

      setMessages(m => [...m, {
        role: 'ai',
        text: data.reply,
        // Eval set: what produced this card. A photo has no replayable text, so
        // it is tagged as such rather than stored as "photo attached" — a
        // sample whose question is not the real question scores nothing.
        evalSource: 'photo',
        evalMessage: null,
        parsed: {
          // Scale screenshots return a weight and body metrics; meal photos
          // return foods. Same preview card handles both.
          weight_kg: data.weight_kg ?? null, weightOn: data.weight_kg != null,
          bodyMetrics: data.body_metrics || [],
          bodyMetricsOn: (data.body_metrics || []).length > 0,
          activities: [], acv: [], supplements: [],
          water_ml_add: null, waterOn: false,
          sleep: null, sleepOn: false,
          foods: (data.foods || []).map(f => ({ ...f, on: true, ai_grams: f.grams })),
          workouts: [],
          totals: data.totals,
        },
        applied: false,
      }]);
    } catch (err) {
      const msg = err.response?.data?.error || 'Could not analyse that photo — please try again.';
      setMessages(m => [...m, { role: 'ai', text: msg, error: true }]);
    } finally {
      setPhotoBusy(false);
    }
  }, [photoBusy, mealSlots]);

  // ── Lab report reading ─────────────────────────────────────────────────────
  // PDFs go up untouched: rasterising one client-side would throw away the text
  // layer and turn a clean extraction into OCR guesswork on medical numbers.
  // Photos of printouts get the same downscale as food photos.
  const readFileAsBase64 = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(new Error('Could not read that file'));
    r.readAsDataURL(file);
  });

  const sendLabReport = useCallback(async (file, { silent = false, force = false } = {}) => {
    if (!file || labBusy) return;
    setLabBusy(true);
    haptic(10);
    const isPdf = file.type === 'application/pdf';
    // Neutral label: the member attaches a file, the app works out what it is.
    // Claiming "my lab report" up front reads wrong when it turns out to be a
    // scale photo, and pre-labels a decision the classifier hasn't made yet.
    if (!silent) setMessages(m => [...m, { role: 'user', text: isPdf ? '📄 PDF attached' : '📷 Photo attached' }]);
    // A full panel can take 30–60 seconds. Without this the screen sits blank
    // and members upload the same file again, doubling the load.
    setMessages(m => [...m, { role: 'ai', text: 'Reading it… a full lab panel can take up to a minute.', pending: true }]);
    try {
      // Reject oversized files here rather than after a long upload. Express
      // caps the body at 12MB and base64 inflates by ~33%, so anything over
      // ~8MB of source will be refused server-side anyway.
      if (file.size > 8 * 1024 * 1024) {
        throw Object.assign(new Error('too large'), {
          response: { data: { error: 'That file is over 8MB. Export a smaller PDF, or photograph just the results page.' } },
        });
      }

      const base64 = isPdf ? await readFileAsBase64(file) : await downscale(file);

      // Reading a multi-page pathology report takes far longer than a chat
      // reply. The shared client aborts at 35s, which was cutting the request
      // off before the server had even answered — the failure looked like a
      // read error when it was really a client-side timeout.
      const { data } = await api.post('/ai-chat/lab-report', {
        file: base64,
        mimeType: isPdf ? 'application/pdf' : 'image/jpeg',
        force,
      }, { timeout: 120000 });

      // Wrong button: the image is a scale reading or a meal. Route it to the
      // photo pipeline, which already reads both — the member never has to
      // learn which button does what.
      if (data.route_to === 'photo' && !force) {
        setMessages(m => [...m.filter(x => !x.pending), { role: 'ai', text: data.reply }]);
        setLabBusy(false);
        return sendPhoto(file, { silent: true });
      }
      // Genuinely ambiguous — ask rather than guess. Losing a real lab report
      // to a wrong guess is far worse than one extra tap.
      if (data.route_to === 'ask' && !force) {
        setMessages(m => [...m.filter(x => !x.pending), {
          role: 'ai', text: data.reply, imageChoice: { file },
        }]);
        setLabBusy(false);
        return;
      }

      setMessages(m => [...m.filter(x => !x.pending), {
        role: 'ai',
        text: data.reply,
        lab: {
          test_date: data.test_date || new Date().toISOString().slice(0, 10),
          lab_name: data.lab_name || '',
          results: (data.results || []).map(r => ({ ...r, on: r.value !== null })),
          needs_review: data.needs_review || 0,
        },
        applied: false,
      }]);
    } catch (err) {
      const timedOut = err.code === 'ECONNABORTED' || /timeout/i.test(err.message || '');
      const msg = err.response?.data?.error
        || (timedOut
            ? 'That report took too long to read. A single page, or a photo of just the results table, is much quicker.'
            : 'Could not reach the reader — check your connection and try again.');
      setMessages(m => [...m.filter(x => !x.pending), { role: 'ai', text: msg, error: true }]);
    } finally { setLabBusy(false); }
  }, [labBusy]);
  sendLabReportRef.current = sendLabReport;

  const patchLab = useCallback((mi, fn) => {
    setMessages(prev => {
      const next = [...prev];
      const m = next[mi];
      if (!m?.lab || m.applied) return prev;
      next[mi] = { ...m, lab: fn(m.lab) };
      return next;
    });
  }, []);

  // A body-scale weight hiding among lab rows. Members upload scale screenshots
  // through the lab button too — that weight belongs in today's daily log, not
  // in lab history (where it duplicates the weight series and never reaches the
  // coach's daily view). 20–300 kg plausibility gate matches the parsers.
  const saveLabs = useCallback(async (mi) => {
    const m = messages[mi];
    if (!m?.lab || m.applied) return;
    const rows = m.lab.results.filter(r => r.on && r.value !== null && r.value !== '');
    if (!rows.length) return;

    // Only when the reading is from today — retro-writing today's log from an
    // old report would be wrong. Past-dated weight rows stay in lab history.
    const today = new Date().toISOString().slice(0, 10);
    // Routing rules live in utils/labRouting.js — the same functions
    // test-coach-view runs, and asserted to agree with the server's copy of the
    // weight-name predicate.
    const { weightRow, labRows } = routeLabRows(rows, m.lab.test_date, today);

    setLabBusy(true);
    try {
      let saved = 0, notice = null;
      if (labRows.length) {
        const { data } = await api.post('/members/me/labs', {
          test_date: m.lab.test_date,
          lab_name: m.lab.lab_name || null,
          results: labRows.map(r => ({
            test_name: r.test_name, value: r.value, unit: r.unit,
            ref_min: r.ref_min, ref_max: r.ref_max,
          })),
        });
        saved = data.saved; notice = data.notice;
      }
      if (weightRow) {
        const { updateLog, saveLog } = useLogStore.getState();
        updateLog('weight', String(parseFloat(weightRow.value)));
        saveLog().catch(() => {});
      }
      haptic(30);
      setMessages(prev => {
        const next = [...prev];
        next[mi] = { ...next[mi], applied: true, labSaved: saved, labNotice: notice,
                     weightLogged: weightRow ? parseFloat(weightRow.value) : null };
        return next;
      });
    } catch (err) {
      const msg = err.response?.data?.error || 'Could not save those results.';
      setMessages(prev => [...prev, { role: 'ai', text: msg, error: true }]);
    } finally { setLabBusy(false); }
  }, [messages]);

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
      // Chat memory: the last few visible turns plus today's logged foods, so
      // follow-ups like "make the dal 250g" or "that was dinner" resolve to
      // real items instead of "couldn't find anything to log".
      const recent = messages.slice(-6).map(m => ({
        role: m.role === 'user' ? 'user' : 'ai',
        text: String(m.text || '').slice(0, 200),
      })).filter(r => r.text);
      const lastFoods = (useLogStore.getState().log?.food || []).slice(-20)
        .map(f => ({ name: f.name, grams: f.grams, meal: f.meal }));
      const { data } = await api.post('/ai-chat/parse', {
        message: text,
        context: {
          mealSlots,
          recent,
          lastFoods,
          activities:    proto.activities.map(({ id, label, sub }) => ({ id, label, sub })),
          acv:           proto.acv.map(({ id, label, sub }) => ({ id, label, sub })),
          supplements:   proto.supplements.map(({ id, label, sub }) => ({ id, label, sub })),
          waterTargetMl: useLogStore.getState().protocol?.water_target || 3000,
        },
      });

      // A whole-day summary comes back as structured fields, and renders as the
      // same card the coach sees. Nothing to apply, so no preview list.
      if (data.summary) {
        setMessages(m => [...m, { role: 'ai', summary: data.summary }]);
        return;
      }

      // Every parsed thing starts INCLUDED — member unticks anything misheard
      setMessages(m => [...m, {
        role: 'ai',
        text: data.reply,
        // Eval set: the exact message that produced this card, so an edit the
        // member makes below can be paired with the question that caused it.
        evalSource: 'member_parse',
        evalMessage: text,
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
          foods:        (data.foods || []).map(f => ({ ...f, on: true, ai_grams: f.grams })),
          corrections:  (data.corrections || []).map(c => ({ ...c, on: true })),
          workouts:     (data.workouts || []).map(w => ({ ...w, on: true })),
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
  }, [input, busy, mealSlots, messages]);

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

  const setGrams = useCallback((mi, idx, value) => {
    const g = Math.min(5000, Math.max(0, parseInt(value) || 0));
    patchParsed(mi, p => ({
      ...p,
      foods: p.foods.map((f, i) => {
        if (i !== idx) return f;
        const factor = g / 100;
        return {
          ...f,
          grams: g,
          // Recompute this row's macros so the totals stay honest as they type
          macros: {
            cal:  Math.round((f.per_100g?.calories    || 0) * factor),
            pro:  +((f.per_100g?.protein     || 0) * factor).toFixed(1),
            carb: +((f.per_100g?.total_carbs || 0) * factor).toFixed(1),
            fat:  +((f.per_100g?.fat         || 0) * factor).toFixed(1),
          },
        };
      }),
    }));
  }, [patchParsed]);

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
    if (acvLeft > 0) pending.push(`${acvLeft} ${plural(acvLeft, 'ACV dose')}`);
    const suppLeft = proto.supplements.filter(s => !newLog.supplements?.[s.id]).length;
    if (suppLeft > 0) pending.push(`${suppLeft} ${plural(suppLeft, 'supplement')}`);
    if ((newLog.water || 0) < target) pending.push(`water (${((target - (newLog.water || 0)) / 1000).toFixed(1)}L to go)`);
    if (!newLog.food?.length) pending.push('food log');
    if (!newLog.sleep?.bedtime || !newLog.sleep?.waketime) pending.push('sleep times');

    return pending.slice(0, 3);
  }, []);

  // ── Workouts — SAFE merge into workout_sessions ────────────────────────────
  // POST /api/workouts REPLACES the whole day's session (all exercises/sets),
  // so we always GET the current session first and resend its exercises
  // unchanged — never silently wiping a manually-logged workout. We only add
  // duration + a note line; freeform AI-parsed workouts don't map to a named
  // exercise_id, so they live in the session's `notes` field for now (visible
  // to the member and their coach) rather than inventing exercise rows.
  const applyWorkouts = useCallback(async (workoutsOn) => {
    if (!workoutsOn.length) return { ok: true };
    const date = useLogStore.getState().date;
    try {
      const { data: existing } = await api.get('/workouts', { params: { date } });
      const prevSession = existing?.session || null;
      const prevExercises = (existing?.exercises || []).map(ex => ({
        exercise_id: ex.exercise_id,
        sets: ex.sets.map(s => ({ reps: s.reps, weight_kg: s.weight_kg })),
      }));

      // Snapshot for Undo
      workoutUndoRef.current = {
        date,
        hadSession: !!prevSession,
        duration_min: prevSession?.duration_min ?? null,
        notes: prevSession?.notes ?? null,
        exercises: prevExercises,
        cardio: Array.isArray(existing?.cardio) ? existing.cardio : [],
      };

      // Resolve an exercise by name, creating it if the library doesn't have it.
      // The library is shared globally, and POST /exercises upserts on name,
      // so this is safe to call for an existing name too.
      const resolveExerciseId = async (name) => {
        try {
          const { data: found } = await api.get('/workouts/exercises', { params: { q: name } });
          const exact = (found || []).find(
            e => e.name.toLowerCase() === name.toLowerCase()
          );
          if (exact) return exact.id;
        } catch { /* fall through to create */ }
        try {
          const { data: created } = await api.post('/workouts/exercises', { name });
          return created?.id || null;
        } catch (err) {
          console.error('AI chat: could not resolve exercise', name, err);
          return null;
        }
      };

      // Three buckets:
      //   sets      → real exercise rows (volume-based calories)
      //   cardio    → real cardio rows on the session (MET × time calories)
      //   freeform  → anything we can't structure, kept as a session note
      const structured = workoutsOn.filter(w => w.sets?.length);
      const cardioIn   = workoutsOn.filter(w => !w.sets?.length && w.cardio_type);
      const freeform   = workoutsOn.filter(w => !w.sets?.length && !w.cardio_type);

      const mergedExercises = [...prevExercises];
      for (const w of structured) {
        const exId = await resolveExerciseId(w.name);
        if (!exId) { freeform.push(w); continue; }  // fall back to a note
        const sets = w.sets.map(st => ({ reps: st.reps, weight_kg: st.weight_kg }));
        const already = mergedExercises.find(e => e.exercise_id === exId);
        if (already) already.sets = [...already.sets, ...sets];  // append, never replace
        else mergedExercises.push({ exercise_id: exId, sets });
      }

      // Duration only comes from FREEFORM work (a 30-min walk, an hour of
      // cycling). Set-based lifts must not add duration — each apply would
      // stack another block of minutes onto the session, and since burn is
      // duration × MET that inflates calories without limit. A member logging
      // "bench press 3 sets" twice was ending up with a 4-hour session.
      // Merge new cardio with what's already on the session, skipping exact
      // duplicates so re-applying the same message can't double the day.
      const prevCardio = Array.isArray(existing?.cardio) ? existing.cardio : [];
      const newCardio = cardioIn
        .map(w => ({
          type:         w.cardio_type,
          duration_min: parseFloat(w.duration_min) || 0,
          speed_kmh:    w.speed_kmh ?? null,
          distance_km:  w.distance_km ?? null,
        }))
        .filter(c => c.duration_min > 0)
        .filter(c => !prevCardio.some(p =>
          p.type === c.type && Number(p.duration_min) === Number(c.duration_min)
        ));
      const mergedCardio = [...prevCardio, ...newCardio];

      const addedMinutes = freeform.reduce((s, w) => s + (parseFloat(w.duration_min) || 0), 0);
      const rawDuration = (prevSession?.duration_min || 0) + addedMinutes;
      // 8 h is a generous ceiling for one day's training; beyond that the value
      // is almost certainly an accumulation bug rather than a real session.
      const newDuration = rawDuration > 0 ? Math.min(480, rawDuration) : (prevSession?.duration_min || null);

      const newLines = freeform.map(w =>
        `\u2728 ${w.name}${w.qty_text ? ` \u2014 ${w.qty_text}` : ''}${w.calories_burned ? ` (~${w.calories_burned} kcal)` : ''}`
      );
      const combinedNotes = [prevSession?.notes, ...newLines].filter(Boolean).join('\n').slice(0, 2000);

      await api.post('/workouts', {
        date,
        duration_min: newDuration,
        notes: combinedNotes,
        exercises: mergedExercises,
        cardio: mergedCardio,
      });
      return { ok: true, exercisesAdded: structured.length, cardioAdded: newCardio.length };
    } catch (err) {
      console.error('AI chat: failed to save workouts:', err);
      workoutUndoRef.current = null;
      return { ok: false };
    }
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
    // Corrections update the LAST matching item by name — the most recently
    // logged dal is "the dal" the member means. Grams and slot only; the
    // per_100g stays, so calories recompute automatically from the new grams.
    const corrOn = (p.corrections || []).filter(c => c.on);
    if (corrOn.length) {
      const food = [...(cur.food || [])];
      for (const c of corrOn) {
        for (let i = food.length - 1; i >= 0; i--) {
          if (String(food[i].name).toLowerCase() === c.name.toLowerCase()) {
            food[i] = { ...food[i],
              ...(c.grams ? { grams: c.grams } : {}),
              ...(c.meal  ? { meal: c.meal }   : {}) };
            break;
          }
        }
      }
      newLog.food = food;
      updateLog('food', food);
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
      newLog.food = [...(newLog.food || cur.food || []), ...newItems];
      updateLog('food', newLog.food);
    }

    if (p.bodyMetricsOn && p.bodyMetrics?.length) {
      // Body-scan metrics go to lab history (the coach's Body Composition
      // section reads from there). Fire-and-forget with a visible failure —
      // the daily log has already applied and must not be blocked by this.
      api.post('/members/me/labs', {
        test_date: new Date().toISOString().slice(0, 10),
        results: p.bodyMetrics.map(bm => ({ test_name: bm.name, value: bm.value, unit: bm.unit })),
        lab_name: 'Smart Scale',
        notes: 'Captured from a scale screenshot via AI chat',
      }).catch(() => {
        setMessages(msgs => [...msgs, {
          role: 'ai', error: true,
          text: "Your weight was logged, but saving the body metrics failed — try the screenshot again later.",
        }]);
      });
    }

    haptic(30);
    saveLog().catch(() => {});

    // Teach the app this member's real portion sizes. Only rows they actually
    // corrected, and only where the AI gave a recognisable unit phrase.
    const corrections = foodsOn
      .filter(f => f.portion_phrase && Number(f.grams) > 0 && Number(f.grams) !== Number(f.ai_grams))
      .map(f => ({ phrase: f.portion_phrase, grams: Number(f.grams) }));
    if (corrections.length) {
      api.post('/ai-chat/portions', { corrections })
        .catch(err => console.error('portion learning failed:', err));
    }

    // ── Eval set (Sprint L1) ─────────────────────────────────────────────────
    // Portion memory above only learns from foods that came with a recognisable
    // unit phrase ("2 katori"). The eval set wants every edit, phrase or not —
    // "Chicken Curry 300g → 180g" is exactly as much of a parsing error, and
    // the replay tool has no way to find it otherwise.
    //
    // Two signals, both unambiguous:
    //   · grams changed  → the model's portion was wrong
    //   · item unticked  → the model logged something that was never said
    // A meal-slot edit is NOT captured: the preview has no slot control, so a
    // wrong slot cannot be observed here. Recording it would be a guess.
    if (msg.evalMessage) {
      const edits = [
        ...p.foods
          .filter(f => f.on && Number(f.grams) > 0 && Number(f.grams) !== Number(f.ai_grams))
          .map(f => ({
            field:     'grams',
            ai_output: { name: f.name, grams: Number(f.ai_grams), meal: f.meal || null },
            corrected: { name: f.name, grams: Number(f.grams),    meal: f.meal || null },
          })),
        ...p.foods
          .filter(f => !f.on)
          .map(f => ({
            field:     'food_name',
            ai_output: { name: f.name, grams: Number(f.ai_grams), meal: f.meal || null },
            corrected: null,      // null = the member says this item does not exist
          })),
      ];
      for (const e of edits) {
        api.post('/ai-chat/eval-sample', {
          source:  msg.evalSource || 'member_parse',
          message: msg.evalMessage,
          ...e,
        }).catch(() => {});   // bookkeeping — never surfaces to the member
      }
    }

    const workoutsOn = p.workouts.filter(w => w.on);
    const workoutResult = await applyWorkouts(workoutsOn);

    setMessages(prev => {
      const next = [...prev];
      next[mi] = { ...next[mi], applied: true, workoutSaveFailed: workoutsOn.length > 0 && !workoutResult.ok, pending: computePending(newLog) };
      return next;
    });
  }, [messages, mealSlots, computePending, applyWorkouts]);

  // ── Undo / Edit last apply ─────────────────────────────────────────────────
  // Both roll the log back to its pre-apply snapshot; they differ only in what
  // the card becomes afterwards. Undo → "Changes reverted." Edit → the preview
  // card again, editable, so the member can fix a value and re-apply.
  const rollback = useCallback((mi, { reopen }) => {
    const snap = undoRef.current;
    if (!snap) return;
    const { updateLog, saveLog } = useLogStore.getState();
    Object.entries(snap).forEach(([field, val]) => updateLog(field, val));
    undoRef.current = null;
    haptic(20);
    saveLog().catch(() => {});

    // Restore workout_sessions to its pre-apply state, if we changed it
    const wSnap = workoutUndoRef.current;
    if (wSnap) {
      workoutUndoRef.current = null;
      if (wSnap.hadSession) {
        api.post('/workouts', {
          date: wSnap.date,
          duration_min: wSnap.duration_min,
          notes: wSnap.notes,
          exercises: wSnap.exercises,
          cardio: wSnap.cardio || [],
        }).catch(err => console.error('AI chat: workout undo failed:', err));
      }
      // If there was no session before, the one we created via applyWorkouts
      // stays — there's no delete endpoint, and an empty/duration-only
      // session is harmless (it just won't show in the Workout section
      // until it has notes or sets, which it still does — acceptable
      // trade-off vs. adding a destructive DELETE path just for undo).
    }

    setMessages(prev => {
      const next = [...prev];
      next[mi] = { ...next[mi],
        applied: false,
        undone: !reopen,          // reopening isn't a revert — the card comes back
        pending: null,
        editing: !!reopen,
      };
      return next;
    });
  }, []);

  const undo = useCallback((mi) => rollback(mi, { reopen: false }), [rollback]);
  const editApplied = useCallback((mi) => rollback(mi, { reopen: true }), [rollback]);

  if (!open) return null;

  // Count of included things across a parsed preview
  const countIncluded = (p) =>
    (p.weightOn && p.weight_kg != null ? 1 : 0) +
    p.activities.filter(a => a.on).length +
    p.acv.filter(a => a.on).length +
    p.supplements.filter(s => s.on).length +
    (p.waterOn && p.water_ml_add ? 1 : 0) +
    (p.sleepOn && p.sleep ? 1 : 0) +
    ((p.bodyMetricsOn && p.bodyMetrics?.length) ? 1 : 0) +
    (p.corrections || []).filter(c => c.on).length +
    p.foods.filter(f => f.on).length +
    p.workouts.filter(w => w.on).length;

  return (
    <div className="fixed inset-0 z-[70] bg-[#121316] flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)' }}>

      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06] bg-[#111116]">
        <button onClick={closeChat}
          style={{ minWidth: 44, minHeight: 44 }}
          className="flex items-center justify-center rounded-full text-[#9EA3B0] hover:text-white hover:bg-white/[0.06] transition-colors">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#D4AF37] to-[#8C6D37] flex items-center justify-center text-sm shadow-[0_0_16px_rgba(212,175,55,0.45)]">✨</div>
          <div>
            <p className="text-sm font-bold text-white leading-tight">FitLife AI</p>
            <p className="text-[10px] text-[#7E8596] leading-tight">Log your whole day in one message</p>
          </div>
        </div>
      </div>

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

        {messages.length === 0 && (
          <div className="bg-[#1A1C20] border border-white/[0.07] rounded-2xl p-4">
            <p className="text-sm font-semibold text-white mb-1.5">Hi! Tell me about your day 🌤</p>
            <p className="text-xs text-[#9EA3B0] leading-relaxed mb-3">
              Weight, walks, meals, ACV, water, supplements, sleep — say it all in
              one message and I'll fill your entire log. Review, then tap Apply.
              Tap 📷 to log a meal from a photo, or 📄 to upload a lab report.
            </p>
            <div className="bg-[#121316] border border-white/[0.06] rounded-xl px-3 py-2.5">
              <p className="text-[11px] text-[#9EA3B0] leading-relaxed italic">
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
              <div className="max-w-[85%] bg-[#D4AF37] text-[#121316] text-sm rounded-2xl rounded-br-md px-4 py-2.5 shadow-sm">
                {m.text}
              </div>
            </div>
          ) : (
            <div key={mi} className="flex justify-start">
              <div className="max-w-[94%] w-full">
                <div className={`text-sm rounded-2xl rounded-bl-md px-4 py-3 border ${
                  m.error
                    ? 'bg-red-500/[0.08] border-red-500/25 text-red-300'
                    : m.summary
                      ? 'bg-[rgba(212,175,55,0.06)] border-[rgba(212,175,55,0.20)] text-[#F0E2B6]'
                      : 'bg-[#1A1C20] border-white/[0.07] text-[#FFFFFF]'
                }`}>
                  {m.summary
                    ? <DaySummary s={m.summary} />
                    : <p className="leading-relaxed whitespace-pre-line">{m.text}</p>}

                  {/* Lab report draft — nothing is saved until confirmed. A
                      misread decimal on a blood test is a different order of
                      mistake from a misread portion size. */}
                  {/* Ambiguous image — the member decides which reader to use */}
                  {m.imageChoice && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      <button
                        onClick={() => { const f = m.imageChoice.file;
                          setMessages(prev => prev.map(x => x === m ? { ...x, imageChoice: null } : x));
                          sendPhoto(f, { silent: true }); }}
                        style={{ minHeight: 40 }}
                        className="px-3 rounded-full text-xs font-semibold bg-[#D4AF37] text-[#121316]">
                        It's a meal or my scale
                      </button>
                      <button
                        onClick={() => { const f = m.imageChoice.file;
                          setMessages(prev => prev.map(x => x === m ? { ...x, imageChoice: null } : x));
                          sendLabReportRef.current?.(f, { silent: true, force: true }); }}
                        style={{ minHeight: 40 }}
                        className="px-3 rounded-full text-xs font-semibold border border-white/[0.18] text-[#9EA3B0]">
                        It's a lab report
                      </button>
                    </div>
                  )}

                  {m.lab && (
                    <div className="mt-3">
                      <div className="flex items-center gap-2 mb-2">
                        <input type="date" value={m.lab.test_date}
                          max={new Date().toISOString().slice(0, 10)}
                          disabled={m.applied}
                          onChange={e => patchLab(mi, l => ({ ...l, test_date: e.target.value }))}
                          style={{ minHeight: 32 }}
                          className="bg-[#121316] border border-white/[0.12] rounded-lg px-2 text-[11px] text-white" />
                        <input value={m.lab.lab_name} placeholder="Lab name"
                          disabled={m.applied}
                          onChange={e => patchLab(mi, l => ({ ...l, lab_name: e.target.value }))}
                          style={{ minHeight: 32 }}
                          className="flex-1 min-w-0 bg-[#121316] border border-white/[0.12] rounded-lg px-2 text-[11px] text-white placeholder-[#7E8596]" />
                      </div>
                      {!m.applied
                        && m.lab.test_date === new Date().toISOString().slice(0, 10)
                        && m.lab.results.some(r => r.on && isScaleWeightRow(r)) && (
                        <p className="text-[11px] text-[#D4AF37] mb-2 px-1">
                          ⚖ Weight found — it will go into today's daily log, the rest into body history.
                        </p>
                      )}

                      {m.lab.needs_review > 0 && !m.applied && (
                        <p className="text-[10px] text-amber-300 mb-2 leading-relaxed">
                          ⚠ {m.lab.needs_review} {plural(m.lab.needs_review, 'row')} came out unclear —
                          check the highlighted ones against your report before saving.
                        </p>
                      )}

                      <div className="space-y-1.5">
                        {m.lab.results.map((r, ri) => (
                          <div key={ri}
                            className={`bg-[#121316] border rounded-xl px-3 py-2 ${
                              r.confidence === 'low' || r.value === null
                                ? 'border-amber-400/35' : 'border-white/[0.06]'
                            } ${r.on ? '' : 'opacity-40'}`}>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => patchLab(mi, l => ({
                                  ...l, results: l.results.map((x, j) => j === ri ? { ...x, on: !x.on } : x) }))}
                                disabled={m.applied}
                                className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] flex-shrink-0 ${
                                  r.on ? 'bg-[#D4AF37] text-[#121316]' : 'bg-white/[0.08] text-transparent'}`}>✓</button>
                              <span className="text-[11px] font-semibold text-white flex-1 min-w-0 truncate">
                                {r.test_name}
                              </span>
                              <input
                                value={r.value ?? ''} inputMode="decimal"
                                placeholder="?"
                                disabled={m.applied}
                                onChange={e => patchLab(mi, l => ({
                                  ...l, results: l.results.map((x, j) => j === ri
                                    ? { ...x, value: e.target.value === '' ? null : parseFloat(e.target.value), on: e.target.value !== '' } : x) }))}
                                style={{ width: 62, minHeight: 28 }}
                                className={`rounded-md px-1 text-center text-[11px] border bg-[#1A1C20] text-white
                                  ${r.value === null ? 'border-amber-400/50' : 'border-white/[0.12]'}`} />
                              <span className="text-[10px] text-[#7E8596] w-12 truncate">{r.unit || ''}</span>
                            </div>
                            {(r.ref_min != null || r.ref_max != null) && (
                              <p className="text-[9px] text-[#7E8596] ml-6 mt-0.5">
                                ref {r.ref_min ?? '−'}–{r.ref_max ?? '−'}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>

                      {m.applied ? (
                        <div className="mt-2 bg-emerald-500/[0.08] border border-emerald-500/25 rounded-xl px-3.5 py-3">
                          <p className="text-[13px] font-bold text-emerald-400">
                            ✓ {m.labSaved > 0 ? `${m.labSaved} results saved` : 'Saved'}
                            {m.weightLogged != null && ` · ⚖ ${m.weightLogged} kg logged for today`}
                          </p>
                          {m.labNotice && (
                            <p className="text-[11px] text-amber-200 mt-1 leading-relaxed">{m.labNotice}</p>
                          )}
                        </div>
                      ) : (
                        <>
                          <button onClick={() => saveLabs(mi)} disabled={labBusy}
                            style={{ minHeight: 44 }}
                            className="w-full mt-2 rounded-xl text-sm font-bold text-[#121316]
                              bg-gradient-to-r from-[#F0E2B6] via-[#D4AF37] to-[#8C6D37]
                              active:scale-[0.98] transition-transform disabled:opacity-60">
                            {labBusy ? 'Saving…' : `Save ${m.lab.results.filter(r => r.on && r.value !== null).length} results`}
                          </button>
                          <p className="text-[10px] text-[#7E8596] mt-1.5 leading-relaxed">
                            Read from your report by AI — check the numbers before saving.
                            Nothing is stored until you do.
                          </p>
                        </>
                      )}
                    </div>
                  )}

                  {m.parsed && (countIncluded(m.parsed) > 0 || m.parsed.workouts.length > 0) && (
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

                      {/* 📊 Body scan metrics from a scale screenshot */}
                      {m.parsed.bodyMetrics?.length > 0 && (
                        <div>
                          <GroupHeader icon="📊" title="Body scan" count={m.parsed.bodyMetrics.length} />
                          <ToggleChip on={m.parsed.bodyMetricsOn}
                            onToggle={() => patchParsed(mi, p => ({ ...p, bodyMetricsOn: !p.bodyMetricsOn }))}>
                            Save {m.parsed.bodyMetrics.length} metrics to body history
                          </ToggleChip>
                          <p className="text-[10px] text-[#7E8596] mt-1 px-1">
                            {m.parsed.bodyMetrics.slice(0, 4).map(bm => `${bm.name} ${bm.value}${bm.unit || ''}`).join(' · ')}
                            {m.parsed.bodyMetrics.length > 4 && ` · +${m.parsed.bodyMetrics.length - 4} more`}
                          </p>
                        </div>
                      )}

                      {/* ✏️ Corrections to items already in today's log */}
                      {m.parsed.corrections?.length > 0 && (
                        <div>
                          <GroupHeader icon="✏️" title="Corrections" count={m.parsed.corrections.filter(c => c.on).length} />
                          <div className="flex flex-wrap gap-1.5">
                            {m.parsed.corrections.map((c, i) => (
                              <ToggleChip key={`corr-${i}`} on={c.on}
                                onToggle={() => patchParsed(mi, p => ({
                                  ...p,
                                  corrections: p.corrections.map((x, xi) => xi === i ? { ...x, on: !x.on } : x),
                                }))}>
                                {c.name} → {[c.grams && `${c.grams}g`, c.meal].filter(Boolean).join(' · ')}
                              </ToggleChip>
                            ))}
                          </div>
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
                                className={`w-full text-left bg-[#121316] border rounded-xl px-3 py-2.5 transition-all active:scale-[0.99] ${
                                  f.on ? 'border-white/[0.08]' : 'border-white/[0.04] opacity-40'
                                }`}>
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] flex-shrink-0 ${
                                      f.on ? 'bg-[#D4AF37] text-[#121316]' : 'bg-white/[0.08] text-transparent'
                                    }`}>✓</span>
                                    <div className="min-w-0">
                                      <p className={`text-[13px] font-semibold truncate ${f.on ? 'text-white' : 'text-[#9EA3B0] line-through'}`}>
                                        {f.name}
                                      </p>
                                      <div className="flex items-center gap-1.5 text-[11px] text-[#7E8596] flex-wrap">
                                        {f.qty_text ? <span>{f.qty_text} ·</span> : null}
                                        {/* Editable: the portion guess is the biggest source of
                                            error in the whole chain, and every correction teaches
                                            the app this member's actual bowl and glass sizes. */}
                                        <input
                                          type="number" inputMode="numeric" value={f.grams}
                                          onClick={e => e.stopPropagation()}
                                          onChange={e => setGrams(mi, fi, e.target.value)}
                                          disabled={m.applied}
                                          style={{ width: 54, minHeight: 26 }}
                                          className="bg-[#121316] border border-white/[0.14] rounded-md px-1 text-center
                                            text-[11px] text-white focus:outline-none focus:ring-1 focus:ring-[rgba(212,175,55,0.5)]"
                                        />
                                        <span>g · {f.meal || 'Meal 1'}</span>
                                        {f.source === 'db-verified' && <span className="text-emerald-400">· verified</span>}
                                        {Number(f.grams) !== Number(f.ai_grams) && (
                                          <span className="text-[#D4AF37]">· I'll remember this</span>
                                        )}
                                      </div>
                                      {f.warning && (
                                        <p className="text-[10px] text-amber-300 leading-snug mt-0.5">⚠ {f.warning}</p>
                                      )}
                                    </div>
                                  </div>
                                  <div className="text-right flex-shrink-0">
                                    <p className="text-[13px] font-bold text-orange-400">{f.macros?.cal ?? 0} kcal</p>
                                    <p className="text-[10px] text-[#9EA3B0]">
                                      P {f.macros?.pro ?? 0} · C {f.macros?.carb ?? 0} · F {f.macros?.fat ?? 0}
                                    </p>
                                  </div>
                                </div>
                              </button>
                            ))}
                            {m.parsed.totals && m.parsed.foods.filter(f => f.on).length > 1 && (
                              <div className="flex items-center justify-between px-3 py-2 bg-[#D4AF37]/[0.10] border border-[#D4AF37]/25 rounded-xl">
                                <span className="text-[11px] font-bold text-[#F0E2B6] uppercase tracking-wider">Food total</span>
                                <span className="text-[13px] font-bold text-white">
                                  {m.parsed.foods.filter(f => f.on).reduce((s, f) => s + (f.macros?.cal || 0), 0)} kcal
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* 💪 Workouts — now actually saved to the Workout section */}
                      {m.parsed.workouts.length > 0 && (
                        <div>
                          <GroupHeader icon="💪" title="Workouts" count={m.parsed.workouts.filter(w => w.on).length} />
                          <div className="space-y-1.5">
                            {m.parsed.workouts.map((w, wi) => (
                              <button key={wi} onClick={() => toggleListItem(mi, 'workouts', wi)}
                                disabled={m.applied}
                                className={`w-full flex items-center justify-between bg-[#121316] border rounded-xl px-3 py-2.5 transition-all ${
                                  w.on ? 'border-white/[0.08]' : 'border-white/[0.04] opacity-40'
                                }`}>
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] flex-shrink-0 ${
                                    w.on ? 'bg-[#D4AF37] text-[#121316]' : 'bg-white/[0.08] text-transparent'
                                  }`}>✓</span>
                                  <div className="min-w-0">
                                    <p className={`text-[12px] font-semibold truncate ${w.on ? 'text-white' : 'text-[#9EA3B0] line-through'}`}>
                                      {w.name}{w.qty_text ? ` — ${w.qty_text}` : ''}
                                    </p>
                                    {w.sets?.length > 0 && (
                                      <p className="text-[10px] text-[#9EA3B0] truncate">
                                        {w.sets.map((st, si) => `${st.reps}×${st.weight_kg || 'BW'}${st.weight_kg ? 'kg' : ''}`).join(' · ')}
                                      </p>
                                    )}
                                  </div>
                                </div>
                                {w.calories_burned != null && (
                                  <p className="text-[11px] font-semibold text-emerald-400 flex-shrink-0">~{w.calories_burned} kcal</p>
                                )}
                              </button>
                            ))}
                            <p className="text-[10px] text-[#7E8596] px-1">
                              {m.parsed.workouts.some(w => w.on && w.sets?.length)
                                ? 'Sets and reps go straight into your Workout log.'
                                : "Saved to today's session · add exact sets & reps in the Workout section anytime."}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* ── Apply / Applied / Undo ── */}
                      {m.editing && !m.applied && (
                        <p className="text-[11px] text-[#D4AF37] font-medium">
                          ✏️ Editing — that entry has been rolled back. Adjust below and apply again.
                        </p>
                      )}

                      {countIncluded(m.parsed) > 0 && !m.applied && !m.undone && (
                        <button onClick={() => applyAll(mi)}
                          style={{ minHeight: 48 }}
                          className="w-full rounded-xl text-sm font-bold bg-gradient-to-r from-[#D4AF37] to-[#6344e8] text-white hover:from-[#8b6dff] hover:to-[#D4AF37] active:scale-[0.98] shadow-[0_2px_16px_rgba(212,175,55,0.4)] transition-all">
                          Apply {countIncluded(m.parsed)} {plural(countIncluded(m.parsed), 'item')} to today's log
                        </button>
                      )}

                      {m.applied && (
                        <div className={`border rounded-xl px-3.5 py-3 space-y-2 ${
                          m.workoutSaveFailed ? 'bg-amber-500/[0.08] border-amber-500/25' : 'bg-emerald-500/[0.08] border-emerald-500/25'
                        }`}>
                          <div className="flex items-center justify-between">
                            <p className={`text-[13px] font-bold ${m.workoutSaveFailed ? 'text-amber-400' : 'text-emerald-400'}`}>
                              {m.workoutSaveFailed ? '⚠ Applied — workout not saved' : '✓ Applied & saved'}
                            </p>
                            <div className="flex items-center gap-3">
                              <button onClick={() => editApplied(mi)}
                                style={{ minHeight: 32 }}
                                className="text-[11px] font-semibold text-[#D4AF37] hover:text-[#F0E2B6] transition-colors">
                                ✏️ Edit
                              </button>
                              <button onClick={() => undo(mi)}
                                style={{ minHeight: 32 }}
                                className="text-[11px] font-semibold text-[#9EA3B0] hover:text-white underline underline-offset-2 transition-colors">
                                Undo
                              </button>
                            </div>
                          </div>
                          {m.workoutSaveFailed && (
                            <p className="text-[11px] text-amber-300 leading-relaxed">
                              Everything else saved, but the workout note couldn't be saved — check your connection and log it in the Workout section.
                            </p>
                          )}
                          {m.pending?.length > 0 ? (
                            <p className="text-[11px] text-[#9EA3B0] leading-relaxed">
                              Still pending today: {m.pending.join(' · ')}
                            </p>
                          ) : (
                            <p className="text-[11px] text-[#9EA3B0]">Everything's logged for today — great job! 🎉</p>
                          )}
                          <p className="text-[10px] text-[#7E8596] leading-relaxed">
                            Need a change? Tap Edit — or just tell me: type it, say it with 🎤, or send a 📷 photo.
                          </p>
                        </div>
                      )}

                      {m.undone && (
                        <p className="text-[11px] text-[#9EA3B0] text-center">Changes reverted.</p>
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
            <div className="bg-[#1A1C20] border border-white/[0.07] rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#D4AF37] animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-[#D4AF37] animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-[#D4AF37] animate-bounce" style={{ animationDelay: '300ms' }} />
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
              className="text-xs bg-[#1A1C20] border border-white/[0.10] hover:border-[rgba(212,175,55,0.4)] rounded-full px-3.5 py-1.5 text-[#9EA3B0] transition-colors">
              {chip}
            </button>
          ))}
        </div>
      )}

      {/* ── Input bar ── */}
      <div className="px-4 py-3 border-t border-white/[0.06] bg-[#111116]"
        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
        {vc.card}
        <div className="flex items-end gap-2">
          <div className="flex-1 flex items-center bg-[#1A1C20] border border-white/[0.10] rounded-2xl px-3">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
              placeholder="Eg: weight 82.5, walk done, 2 chapati for lunch"
              className="flex-1 bg-transparent text-sm text-white placeholder-[#7E8596] py-3 outline-none min-w-0"
            />
            <button onClick={() => labRef.current?.click()}
              disabled={labBusy}
              aria-label="Upload a lab report"
              style={{ minWidth: 40, minHeight: 40 }}
              className={`flex items-center justify-center rounded-full transition-colors flex-shrink-0 ${
                labBusy ? 'text-[#7E8596] animate-pulse' : 'text-[#9EA3B0] hover:text-[#D4AF37]'
              }`}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="9" y1="15" x2="15" y2="15" />
              </svg>
            </button>
            <input ref={labRef} type="file" accept="application/pdf,image/*"
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) sendLabReport(f); }}
              style={{ display: 'none' }} />
            <button onClick={() => fileRef.current?.click()}
              disabled={photoBusy}
              aria-label="Log food from a photo"
              style={{ minWidth: 40, minHeight: 40 }}
              className={`flex items-center justify-center rounded-full transition-colors flex-shrink-0 ${
                photoBusy ? 'text-[#7E8596] animate-pulse' : 'text-[#9EA3B0] hover:text-[#F0E2B6]'
              }`}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            </button>
            <input ref={fileRef} type="file" accept="image/*" capture="environment"
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) sendPhoto(f); }}
              style={{ display: 'none' }} />
            {vc.micButton}
          </div>
          <button
            onClick={() => send()}
            disabled={!input.trim() || busy}
            style={{ minWidth: 48, minHeight: 48 }}
            className={`flex items-center justify-center rounded-full transition-all flex-shrink-0 ${
              input.trim() && !busy
                ? 'bg-[#D4AF37] text-[#121316] shadow-[0_2px_12px_rgba(212,175,55,0.4)] active:scale-95'
                : 'bg-white/[0.05] text-[#7E8596]'
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
