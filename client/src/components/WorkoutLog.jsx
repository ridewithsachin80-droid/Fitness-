/**
 * WorkoutLog.jsx
 *
 * Resistance Training — Phase 1 (freeform logging) + Phase 2 (coach-assigned
 * programs). If the member has an active program, day tabs let them pull in
 * that day's prescribed exercises (with target sets/reps shown for context);
 * otherwise — or in addition — they can always search and log freeform.
 * Selecting a program day only ADDS exercises, never replaces what's already
 * logged, so there's no risk of it clobbering real data.
 *
 * Auto-saves on every change (debounced), matching the rest of the daily
 * log — no manual save button anywhere in this app anymore.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Card, CardSkeleton } from './UI';
import { haptic } from '../store/settingsStore';
import { searchExercises, addCustomExercise, getWorkout, saveWorkout, getExerciseHistory } from '../api/workouts';
import { getActiveProgram } from '../api/programs';
import { parseVoiceSet } from '../utils/voiceSetParser';
import { CARDIO_TYPES, cardioTypeById, sessionEnergy, distanceFrom } from '../utils/exerciseCalories';
import { useLogStore } from '../store/logStore';
import { useAIChat } from './AIChatLog';
import { plural } from '../constants';
import { useVoiceComposer } from './VoiceComposer';
import { applyProgramDay, switchCounts } from '../utils/workoutSession';
import { istWeekday, isWeekdayScheduled, labelHasWeekday } from '../utils/programDay';

function formatTarget(ex) {
  const reps = ex.target_reps_max && ex.target_reps_max !== ex.target_reps_min
    ? `${ex.target_reps_min}-${ex.target_reps_max}` : `${ex.target_reps_min}`;
  return `${ex.target_sets} × ${reps}`;
}

export default function WorkoutLog({ date }) {
  const [exercisesInSession, setExercisesInSession] = useState([]); // [{exercise_id, exercise_name, sets:[{reps,weight_kg}]}]
  const [durationMin, setDurationMin] = useState('');
  const [sessionNotes, setSessionNotes] = useState('');
  const [cardio, setCardio] = useState([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch]       = useState('');
  const [results, setResults]     = useState([]);
  const [searching, setSearching] = useState(false);
  const [listeningSetKey, setListeningSetKey] = useState(null); // exercise_id while mic is capturing a set for it

  const [program, setProgram]         = useState(null); // { id, name } or null
  const [programDays, setProgramDays] = useState([]);   // [{ day_number, day_label, exercises: [...] }]

  // "Last time you did this" — Map<exercise_id, { weight_kg, reps, date } | null>.
  // null (not undefined) means "checked, genuinely no prior history" — that
  // distinction matters so we don't refetch forever for first-time exercises.
  const [lastTimeByExerciseId, setLastTimeByExerciseId] = useState(new Map());
  const fetchingLastTimeRef = useRef(new Set()); // exercise_ids currently being fetched, to avoid duplicate concurrent requests

  // Rest timer — one global countdown (you only rest from one exercise at a
  // time in practice), manually started so it never fires from an unrelated edit.
  const [restSeconds, setRestSeconds] = useState(null); // null = not running
  const [restTotal, setRestTotal]     = useState(90);
  const restIntervalRef = useRef(null);

  const debounceRef   = useRef(null);
  const saveRef        = useRef(null);
  const justLoadedRef  = useRef(false); // true for one render right after a (re)load, to skip the resulting save-effect run

  // ── Rest timer countdown — single interval, always cleared before a new
  // one starts and on unmount, so there's no risk of stacking intervals or
  // leaking one past the component's lifetime. ───────────────────────────────
  // ── Rest timer countdown — exactly one interval per timer "session," not
  // one recreated every tick. Keying the effect on (restSeconds === null)
  // rather than on restSeconds itself means it only re-runs on start/cancel,
  // since that boolean doesn't change between e.g. 45 and 44. The interval's
  // own callback handles stopping at zero and clearing itself. ───────────────
  useEffect(() => {
    if (restSeconds === null) {
      clearInterval(restIntervalRef.current);
      return;
    }
    restIntervalRef.current = setInterval(() => {
      setRestSeconds(s => {
        if (s === null) return null; // cancelled mid-tick
        if (s <= 1) { clearInterval(restIntervalRef.current); haptic(60); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(restIntervalRef.current);
  }, [restSeconds === null]);

  const startRest = (seconds) => { setRestTotal(seconds); setRestSeconds(seconds); haptic(20); };
  const cancelRest = () => setRestSeconds(null);

  // ── "Last time you did this" — fetch on demand for whatever exercises are
  // currently in the session, skipping any already fetched (or in flight). ──
  useEffect(() => {
    let cancelled = false;
    const toFetch = exercisesInSession
      .map(ex => ex.exercise_id)
      .filter(id => !lastTimeByExerciseId.has(id) && !fetchingLastTimeRef.current.has(id));

    if (toFetch.length === 0) return;
    toFetch.forEach(id => fetchingLastTimeRef.current.add(id));

    Promise.all(toFetch.map(id =>
      getExerciseHistory(id, 5)
        .then(({ data: rows }) => {
          // Find the most recent session that ISN'T today (today's own
          // in-progress numbers aren't "last time," they're "right now").
          const priorDates = [...new Set(rows.map(r => r.session_date).filter(d => d !== date))];
          if (priorDates.length === 0) return [id, null];
          const lastDate = priorDates[priorDates.length - 1]; // rows arrive chronological ascending
          const setsThatDay = rows.filter(r => r.session_date === lastDate);
          // "Best" set for display purposes: heaviest weight, ties broken by more reps.
          const best = setsThatDay.reduce((a, b) => {
            const bw = parseFloat(b.weight_kg) || 0, aw = parseFloat(a.weight_kg) || 0;
            if (bw !== aw) return bw > aw ? b : a;
            return (parseInt(b.reps) || 0) > (parseInt(a.reps) || 0) ? b : a;
          });
          return [id, { weight_kg: parseFloat(best.weight_kg) || 0, reps: parseInt(best.reps) || 0, date: lastDate }];
        })
        .catch(() => [id, null])
    )).then(results => {
      // Always clear the in-flight markers, regardless of whether this run
      // was cancelled — otherwise a cancelled fetch's ids would be
      // permanently stuck "fetching" forever (excluded from every future
      // attempt, with no way to ever retry them). Only the actual state
      // update needs the cancelled guard, to avoid applying stale results.
      toFetch.forEach(id => fetchingLastTimeRef.current.delete(id));
      if (cancelled) return;
      setLastTimeByExerciseId(prev => {
        const next = new Map(prev);
        for (const [id, val] of results) next.set(id, val);
        return next;
      });
    });

    return () => { cancelled = true; };
  }, [exercisesInSession, date, lastTimeByExerciseId]);

  // ── Load the member's active program once (not date-scoped — a program
  // stays assigned across days until the coach changes it) ──────────────────
  useEffect(() => {
    getActiveProgram().then(({ data }) => {
      setProgram(data.program);
      setProgramDays(data.days || []);
    }).catch(() => {});
  }, []);

  // Derived fresh from programDays every render — never stored in state, so
  // it can't go stale or survive past whenever the program actually changes.
  const targetByExerciseId = useMemo(() => {
    const map = new Map();
    for (const day of programDays) {
      for (const ex of day.exercises) {
        map.set(ex.exercise_id, { target_sets: ex.target_sets, target_reps_min: ex.target_reps_min, target_reps_max: ex.target_reps_max });
      }
    }
    return map;
  }, [programDays]);

  // ── Load existing session for this date ────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // "Last time" is only meaningful relative to whichever date is currently
    // being viewed (it means "the most recent session before THIS one") —
    // switching dates invalidates the whole cache, not just the specific
    // exercises that differ between the two days.
    setLastTimeByExerciseId(new Map());
    fetchingLastTimeRef.current.clear();
    getWorkout(date).then(({ data }) => {
      if (cancelled) return;
      justLoadedRef.current = true;
      setExercisesInSession(data.exercises || []);
      setDurationMin(data.session?.duration_min || '');
      setSessionNotes(data.session?.notes || '');
      setCardio(Array.isArray(data.cardio) ? data.cardio : []);
    }).catch(() => {}).finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
      clearTimeout(saveRef.current); // don't let a pending save from a previous date linger past unmount
    };
  }, [date]);

  // ── Auto-save (debounced, 4s — matches the rest of the daily log) ──────────
  // Single source of truth for saving: reacts to state changes directly,
  // rather than every mutator separately deciding to trigger a save. This
  // means every mutator can safely use the functional setState form (always
  // correct regardless of timing/async gaps — important for voiceLogSet,
  // which has a multi-second await in the middle where other edits could
  // happen) without needing to also separately get the save timing right.
  useEffect(() => {
    if (justLoadedRef.current) { justLoadedRef.current = false; return; } // skip save right after loading
    clearTimeout(saveRef.current);
    saveRef.current = setTimeout(() => {
      saveWorkout({
        date,
        duration_min: durationMin ? parseInt(durationMin) : null,
        exercises: exercisesInSession.map(ex => ({ exercise_id: ex.exercise_id, sets: ex.sets })),
        cardio,
      }).catch(() => {});
    }, 4000);
    return () => clearTimeout(saveRef.current);
  }, [exercisesInSession, durationMin, date, cardio]);

  // ── Exercise search ─────────────────────────────────────────────────────────
  const runSearch = useCallback(async (q) => {
    if (!q || q.length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const { data } = await searchExercises(q);
      setResults(data);
    } catch { setResults([]); }
    finally { setSearching(false); }
  }, []);

  const handleSearchChange = (val) => {
    setSearch(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(val), 250);
  };

  // Voice now goes through the shared VoiceComposer, the same path the AI chat
  // uses: record audio -> Gemini/Groq transcript -> editable review card.
  //
  // The old path was raw Web Speech, which Safari does not implement. That is
  // why this screen told iPhone members "try Chrome on Android" while the AI
  // chat's mic worked fine on the very same phone. Recording and transcribing
  // server-side works everywhere, handles Hinglish, and gives a review step
  // instead of an alert() when it mishears.
  const searchVoice = useVoiceComposer({
    onSend: (text) => {
      const t = (text || '').trim();
      if (!t) return;
      setSearch(t);
      runSearch(t);
    },
  });

  const addExercise = (exercise) => {
    setExercisesInSession(prev => {
      if (prev.some(e => e.exercise_id === exercise.id)) return prev; // already added — never overwrite
      return [...prev, { exercise_id: exercise.id, exercise_name: exercise.name, sets: [] }];
    });
    setSearch(''); setResults([]);
    haptic(20);
  };

  const addCustomAndUse = async () => {
    if (!search.trim()) return;
    try {
      const { data } = await addCustomExercise({ name: search.trim() });
      addExercise(data);
    } catch { /* name conflict or network — just no-op */ }
  };

  // Which program day the member is currently viewing. Tapping a chip SWITCHES
  // to that day: the previous day's untouched exercises leave, the new day's
  // arrive. Anything with a set already entered is real training data and is
  // never removed by a chip tap — Remove on the exercise is the only way out.
  // Manually searched-in exercises (no fromProgram flag) are also left alone.
  const [activeProgramDay, setActiveProgramDay] = useState(null);
  // Transient one-line explanation of the last day switch. Auto-clears; a
  // member mid-set should not have to dismiss anything.
  const [switchNote, setSwitchNote] = useState('');

  useEffect(() => {
    if (!switchNote) return;
    const t = setTimeout(() => setSwitchNote(''), 5000);
    // Cleared on unmount and whenever a newer note replaces this one, so two
    // quick switches can't leave a stale timer wiping the second message.
    return () => clearTimeout(t);
  }, [switchNote]);

  // Named switchProgramDay, not addProgramDay: tapping a chip REPLACES the
  // previous day's untouched exercises. The old name described what it did
  // before the switch-semantics fix and was the last thing still claiming
  // otherwise.
  const switchProgramDay = (day) => {
    haptic(15);
    const previous = activeProgramDay;

    // The kept/dropped split is computed HERE, from current state, rather than
    // inside the setState updater. An updater must be pure — React runs it
    // twice in StrictMode, so calling setSwitchNote from inside would fire the
    // toast twice and make the counts unreliable.
    const current = exercisesInSession;

    // ── 5.4: say what just happened ─────────────────────────────────────────
    // Switching silently made five exercises vanish. Worse, if some had sets
    // entered, the member got a MIXED list — part of the old day still there,
    // part gone — with no explanation for the pattern. Only announce a real
    // switch, not the first tap of the day.
    if (previous != null && previous !== day.day_number) {
      const { removed, keptWithData } = switchCounts(current, day);
      const label = day.day_label || `Day ${day.day_number}`;
      const parts = [];
      if (removed)      parts.push(`${removed} ${plural(removed, 'exercise')} swapped out`);
      if (keptWithData) parts.push(`${keptWithData} kept — your sets are safe`);
      setSwitchNote(parts.length ? `Switched to ${label} · ${parts.join(' · ')}`
                                 : `Switched to ${label}`);
    }

    setActiveProgramDay(day.day_number);
    // Recomputed from `prev` so the update stays correct even if state moved
    // between the read above and this updater running. The switch rules live in
    // utils/workoutSession.js — the same function test-coach-view now runs.
    setExercisesInSession(prev => applyProgramDay(prev, day));
  };

  const removeExercise = (exerciseId) => {
    setExercisesInSession(prev => prev.filter(e => e.exercise_id !== exerciseId));
  };

  // ── Set management ──────────────────────────────────────────────────────────
  const addSetRow = (exerciseId, prefill = { reps: '', weight_kg: '' }) => {
    setExercisesInSession(prev => prev.map(ex =>
      ex.exercise_id === exerciseId ? { ...ex, sets: [...ex.sets, prefill] } : ex
    ));
  };

  const updateSet = (exerciseId, setIndex, field, value) => {
    setExercisesInSession(prev => prev.map(ex => {
      if (ex.exercise_id !== exerciseId) return ex;
      const sets = ex.sets.map((s, i) => i === setIndex ? { ...s, [field]: value } : s);
      return { ...ex, sets };
    }));
  };

  const removeSet = (exerciseId, setIndex) => {
    setExercisesInSession(prev => prev.map(ex =>
      ex.exercise_id === exerciseId ? { ...ex, sets: ex.sets.filter((_, i) => i !== setIndex) } : ex
    ));
  };

  // Voice-log a set: "60 kg 8 reps" → fills weight+reps, adds `sets` count of
  // identical rows in one go (e.g. "3 sets of 60 kg 8 reps" adds 3 rows).
  // Uses the functional setState form deliberately: transcription takes real
  // time, during which other edits can happen, so reading prev state at
  // apply-time rather than call-time is what keeps this safe.
  //
  // Which exercise the set-entry mic is capturing for. The composer is a
  // single shared instance, so the target has to be remembered across the
  // async transcription rather than passed through it.
  const voiceTargetRef = useRef(null);
  const [setVoiceError, setSetVoiceError] = useState('');

  const setVoice = useVoiceComposer({
    onSend: (text) => {
      const exerciseId = voiceTargetRef.current;
      // Whatever happens next, this capture is finished — clear the highlight
      // and the target. Under the old Web Speech flow this was reset when
      // listenOnce() resolved; when that went away the reset went with it, and
      // the highlighted "Say a set" row would have stayed lit forever after
      // the first use.
      setListeningSetKey(null);
      voiceTargetRef.current = null;
      if (!exerciseId) return;

      const { sets, reps, weight_kg } = parseVoiceSet(text || '');
      if (reps === null) {
        // Inline, not alert(). An alert is modal, loses the transcript, and on
        // iOS interrupts the audio session — which mattered more once voice
        // actually worked there.
        setSetVoiceError(`Couldn't read "${text}" — try "60 kg 8 reps".`);
        return;
      }
      setSetVoiceError('');
      setExercisesInSession(prev => prev.map(ex => {
        if (ex.exercise_id !== exerciseId) return ex;
        const newSets = Array.from({ length: Math.max(1, sets) }, () => ({ reps, weight_kg }));
        return { ...ex, sets: [...ex.sets, ...newSets] };
      }));
      haptic(30);
    },
  });

  const voiceLogSet = (exerciseId) => {
    // Tapping the row that is already capturing cancels it, rather than
    // silently re-arming the same target.
    if (voiceTargetRef.current === exerciseId && listeningSetKey === exerciseId) {
      voiceTargetRef.current = null;
      setListeningSetKey(null);
      return;
    }
    voiceTargetRef.current = exerciseId;
    setSetVoiceError('');
    setListeningSetKey(exerciseId);
  };

  const openAIChat = useAIChat(s => s.openChat);

  const handleDurationChange = (val) => setDurationMin(val);

  if (loading) return <Card><CardSkeleton lines={3} /></Card>; // page-level loader already covers the rest of DailyLog; this just avoids an abrupt pop-in for this one card

  return (
    <Card>
      {/* AI chat entry point — mirrors the food log's banner so members reach
          the same assistant from either place. */}
      <button
        onClick={() => { haptic(15); openAIChat(); }}
        style={{ minHeight: 48 }}
        className="w-full flex items-center gap-3 mb-3 bg-gradient-to-r from-[#D4AF37]/[0.14] to-[#8a6a1e]/[0.10] border border-[#D4AF37]/30 hover:border-[#D4AF37]/55 rounded-2xl px-4 py-3 transition-all active:scale-[0.99]">
        <span className="w-8 h-8 rounded-full bg-gradient-to-br from-[#D4AF37] to-[#8a6a1e] flex items-center justify-center text-sm flex-shrink-0 shadow-[0_0_14px_rgba(212,175,55,0.4)]">✨</span>
        <span className="text-left min-w-0">
          <span className="block text-sm font-bold text-white leading-tight">Log with AI Chat</span>
          <span className="block text-[11px] text-[#8e8e9a] leading-tight truncate">"Bench press 3 sets of 20kg" or "5 km walk in 1 hour"</span>
        </span>
      </button>

      {/* Rest timer banner — manually started via the ⏱ button on any exercise */}
      {restSeconds !== null && (
        <div className={`flex items-center justify-between mb-3 px-3 py-2.5 rounded-xl border transition-colors ${
          restSeconds <= 0 ? 'bg-[rgba(212,175,106,0.12)] border-[rgba(212,175,106,0.30)]' : 'bg-[rgba(212,175,55,0.10)] border-[rgba(212,175,55,0.20)]'}`}>
          <div className="flex items-center gap-2">
            <span className="text-lg">⏱</span>
            <span className={`font-display text-lg font-semibold ${restSeconds <= 0 ? 'text-[#d4af6a]' : 'text-[#ededf0]'}`}>
              {restSeconds <= 0 ? "Time's up!" : `${restSeconds}s`}
            </span>
            {restSeconds > 0 && <span className="text-xs text-[#5a5a68]">resting…</span>}
          </div>
          <div className="flex gap-1.5">
            {restSeconds <= 0 ? (
              <button onClick={cancelRest} className="text-xs font-semibold text-[#e0c98a] px-2.5 py-1">Dismiss</button>
            ) : (
              <>
                <button onClick={() => setRestSeconds(s => (s || 0) + 30)} className="text-xs font-semibold text-[#9a9aa6] hover:text-[#d8d8de] px-2">+30s</button>
                <button onClick={cancelRest} className="text-xs font-semibold text-[#5a5a68] hover:text-red-400 px-2">Cancel</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Program day picker — only adds exercises, never replaces anything already logged */}
      {program && programDays.length > 0 && (
        <div className="mb-3">
          <p className="text-xs text-[#9a9aa6] mb-1.5">
            <span className="font-semibold text-[#e0c98a]">{program.name}</span> — tap a day to pull in today's exercises:
          </p>
          <div className="flex gap-1.5 flex-wrap">
            {(() => {
              // Programs assigned by the coach carry the weekday in the label
              // ("Push · Mon"). Highlight today's day so the member doesn't
              // have to think about which circuit is due.
              // Word-boundary matching lives in utils/programDay.js and is shared
              // with DailyLog and asserted against the server. `.includes('Mon')`
              // here used to make "Monsoon Circuit" a Monday session.
              const todayWd = istWeekday();
              const scheduled = isWeekdayScheduled(programDays);
              return programDays.map((day, di) => {
                // Unscheduled program (no weekdays in labels): the first day is
                // today's default rather than nothing being highlighted.
                const isToday = scheduled
                  ? labelHasWeekday(day.day_label, todayWd)
                  : di === 0;
                const isActive = activeProgramDay != null
                  ? activeProgramDay === day.day_number   // member picked one → that wins
                  : isToday;                              // nothing picked yet → highlight today
                return (
                  <button key={day.day_number} onClick={() => switchProgramDay(day)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors ${
                      isActive
                        ? 'bg-[#D4AF37] border-[#D4AF37] text-[#121316]'
                        : 'bg-[rgba(212,175,55,0.10)] border-[rgba(212,175,55,0.20)] text-[#e0c98a] hover:bg-[rgba(212,175,55,0.18)]'
                    }`}>
                    {(isActive || (activeProgramDay == null && isToday)) && '▸ '}{day.day_label}
                  </button>
                );
              });
            })()}
          </div>

          {/* What the last switch did. Auto-clears — a member mid-set should
              not have to dismiss anything. */}
          {switchNote && (
            <p className="mt-2 text-[11px] text-[#F0E2B6] leading-relaxed">
              {switchNote}
            </p>
          )}
        </div>
      )}

      {/* Exercise search */}
      <div className="flex gap-2 mb-3">
        <div className="flex-1 relative">
          <input
            value={search}
            onChange={e => handleSearchChange(e.target.value)}
            placeholder="Search exercises… e.g. Bench Press"
            className="w-full px-3 py-2.5 bg-[#1A1C20] border border-white/[0.1] rounded-xl text-sm
              text-[#ededf0] placeholder-[#5a5a68] focus:outline-none focus:ring-2 focus:ring-[rgba(212,175,55,0.30)]"
          />
          {(results.length > 0 || (search.length >= 2 && !searching)) && (
            <div className="absolute left-0 right-0 top-full mt-1 bg-[#1A1C20] border border-white/[0.1]
              rounded-xl shadow-card-raised z-20 max-h-56 overflow-y-auto">
              {results.map(r => (
                <button key={r.id} onClick={() => addExercise(r)}
                  className="w-full text-left px-3 py-2.5 text-sm text-[#d8d8de] hover:bg-white/[0.05] flex items-center justify-between">
                  <span>{r.name}</span>
                  {r.muscle_group && <span className="text-[10px] text-[#5a5a68]">{r.muscle_group}</span>}
                </button>
              ))}
              {results.length === 0 && search.length >= 2 && !searching && (
                <button onClick={addCustomAndUse}
                  className="w-full text-left px-3 py-2.5 text-sm text-[#e0c98a] hover:bg-white/[0.05]">
                  + Add "{search}" as a new exercise
                </button>
              )}
            </div>
          )}
        </div>
        <div className="px-2 flex items-center bg-white/[0.06] border border-white/[0.1] rounded-xl">
          {searchVoice.micButton}
        </div>
      </div>
      {/* Editable transcript before it becomes a search — a mishearing is
          corrected here instead of silently searching for the wrong thing. */}
      {searchVoice.card}

      {/* Logged exercises */}
      {exercisesInSession.length === 0 ? (
        <p className="text-xs text-[#5a5a68] text-center py-4">
          No exercises logged yet — search above to add your first one.
        </p>
      ) : (
        <div className="space-y-3">
          {exercisesInSession.map(ex => {
            const target = targetByExerciseId.get(ex.exercise_id);
            const lastTime = lastTimeByExerciseId.get(ex.exercise_id);
            return (
            <div key={ex.exercise_id} className="border border-white/[0.07] rounded-xl p-3 bg-white/[0.02]">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className="text-sm font-semibold text-[#ededf0]">{ex.exercise_name}</span>
                  {target && (
                    <span className="ml-2 text-[10px] font-semibold text-[#e0c98a] bg-[rgba(212,175,55,0.10)] px-1.5 py-0.5 rounded-full">
                      Target: {formatTarget(target)}
                    </span>
                  )}
                  {lastTime && (
                    <p className="text-[10px] text-[#5a5a68] mt-0.5">
                      Last time: {lastTime.weight_kg} kg × {lastTime.reps}
                    </p>
                  )}
                </div>
                <button onClick={() => removeExercise(ex.exercise_id)} className="text-[#5a5a68] hover:text-red-400 text-xs">Remove</button>
              </div>

              {ex.sets.length > 0 && (
                <div className="space-y-1.5 mb-2">
                  <div className="flex gap-2 text-[10px] text-[#5a5a68] font-semibold px-1">
                    <span className="w-8">Set</span>
                    <span className="flex-1 min-w-0 text-center">Weight (kg)</span>
                    <span className="flex-1 min-w-0 text-center">Reps</span>
                    <span className="w-6" />
                    <span className="w-6" />
                  </div>
                  {ex.sets.map((set, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <span className="w-8 text-xs text-[#9a9aa6] text-center">{i + 1}</span>
                      <input type="number" inputMode="decimal" value={set.weight_kg}
                        onChange={e => updateSet(ex.exercise_id, i, 'weight_kg', e.target.value)}
                        placeholder="0"
                        className="flex-1 min-w-0 px-2 py-1.5 bg-[#1A1C20] border border-white/[0.1] rounded-lg text-sm text-center text-[#ededf0] focus:outline-none focus:ring-2 focus:ring-[rgba(212,175,55,0.30)]" />
                      <input type="number" inputMode="numeric" value={set.reps}
                        onChange={e => updateSet(ex.exercise_id, i, 'reps', e.target.value)}
                        placeholder="0"
                        className="flex-1 min-w-0 px-2 py-1.5 bg-[#1A1C20] border border-white/[0.1] rounded-lg text-sm text-center text-[#ededf0] focus:outline-none focus:ring-2 focus:ring-[rgba(212,175,55,0.30)]" />
                      <button onClick={() => removeSet(ex.exercise_id, i)} className="w-6 flex-shrink-0 text-[#5a5a68] hover:text-red-400 text-sm">×</button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2 mt-2">
                <button onClick={() => addSetRow(ex.exercise_id)}
                  className="flex-1 py-2 text-xs font-semibold text-[#e0c98a] bg-[rgba(212,175,55,0.08)] border border-[rgba(212,175,55,0.18)] rounded-lg hover:bg-[rgba(212,175,55,0.14)] transition-colors">
                  + Add Set
                </button>
                <div
                  onClickCapture={() => voiceLogSet(ex.exercise_id)}
                  className={`px-3 py-1 rounded-lg border flex items-center gap-1.5 text-xs font-semibold transition-colors ${
                    listeningSetKey === ex.exercise_id
                      ? 'bg-[rgba(212,175,55,0.14)] border-[rgba(212,175,55,0.35)] text-[#F0E2B6]'
                      : 'bg-white/[0.06] border-white/[0.1] text-[#d8d8de] hover:bg-white/[0.1]'}`}>
                  {setVoice.micButton}
                  <span>Say a set</span>
                </div>
                {ex.sets.length > 0 && (
                  <button onClick={() => startRest(90)}
                    className="px-3 py-2 rounded-lg border text-xs font-semibold bg-white/[0.04] border-white/[0.08] text-[#9EA3B0] hover:bg-white/[0.08] hover:text-[#FFFFFF] transition-colors">
                    ⏱
                  </button>
                )}
              </div>
            </div>
            );
          })}
        </div>
      )}

      {/* Total gym time — informational only. Calories come from volume
          lifted and cardio MET × time, never from this field, so a stale or
          mistyped value can no longer distort the estimate. */}
      {exercisesInSession.length > 0 && (
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/[0.06]">
          <span className="text-xs text-[#9a9aa6]">Time in gym:</span>
          <input type="number" inputMode="numeric" value={durationMin}
            onChange={e => handleDurationChange(e.target.value)}
            placeholder="30" className="w-16 px-2 py-1 bg-[#1A1C20] border border-white/[0.1] rounded-lg text-sm text-center text-[#ededf0] focus:outline-none focus:ring-2 focus:ring-[rgba(212,175,55,0.30)]" />
          <span className="text-xs text-[#5a5a68]">min</span>
          <span className="text-[10px] text-[#5a5a68] ml-auto">optional</span>
        </div>
      )}

      {/* ── Cardio ── */}
      <div className="mt-3 pt-3 border-t border-white/[0.06]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-bold text-[#5a5a68] tracking-wider">Cardio</span>
          <button onClick={() => setCardio(c => [...c, { type: 'walking', duration_min: 30, speed_kmh: 5 }])}
            style={{ minHeight: 32 }}
            className="text-[11px] font-bold text-[#e0c98a] bg-[rgba(212,175,55,0.10)] border border-[rgba(212,175,55,0.25)] rounded-lg px-3 active:scale-95 transition-transform">
            + Add cardio
          </button>
        </div>

        {cardio.length === 0 ? (
          <p className="text-[11px] text-[#5a5a68]">No cardio logged — add a walk, run, cycle or swim.</p>
        ) : (
          <div className="space-y-2">
            {cardio.map((c, i) => {
              const t = cardioTypeById(c.type);
              const dist = c.distance_km ?? distanceFrom(c.speed_kmh, c.duration_min);
              const patch = (field, val) => setCardio(list =>
                list.map((row, idx) => (idx === i ? { ...row, [field]: val } : row))
              );
              return (
                <div key={i} className="bg-[#0d0d11] border border-white/[0.06] rounded-xl p-2.5">
                  <div className="flex items-center gap-2 mb-2">
                    <select value={c.type}
                      onChange={e => patch('type', e.target.value)}
                      style={{ minHeight: 36 }}
                      className="flex-1 min-w-0 text-xs font-semibold bg-[#1A1C20] border border-white/[0.1] rounded-lg px-2 text-[#ededf0] focus:outline-none focus:ring-2 focus:ring-[rgba(212,175,55,0.30)]">
                      {CARDIO_TYPES.map(o => (
                        <option key={o.id} value={o.id}>{o.icon} {o.label}</option>
                      ))}
                    </select>
                    <button onClick={() => setCardio(list => list.filter((_, idx) => idx !== i))}
                      className="w-6 flex-shrink-0 text-[#5a5a68] hover:text-red-400 text-sm">×</button>
                  </div>
                  <div className="flex gap-2">
                    <label className="flex-1 min-w-0">
                      <span className="block text-[9px] text-[#5a5a68] tracking-wider mb-1">Minutes</span>
                      <input type="number" inputMode="numeric" value={c.duration_min ?? ''}
                        onChange={e => patch('duration_min', e.target.value)}
                        placeholder="30"
                        className="w-full px-2 py-1.5 bg-[#1A1C20] border border-white/[0.1] rounded-lg text-sm text-center text-[#ededf0] focus:outline-none focus:ring-2 focus:ring-[rgba(212,175,55,0.30)]" />
                    </label>
                    {t.speed && (
                      <label className="flex-1 min-w-0">
                        <span className="block text-[9px] text-[#5a5a68] tracking-wider mb-1">Speed km/h</span>
                        <input type="number" inputMode="decimal" step="0.5" value={c.speed_kmh ?? ''}
                          onChange={e => patch('speed_kmh', e.target.value)}
                          placeholder="5"
                          className="w-full px-2 py-1.5 bg-[#1A1C20] border border-white/[0.1] rounded-lg text-sm text-center text-[#ededf0] focus:outline-none focus:ring-2 focus:ring-[rgba(212,175,55,0.30)]" />
                      </label>
                    )}
                  </div>
                  {t.speed && dist != null && (
                    <p className="text-[10px] text-[#5a5a68] mt-1.5">≈ {dist} km covered</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Calories burned ── */}
      {(() => {
        const bodyWeightKg =
          parseFloat(useLogStore.getState().log?.weight) ||
          parseFloat(useLogStore.getState().protocol?.start_weight) || 0;
        const e = sessionEnergy({ exercises: exercisesInSession, cardio, bodyWeightKg });
        if (e.totalKcal === 0 && e.sets === 0 && e.cardioMin === 0) return null;
        return (
          <div className="mt-3 pt-3 border-t border-white/[0.06]">
            <div className="bg-[rgba(212,175,55,0.08)] border border-[rgba(212,175,55,0.22)] rounded-xl px-3.5 py-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-bold text-[#e0c98a] tracking-wider">Calories burned</span>
                <span className="font-display text-xl font-bold text-orange-400">{e.totalKcal} kcal</span>
              </div>
              <div className="space-y-0.5">
                {e.sets > 0 && (
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-[#8e8e9a]">
                      Strength · {e.sets} {plural(e.sets, 'set')} · {e.volumeKg.toLocaleString()} kg lifted
                    </span>
                    <span className="font-bold text-[#d8d8de]">{e.strengthKcal} kcal</span>
                  </div>
                )}
                {e.cardioMin > 0 && (
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-[#8e8e9a]">Cardio · {e.cardioMin} min</span>
                    <span className="font-bold text-[#d8d8de]">{e.cardioKcal} kcal</span>
                  </div>
                )}
              </div>
              {!bodyWeightKg && (
                <p className="text-[10px] text-amber-300/80 mt-1.5">
                  Log today's weight for an accurate cardio estimate.
                </p>
              )}
              <p className="text-[10px] text-[#5a5a68] mt-1.5 leading-relaxed">
                Strength from volume lifted; cardio from MET × time. Estimates only.
              </p>
            </div>
          </div>
        );
      })()}

      {/* Session notes — includes freeform workouts logged via AI chat
          (walks, cycling, yoga). Without this they were saved but invisible. */}
      {sessionNotes && (
        <div className="mt-3 pt-3 border-t border-white/[0.06]">
          <p className="text-[10px] font-bold text-[#5a5a68] tracking-wider mb-1.5">Session notes</p>
          <p className="text-xs text-[#b6b6c2] leading-relaxed whitespace-pre-wrap bg-[#0d0d11] border border-white/[0.06] rounded-xl px-3 py-2.5">
            {sessionNotes}
          </p>
        </div>
      )}

      {/* The set-entry review card and any parse failure. Rendered once at the
          card level rather than per-exercise: there is a single shared
          composer, so two cards could never be open at the same time. */}
      {setVoice.card}
      {setVoiceError && (
        <p className="text-[11px] text-red-400 mt-2 leading-relaxed">{setVoiceError}</p>
      )}
    </Card>
  );
}
