/**
 * hooks/useTodayModel.js — everything the Today screen KNOWS, with none of
 * what it SHOWS.
 *
 * This is the container half of the old pages/DailyLog.jsx, moved here in
 * Sprint 3 line-for-line: the store wiring, every fetch, the 4-second
 * auto-save, the streak and milestone logic, the auto-derived protocol ticks,
 * the PWA shortcut handling. The comments inside are the original ones —
 * several record bugs that were hit and fixed (temporal-dead-zone effects,
 * UTC-vs-IST dates, the un-ticking that damaged compliance) and they are the
 * reason the code is in the order it is in. Do not reorder for tidiness.
 *
 * `pages/Today.jsx` renders from the object this returns. Nothing in here
 * knows about sheets, dots, strips or timelines — only about the day.
 *
 * `heroPanel` keeps its historical name because three effects depend on it
 * (workout refresh on close, personal-best re-check). Today.jsx exposes it as
 * `sheet`.
 */
import { useEffect, useCallback, useState, useRef } from 'react';
import { useLogStore }  from '../store/logStore';
import { useAuthStore } from '../store/authStore';
import api from '../api/client';
import { getMyProfile, getMyToday } from '../api/logs';
import {
  today, istDate, istDaysAgo,
  ACTIVITIES, ACV_ITEMS, SUPPLEMENTS,
  calcCompliance, plural,
} from '../constants';
import { useAIChat } from '../components/AIChatLog';
import { sessionEnergy } from '../utils/exerciseCalories';
import { dailyRead } from '../utils/dailyRead';
import { useSettingsStore, useTerms, haptic } from '../store/settingsStore';
import { usePush }        from '../hooks/usePush';
import { useOfflineSync } from '../hooks/useOfflineQueue';
import { deriveTodayDay } from '../utils/programDay';
import { coachCardRows } from '../utils/coachCard';
import {
  countMicrosMet, calcBMR, foodKcal, sleepMinutes, formatSleep,
  AUTO_TICK_IDS, deriveActivityTicks, pendingLabels,
} from '../lib/day';

export const AVATARS_LIST = ['🐶','🐱','🦊','🐻','🦁','🐼','🐸','🦋','🌟','🎈','🌈','🦄'];

export default function useTodayModel() {

  const { user } = useAuthStore();
  const { date, log, protocol, loading, saving, saved, queued, error, setDate, updateLog, saveLog } = useLogStore();

  const overrides    = protocol?.item_overrides || {};
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

  const activeActivities  = allActivities.filter(a  => !protocol?.activities  || protocol.activities.includes(a.id));
  const activeACV         = allACV.filter(a         => !protocol?.acv         || protocol.acv.includes(a.id));
  const activeSupplements = allSupplements.filter(s => !protocol?.supplements || protocol.supplements.includes(s.id));

  usePush();
  useOfflineSync();

  useEffect(() => { setDate(today()); }, []);

  // Fetch yesterday's weight for trend delta shown after weight entry
  const [yesterdayWeight, setYesterdayWeight] = useState(null);
  useEffect(() => {
    // Was toISOString() — UTC — while today() is IST. For 5.5 hours a day
    // those pointed at different dates and the trend delta silently vanished.
    const yStr = istDaysAgo(1);
    api.get(`/logs/${yStr}`).then(({ data }) => {
      if (data?.weight_kg) setYesterdayWeight(parseFloat(data.weight_kg));
    }).catch(() => {});
  }, []);

  // Fetch coach notes + profile age once on mount
  const [coachNotes, setCoachNotes] = useState([]);
  // Replies were impossible, so members answered on WhatsApp and the exchange
  // left the app entirely — along with any record of what was agreed.
  const [replyTo, setReplyTo]     = useState(null);   // note id being answered
  const [replyText, setReplyText] = useState('');
  const [replyBusy, setReplyBusy] = useState(false);
  const [replied, setReplied]     = useState({});
  const [profileAge, setProfileAge] = useState(null);

  // Only unread messages appear on Today; read ones live in the bell.
  const unreadNotes = coachNotes.filter(n => !n.read_at);

  // A reply that fails silently is worse than no reply feature at all: the
  // member believes the coach has been answered, the coach never hears, and
  // the conversation moves to WhatsApp anyway — which is the exact thing this
  // was built to stop. So the draft is kept and the failure is stated.
  const [replyError, setReplyError] = useState('');

  const sendReply = async (noteId) => {
    const text = replyText.trim();
    if (!text) return;
    setReplyBusy(true);
    setReplyError('');
    try {
      await api.post('/members/me/notes/reply', { note: text, reply_to: noteId });
      setReplied(r => ({ ...r, [noteId]: true }));
      setReplyTo(null);
      setReplyText('');
      // Replying is reading, so the note clears from the unread list too
      markNotesRead([noteId]);
    } catch (err) {
      console.error('reply failed:', err);
      setReplyError(
        err.response?.data?.error ||
        "Couldn't send — check your connection and tap Send again. Your message is still here."
      );
    } finally { setReplyBusy(false); }
  };

  const markNotesRead = useCallback(async (ids) => {
    if (!ids?.length) return;
    haptic(12);
    // Optimistic — the card disappears immediately, no waiting on the network
    setCoachNotes(prev => prev.map(n =>
      ids.includes(n.id) ? { ...n, read_at: new Date().toISOString() } : n
    ));
    try {
      await api.post('/members/me/notes/read', { ids });
    } catch (err) {
      console.error('Failed to mark messages read:', err);
      // Roll back so the member doesn't silently lose a message
      setCoachNotes(prev => prev.map(n =>
        ids.includes(n.id) ? { ...n, read_at: null } : n
      ));
    }
  }, []);

  // Height + sex power the hero's energy-balance chip (see calcBMR below)
  const [bodyStats, setBodyStats] = useState({ height_cm: null, gender: null });

  // Coach's plan for today — the active program's day whose label carries
  // today's weekday ("Leg · Thu"). Lets the dashboard announce the session
  // instead of showing "— none" until the member digs into the panel.
  const [coachPlan, setCoachPlan] = useState(null); // { programName, todayDay|null, dayCount }
  const [mealPlans, setMealPlans] = useState([]);   // [{ meal, items:[{name,grams,qty_text,per_100g}] }]

  // ── Cold open: one request instead of two ───────────────────────────────────
  // /members/me/today returns the meal plan and the active program in the
  // SAME shapes as /members/me/meal-plan and /programs/active, so this is a
  // pure transport change — the handlers below are untouched.
  //
  // The aggregate GATES the individual fetches rather than replacing them. If
  // the aggregate is unavailable (older bundle against a newer server, a
  // partial deploy, a 500) the page still fills in exactly as before, just
  // over more requests. A faster path that can leave the dashboard blank is
  // not a faster path.
  const [aggregate, setAggregate] = useState(undefined); // undefined = still deciding
  useEffect(() => {
    let cancelled = false;
    getMyToday()
      .then(({ data }) => { if (!cancelled) setAggregate(data); })
      .catch(() => { if (!cancelled) setAggregate(null); });   // null = fall back
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (aggregate === undefined) return;                 // still waiting
    if (aggregate) { setMealPlans(aggregate.meal_plan?.meals || []); return; }
    api.get('/members/me/meal-plan').then(({ data }) => setMealPlans(data.meals || [])).catch(() => {});
  }, [aggregate]);

  useEffect(() => {
    if (aggregate === undefined) return;
    const handle = ({ data }) => {
      if (!data?.program) return;
      const days = data.days || [];
      // A program is "scheduled" only if its labels actually carry weekdays.
      // "Core Workout" assigned for today has none — showing "Rest day" on the
      // program the coach just assigned would be exactly wrong. Unscheduled →
      // today's session is simply the first (usually only) day.
      // The rule lives in utils/programDay.js, shared with WorkoutLog and
      // asserted against the server's programDayForDate.
      const { scheduled, todayDay } = deriveTodayDay(days);
      setCoachPlan({ programName: data.program.name, todayDay, dayCount: days.length, scheduled });
    };

    // Same handler either way — the aggregate returns the identical
    // { program, days } shape that /programs/active does.
    if (aggregate) { handle({ data: aggregate.program || {} }); return; }
    api.get('/programs/active').then(handle).catch(() => {});
  }, [aggregate]);

  useEffect(() => {
    getMyProfile().then(({ data }) => {
      if (data?.coach_notes?.length) setCoachNotes(data.coach_notes);
      if (data?.dob) {
        const diff = Date.now() - new Date(data.dob).getTime();
        setProfileAge(Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25)));
      }
      setBodyStats({
        height_cm: data?.height_cm ? parseFloat(data.height_cm) : null,
        gender:    data?.gender || null,
      });
    }).catch(() => {});
  }, []);

  // Milestone celebration — shown after save completes
  const [milestone, setMilestone] = useState(null); // { icon, title, body }
  // Today's volume, but only when it beats every previous session on record
  const [volumePB, setVolumePB] = useState(null);
  const prevSaved = useRef(false);

  const terms = useTerms();
  const { nutritionView, ageMode, avatarIdx } = useSettingsStore();

  // ── Weight sanity check ───────────────────────────────────────────────────
  const [weightWarning, setWeightWarning] = useState('');
  const validateWeight = (val) => {
    const w = parseFloat(val);
    const minW = ageMode === 'child' ? 15 : 30;
    const maxW = ageMode === 'child' ? 100 : 250;
    if (val && !isNaN(w) && (w < minW || w > maxW)) {
      setWeightWarning(`${w} kg looks unusual — are you sure? (Expected ${minW}–${maxW} kg)`);
    } else { setWeightWarning(''); }
  };

  // ── Auto-save (4-second debounce) ─────────────────────────────────────────
  // Every field writes through here — this is now the ONLY save path (no more
  // manual "Save Today's Log" button). 4s feels instant in practice while
  // still coalescing rapid edits (e.g. dragging the water slider) into one
  // request instead of firing on every pixel of movement.
  const autoSaveRef = useRef(null);
  const [autoSaved, setAutoSaved] = useState(false);

  // ── Premium hero state ─────────────────────────────────────────────────────
  const [heroPanel, setHeroPanel] = useState(null);   // 'weight'|'food'|'protocol'|'water'|'workout'|'sleep'

  // PWA app shortcuts: long-press icon → /?open=ai or /?open=weight.
  // Handled once on mount, then the param is stripped so a refresh doesn't
  // re-trigger it.
  useEffect(() => {
    const open = new URLSearchParams(window.location.search).get('open');
    if (!open) return;
    if (open === 'ai') useAIChat.getState().openChat();
    if (open === 'weight') setHeroPanel('weight');
    window.history.replaceState({}, '', window.location.pathname);
  }, []);
  const [workoutSummary, setWorkoutSummary] = useState({ count: 0, duration: null, sets: [], cardio: [] });
  // Bumped whenever the AI applies a day, so WorkoutLog remounts and picks up
  // anything the AI just wrote (otherwise an open sheet shows stale data).
  const [workoutRefreshKey, setWorkoutRefreshKey] = useState(0);
  // Sprint 4: the chat has no overlay to close any more, so "AI just wrote
  // something" is signalled directly — the store stamps lastAppliedAt after
  // every successful Apply and the workout summary refetches from it.
  const lastAppliedAt = useAIChat(s => s.lastAppliedAt);
  useEffect(() => {
    if (lastAppliedAt) setWorkoutRefreshKey(k => k + 1);
  }, [lastAppliedAt]);

  // openChat() from anywhere (orb, Today's read, a sheet's "Log with AI"
  // banner) must be able to reach the composer — which a sheet would cover.
  // Close whatever sheet is open on the same signal.
  const chatFocusRequest = useAIChat(s => s.focusRequest);
  useEffect(() => {
    if (chatFocusRequest) setHeroPanel(null);
  }, [chatFocusRequest]);

  // Personal-best detection. Declared here, AFTER heroPanel and
  // workoutRefreshKey exist — its dependency array reads them on every
  // render, so placing it above their declarations threw a temporal
  // dead-zone ReferenceError and blanked the whole page.
  useEffect(() => {
    if (date !== today()) { setVolumePB(null); return; }
    let cancelled = false;
    api.get('/workouts/summary', { params: { days: 180 } })
      .then(({ data }) => {
        if (cancelled) return;
        const sessions = data?.sessions || [];
        const todayStr = today();
        const todaysVol = sessions.find(s => String(s.date).slice(0, 10) === todayStr)?.volume_kg || 0;
        const priorBest = sessions
          .filter(s => String(s.date).slice(0, 10) !== todayStr)
          .reduce((m, s) => Math.max(m, s.volume_kg), 0);
        setVolumePB(todaysVol > 0 && todaysVol > priorBest ? todaysVol : null);
      })
      .catch(() => { if (!cancelled) setVolumePB(null); });
    return () => { cancelled = true; };
  }, [date, workoutRefreshKey, heroPanel]);

  // Workout tile summary — refreshed when the date changes or the panel closes
  useEffect(() => {
    let cancelled = false;
    api.get('/workouts', { params: { date } })
      .then(({ data }) => {
        if (cancelled) return;
        setWorkoutSummary({
          count: (data?.exercises || []).length,
          duration: data?.session?.duration_min || null,
          // Raw sets + cardio feed the shared calorie model (volume-based for
          // strength, MET × time for cardio)
          sets: (data?.exercises || []).flatMap(ex => ex.sets || []),
          cardio: Array.isArray(data?.cardio) ? data.cardio : [],
        });
      })
      .catch(() => { if (!cancelled) setWorkoutSummary({ count: 0, duration: null, sets: [], cardio: [] }); });
    return () => { cancelled = true; };
  }, [date, heroPanel, workoutRefreshKey]);
  const [streak, setStreak] = useState(0);
  const [chipInfo, setChipInfo] = useState(null);   // { label, sub } — long-press popover
  const chipPressRef = useRef(null);

  // Logging streak, plus whether the current run is the best of the last month
  // — "6-day streak" means little on its own; "best this month" is the reward.
  const [streakIsBest, setStreakIsBest] = useState(false);
  useEffect(() => {
    const fStr = istDaysAgo(30);
    api.get(`/logs/range/${fStr}/${today()}`).then(({ data }) => {
      const logged = new Set((data || []).map(l => (l.log_date || '').slice(0, 10)));
      let s = 0;
      const d = new Date();
      // A streak may end yesterday if today isn't logged yet
      if (!logged.has(today())) d.setDate(d.getDate() - 1);
      for (let i = 0; i < 30; i++) {
        const ds = istDate(d);
        if (!logged.has(ds)) break;
        s++; d.setDate(d.getDate() - 1);
      }
      setStreak(s);

      // Longest run anywhere in the window, to compare the current one against
      let best = 0, run = 0;
      const walk = new Date(); walk.setDate(walk.getDate() - 29);
      for (let i = 0; i < 30; i++) {
        const ds = istDate(walk);
        run = logged.has(ds) ? run + 1 : 0;
        best = Math.max(best, run);
        walk.setDate(walk.getDate() + 1);
      }
      setStreakIsBest(s > 0 && s >= best);
    }).catch(() => {});
  }, []);

  // ── Milestone celebration ───────────────────────────────────────────────────
  // Declared HERE, below the streak effect, and not up beside the other save
  // handlers: its dependency array reads `streak`, and a dependency array is
  // evaluated during render. Placing this above `const [streak] = useState()`
  // would throw a temporal dead-zone ReferenceError and blank the whole page —
  // the same trap the volumePB effect above records hitting.
  //
  // The streak number now comes from the server-derived value (computed from
  // /logs/range) instead of a second count kept in localStorage. Those two
  // disagreed: the local one reset on a new device, so a member could be
  // congratulated on a 7-day streak on one phone while Progress showed
  // something else on another. localStorage is still used, but ONLY to
  // remember which celebration has already been shown on this device — that
  // is a display concern, not a source of truth.
  useEffect(() => {
    if (prevSaved.current || !saved || date !== today()) { prevSaved.current = saved; return; }

    const SEEN_KEY = 'fitlife_milestones_seen';
    const seen = (() => {
      try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}'); } catch { return {}; }
    })();
    const remember = (patch) => {
      try { localStorage.setItem(SEEN_KEY, JSON.stringify({ ...seen, ...patch })); } catch (_) {}
    };

    // ── Weight milestone ────────────────────────────────────────────────────
    const startW   = parseFloat(protocol?.start_weight);
    const currentW = parseFloat(log.weight);
    const lostKg   = startW && currentW ? +(startW - currentW).toFixed(1) : null;
    const kgMilestone = lostKg != null && lostKg > 0 ? Math.floor(lostKg) : 0;

    if (kgMilestone >= 1 && kgMilestone > (seen.lastKgMilestone || 0)) {
      remember({ lastKgMilestone: kgMilestone });
      setMilestone({
        icon: 'trophy',
        title: `${kgMilestone} kg lost!`,
        body: `You've shed ${kgMilestone} kg since you started. That's real progress — keep going!`,
      });
    } else if ([7, 14, 21, 30, 50, 100].includes(streak) && seen.lastStreak !== streak) {
      remember({ lastStreak: streak });
      setMilestone({
        icon: 'flame',
        title: `${streak}-day streak!`,
        body: `${streak} ${plural(streak, 'day')} logged in a row. You're building an unstoppable habit!`,
      });
    } else if (volumePB) {
      setMilestone({
        icon: 'arm',
        title: 'New personal best!',
        body: `${volumePB.toLocaleString()} kg lifted today — the most you've ever done in one session. Strong work!`,
      });
    }

    prevSaved.current = saved;
  }, [saved, streak, volumePB]);

  // Long-press on a protocol chip shows its timing/instructions
  const chipPressStart = useCallback((item) => {
    clearTimeout(chipPressRef.current);
    chipPressRef.current = setTimeout(() => {
      if (item.sub) { setChipInfo({ label: item.label, sub: item.sub }); haptic(20); }
    }, 420);
  }, []);
  const chipPressEnd = useCallback(() => clearTimeout(chipPressRef.current), []);
  useEffect(() => {
    if (!chipInfo) return;
    const t = setTimeout(() => setChipInfo(null), 3000);
    return () => clearTimeout(t);
  }, [chipInfo]);

  const triggerAutoSave = useCallback(() => {
    clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(async () => {
      autoSaveRef.current = null;
      if (date === today()) {
        try { await saveLog(); setAutoSaved(true); setTimeout(() => setAutoSaved(false), 2500); } catch {}
      }
    }, 4000);
  }, [saveLog, date]);

  // Flush a pending debounced save NOW. Used before the date changes.
  //
  // Found by the Sprint 3 jsdom flow: tick a supplement, press ‹ within four
  // seconds to look at yesterday. The timer fired after setDate had already
  // swapped the store to yesterday's log, so saveLog() posted yesterday's data
  // to yesterday and today's tick was gone. The member saw the tick, left,
  // came back to find it missing. Saving before the store changes closes it.
  const flushPendingSave = useCallback(async () => {
    if (!autoSaveRef.current) return;
    clearTimeout(autoSaveRef.current);
    autoSaveRef.current = null;
    if (date === today()) {
      try { await saveLog(); setAutoSaved(true); setTimeout(() => setAutoSaved(false), 2500); } catch {}
    }
  }, [saveLog, date]);

  // Safety net: if the debounce hasn't fired yet and the user navigates away,
  // switches tabs, or closes the app, flush an immediate save so the last few
  // seconds of edits aren't silently lost.
  useEffect(() => {
    const flush = () => {
      if (autoSaveRef.current && date === today()) {
        clearTimeout(autoSaveRef.current);
        saveLog().catch(() => {});
      }
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [saveLog, date]);

  const compliance = calcCompliance(log, activeActivities, activeACV, activeSupplements);
  const actDone    = activeActivities.filter(a => log.activities?.[a.id]).length;
  const acvDone    = activeACV.filter(a => log.acv?.[a.id]).length;
  const suppDone   = activeSupplements.filter(s => log.supplements?.[s.id]).length;
  const update     = useCallback((field, val) => { updateLog(field, val); triggerAutoSave(); }, [updateLog, triggerAutoSave]);

  // Keep the auto-derived protocol ticks in sync with the Workout log.
  // Writes only when the derived value actually differs, so this can't loop.
  // Past dates are skipped: editing an old day shouldn't silently rewrite it.
  useEffect(() => {
    if (loading || date !== today()) return;
    const derived = deriveActivityTicks({
      sets:   workoutSummary.sets   || [],
      cardio: workoutSummary.cardio || [],
    });
    const cur = log.activities || {};
    // Only touch ids this member actually has assigned
    const assigned = new Set(activeActivities.map(a => a.id));
    // Additive only — we tick, never untick. The AI chat can also set these
    // (e.g. "walk done" with no distance given, which produces no cardio row),
    // and un-ticking would silently undo that and damage the member's
    // compliance score. A stale tick is the safer failure.
    const patch = {};
    for (const id of AUTO_TICK_IDS) {
      if (!assigned.has(id)) continue;
      if (derived[id] && !cur[id]) patch[id] = true;
    }
    if (Object.keys(patch).length) update('activities', { ...cur, ...patch });
  }, [workoutSummary, log.activities, activeActivities, loading, date, update]);


  // ── ACV expand state ───────────────────────────────────────────────────────
  const [acvExpanded, setAcvExpanded] = useState(false);

  // Sprint 3: pre-fill food log from prescribed meal — MUST be after `update`
  const logMeal = useCallback((meal) => {
    const newItems = (meal.items||[]).map(item => ({
      id:       Date.now() + Math.random(),
      name:     item.food_name,
      grams:    item.qty_g,
      meal:     meal.name,
      food_id:  item.food_id  || null,
      per_100g: item.per_100g || null,
    }));
    const existing = log.food || [];
    // Only skip items already in THIS meal slot — same food can appear in multiple meals
    const existingInMeal = existing
      .filter(f => f.meal === meal.name)
      .map(f => f.name?.toLowerCase());
    const toAdd = newItems.filter(i => !existingInMeal.includes(i.name?.toLowerCase()));
    update('food', [...existing, ...toAdd]);
  }, [log.food, update]);

  // ── Derived, computed once per render for every widget ─────────────────────
  // The old render body recomputed weight/BMR/kcal/energy in five different
  // IIFEs. One pass here; every consumer reads the same numbers.
  const isToday   = date === today();
  const weightKg  = parseFloat(log.weight) || parseFloat(protocol?.start_weight) || 0;
  const kcalIn    = foodKcal(log.food || []);
  const kcalTarget = protocol?.macros?.kcal || null;
  const bmr = calcBMR({ weightKg, heightCm: bodyStats.height_cm, age: profileAge, gender: bodyStats.gender });
  const work = sessionEnergy({
    exercises: [{ sets: workoutSummary.sets || [] }],
    cardio:    workoutSummary.cardio || [],
    bodyWeightKg: weightKg,
  });
  const workoutKcal = work.totalKcal;
  // Needs BMR inputs and at least some food logged, else the "deficit" would
  // just be the whole day's TDEE and mislead.
  const balance = (bmr && kcalIn > 0) ? kcalIn - (Math.round(bmr * 1.2) + workoutKcal) : null;

  const protocolDone  = actDone + acvDone + suppDone;
  const protocolTotal = activeActivities.length + activeACV.length + activeSupplements.length;

  const micro = countMicrosMet({
    foodItems: log.food || [],
    supplements: log.supplements || {},
    activities: log.activities || {},
    activeActivities,
    rdaOverrides: protocol?.rda_overrides || {},
  });

  const sleepMins = sleepMinutes(log.sleep?.bedtime, log.sleep?.waketime);
  const sleepText = formatSleep(sleepMins);

  const pending = pendingLabels({
    activeActivities, activeACV, activeSupplements, log,
    activitiesLabel: terms.activities,
  });

  const read = dailyRead({
    isToday,
    weight: log.weight || null,
    kcalIn,
    kcalTarget,
    balance,
    protocolDone,
    protocolTotal,
    waterMl: log.water || 0,
    waterTarget: protocol?.water_target || 3000,
    foodCount: (log.food || []).length,
    workoutKcal,
    volumeKg: work.volumeKg,
    sleepSet: !!(log.sleep?.bedtime && log.sleep?.waketime),
    streak, streakIsBest,
    pendingLabels: pending,
  });

  const coachRows = coachCardRows({
    coachPlan,
    macrosKcal: kcalTarget,
    sets:   workoutSummary.sets,
    cardio: workoutSummary.cardio,
    food:   log.food,
    mealPlans,
  });

  const weightDelta = (log.weight && yesterdayWeight != null)
    ? +(parseFloat(log.weight) - yesterdayWeight).toFixed(1)
    : null;

  const hasLoggedAnything =
    !!log.weight || (log.food?.length > 0) || (log.water || 0) > 0 ||
    Object.values(log.activities || {}).some(Boolean);

  // Date navigation, shared by the header arrows
  const goPrevDay = async () => {
    await flushPendingSave();
    const d = new Date(date + 'T12:00:00');
    d.setDate(d.getDate() - 1);
    setDate(istDate(d));
  };
  // Steps forward ONE day, mirroring '‹'. It used to jump straight back to
  // today, so a member who went back five days to fix something and then
  // wanted day four was thrown to today and had to press '‹' four more times.
  const goNextDay = async () => {
    await flushPendingSave();
    const d = new Date(`${date}T12:00:00`);   // midday: no DST/offset edge
    d.setDate(d.getDate() + 1);
    const next = istDate(d);
    setDate(next > today() ? today() : next);
  };
  const goToday = async () => { await flushPendingSave(); setDate(today()); };

  const openSheet  = (key) => { setHeroPanel(key); haptic(10); };
  const closeSheet = () => setHeroPanel(null);

  return {
    // identity & settings
    user, terms, ageMode, avatarIdx, avatar: AVATARS_LIST[avatarIdx] || AVATARS_LIST[0],
    // store
    date, isToday, log, protocol, loading, saving, saved, queued, error,
    update, setDate, goPrevDay, goNextDay, goToday,
    autoSaved,
    // protocol items
    activeActivities, activeACV, activeSupplements,
    actDone, acvDone, suppDone, protocolDone, protocolTotal, compliance,
    acvExpanded, setAcvExpanded,
    // numbers
    weightKg, weightDelta, yesterdayWeight, kcalIn, kcalTarget, bmr, balance,
    workoutKcal, workoutSummary, workoutRefreshKey, micro, sleepMins, sleepText,
    // AI read + pending
    read, pending,
    // coach
    coachPlan, mealPlans, coachRows, unreadNotes, markNotesRead,
    replyTo, setReplyTo, replyText, setReplyText, replyBusy, replyError, setReplyError, replied, sendReply,
    logMeal,
    // fasting / profile
    profileAge, bodyStats,
    // streak & milestone
    streak, streakIsBest, milestone, setMilestone, volumePB,
    // sheets (heroPanel under its historical name)
    sheet: heroPanel, openSheet, closeSheet,
    // protocol chip long-press popover
    chipInfo, setChipInfo, chipPressStart, chipPressEnd,
    // weight validation
    weightWarning, validateWeight,
    hasLoggedAnything,
  };
}
