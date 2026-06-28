/**
 * WorkoutLog.jsx
 *
 * Resistance Training — Phase 1 (freeform logging) + Phase 2 (coach-assigned
 * programs). If the patient has an active program, day tabs let them pull in
 * that day's prescribed exercises (with target sets/reps shown for context);
 * otherwise — or in addition — they can always search and log freeform.
 * Selecting a program day only ADDS exercises, never replaces what's already
 * logged, so there's no risk of it clobbering real data.
 *
 * Auto-saves on every change (debounced), matching the rest of the daily
 * log — no manual save button anywhere in this app anymore.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Card, SectionTitle, CardSkeleton } from './UI';
import { haptic } from '../store/settingsStore';
import { searchExercises, addCustomExercise, getWorkout, saveWorkout, getExerciseHistory } from '../api/workouts';
import { getActiveProgram } from '../api/programs';
import { parseVoiceSet } from '../utils/voiceSetParser';

function getSpeechRecognition() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function formatTarget(ex) {
  const reps = ex.target_reps_max && ex.target_reps_max !== ex.target_reps_min
    ? `${ex.target_reps_min}-${ex.target_reps_max}` : `${ex.target_reps_min}`;
  return `${ex.target_sets} × ${reps}`;
}

/** One-shot voice capture. Resolves with the transcript, or null on failure/cancel. */
function listenOnce() {
  return new Promise((resolve) => {
    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) { resolve(null); return; }
    const r = new SpeechRecognition();
    r.lang = 'en-IN';
    r.continuous = false;
    r.interimResults = false;
    r.onresult = (e) => resolve(e.results[0][0].transcript);
    r.onerror = () => resolve(null);
    r.onend = () => resolve(null); // no-op if onresult already resolved
    r.start();
  });
}

export default function WorkoutLog({ date }) {
  const [exercisesInSession, setExercisesInSession] = useState([]); // [{exercise_id, exercise_name, sets:[{reps,weight_kg}]}]
  const [durationMin, setDurationMin] = useState('');
  const [loading, setLoading] = useState(true);

  const [search, setSearch]       = useState('');
  const [results, setResults]     = useState([]);
  const [searching, setSearching] = useState(false);
  const [listeningSearch, setListeningSearch] = useState(false);
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
  const voiceSupported = !!getSpeechRecognition();

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

  // ── Load the patient's active program once (not date-scoped — a program
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
      }).catch(() => {});
    }, 4000);
    return () => clearTimeout(saveRef.current);
  }, [exercisesInSession, durationMin, date]);

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

  const startSearchVoice = async () => {
    if (!voiceSupported) { alert('Voice input not supported in this browser'); return; }
    setListeningSearch(true);
    haptic(20);
    const transcript = await listenOnce();
    setListeningSearch(false);
    if (transcript) {
      setSearch(transcript);
      runSearch(transcript);
    }
  };

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

  // Pulls in one program day's prescribed exercises. Only ADDS — any
  // exercise already in today's session (logged freeform, or from a
  // different day picked earlier) is left untouched, so this can never
  // clobber real data, no matter what order things happen in.
  const addProgramDay = (day) => {
    for (const ex of day.exercises) {
      addExercise({ id: ex.exercise_id, name: ex.exercise_name });
    }
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
  // Uses the functional setState form deliberately — listenOnce() can take
  // several seconds of real time, during which other edits could happen;
  // reading prev state at apply-time (not at call-time) is what makes this
  // safe regardless of what else changed while the mic was listening.
  const voiceLogSet = async (exerciseId) => {
    if (!voiceSupported) { alert('Voice input not supported in this browser'); return; }
    setListeningSetKey(exerciseId);
    haptic(20);
    const transcript = await listenOnce();
    setListeningSetKey(null);
    if (!transcript) return;

    const { sets, reps, weight_kg } = parseVoiceSet(transcript);
    if (reps === null) {
      alert(`Couldn't understand "${transcript}" — try saying e.g. "60 kg 8 reps"`);
      return;
    }
    setExercisesInSession(prev => prev.map(ex => {
      if (ex.exercise_id !== exerciseId) return ex;
      const newSets = Array.from({ length: Math.max(1, sets) }, () => ({ reps, weight_kg }));
      return { ...ex, sets: [...ex.sets, ...newSets] };
    }));
    haptic(30);
  };

  const handleDurationChange = (val) => setDurationMin(val);

  if (loading) return <Card><CardSkeleton lines={3} /></Card>; // page-level loader already covers the rest of DailyLog; this just avoids an abrupt pop-in for this one card

  return (
    <Card>
      <SectionTitle icon="🏋️" tooltip="Log your actual sets, reps, and weight for each exercise. This is separate from the Resistance Training checkbox above — use both, or just whichever you prefer.">
        Workout Log
      </SectionTitle>

      {/* Rest timer banner — manually started via the ⏱ button on any exercise */}
      {restSeconds !== null && (
        <div className={`flex items-center justify-between mb-3 px-3 py-2.5 rounded-xl border transition-colors ${
          restSeconds <= 0 ? 'bg-[rgba(212,175,106,0.12)] border-[rgba(212,175,106,0.30)]' : 'bg-[rgba(124,92,252,0.10)] border-[rgba(124,92,252,0.20)]'}`}>
          <div className="flex items-center gap-2">
            <span className="text-lg">⏱</span>
            <span className={`font-display text-lg font-semibold ${restSeconds <= 0 ? 'text-[#d4af6a]' : 'text-[#ededf0]'}`}>
              {restSeconds <= 0 ? "Time's up!" : `${restSeconds}s`}
            </span>
            {restSeconds > 0 && <span className="text-xs text-[#5a5a68]">resting…</span>}
          </div>
          <div className="flex gap-1.5">
            {restSeconds <= 0 ? (
              <button onClick={cancelRest} className="text-xs font-semibold text-[#a78bfa] px-2.5 py-1">Dismiss</button>
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
            <span className="font-semibold text-[#a78bfa]">{program.name}</span> — tap a day to pull in today's exercises:
          </p>
          <div className="flex gap-1.5 flex-wrap">
            {programDays.map(day => (
              <button key={day.day_number} onClick={() => addProgramDay(day)}
                className="px-3 py-1.5 text-xs font-semibold rounded-full bg-[rgba(124,92,252,0.10)] border border-[rgba(124,92,252,0.20)] text-[#a78bfa] hover:bg-[rgba(124,92,252,0.18)] transition-colors">
                {day.day_label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Exercise search */}
      <div className="flex gap-2 mb-3">
        <div className="flex-1 relative">
          <input
            value={search}
            onChange={e => handleSearchChange(e.target.value)}
            placeholder="Search exercises… e.g. Bench Press"
            className="w-full px-3 py-2.5 bg-[#1a1a20] border border-white/[0.1] rounded-xl text-sm
              text-[#ededf0] placeholder-[#5a5a68] focus:outline-none focus:ring-2 focus:ring-[rgba(124,92,252,0.30)]"
          />
          {(results.length > 0 || (search.length >= 2 && !searching)) && (
            <div className="absolute left-0 right-0 top-full mt-1 bg-[#1a1a20] border border-white/[0.1]
              rounded-xl shadow-card-raised z-20 max-h-56 overflow-y-auto">
              {results.map(r => (
                <button key={r.id} onClick={() => addExercise(r)}
                  className="w-full text-left px-3 py-2.5 text-sm text-[#d8d8de] hover:bg-white/[0.05] flex items-center justify-between">
                  <span>{r.name}</span>
                  {r.muscle_group && <span className="text-[10px] text-[#5a5a68] uppercase">{r.muscle_group}</span>}
                </button>
              ))}
              {results.length === 0 && search.length >= 2 && !searching && (
                <button onClick={addCustomAndUse}
                  className="w-full text-left px-3 py-2.5 text-sm text-[#a78bfa] hover:bg-white/[0.05]">
                  + Add "{search}" as a new exercise
                </button>
              )}
            </div>
          )}
        </div>
        <button onClick={startSearchVoice} disabled={listeningSearch}
          className={`px-3.5 rounded-xl border flex items-center justify-center transition-colors ${
            listeningSearch ? 'bg-[#7c5cfc] border-[#7c5cfc] text-white animate-pulse' : 'bg-white/[0.06] border-white/[0.1] text-[#d8d8de] hover:bg-white/[0.1]'}`}>
          🎤
        </button>
      </div>

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
                    <span className="ml-2 text-[10px] font-semibold text-[#a78bfa] bg-[rgba(124,92,252,0.10)] px-1.5 py-0.5 rounded-full">
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
                  <div className="flex gap-2 text-[10px] text-[#5a5a68] uppercase font-semibold px-1">
                    <span className="w-8">Set</span>
                    <span className="flex-1">Weight (kg)</span>
                    <span className="flex-1">Reps</span>
                    <span className="w-6" />
                  </div>
                  {ex.sets.map((set, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <span className="w-8 text-xs text-[#9a9aa6] text-center">{i + 1}</span>
                      <input type="number" inputMode="decimal" value={set.weight_kg}
                        onChange={e => updateSet(ex.exercise_id, i, 'weight_kg', e.target.value)}
                        placeholder="0"
                        className="flex-1 px-2 py-1.5 bg-[#1a1a20] border border-white/[0.1] rounded-lg text-sm text-center text-[#ededf0] focus:outline-none focus:ring-2 focus:ring-[rgba(124,92,252,0.30)]" />
                      <input type="number" inputMode="numeric" value={set.reps}
                        onChange={e => updateSet(ex.exercise_id, i, 'reps', e.target.value)}
                        placeholder="0"
                        className="flex-1 px-2 py-1.5 bg-[#1a1a20] border border-white/[0.1] rounded-lg text-sm text-center text-[#ededf0] focus:outline-none focus:ring-2 focus:ring-[rgba(124,92,252,0.30)]" />
                      <button onClick={() => removeSet(ex.exercise_id, i)} className="w-6 text-[#5a5a68] hover:text-red-400 text-sm">×</button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2 mt-2">
                <button onClick={() => addSetRow(ex.exercise_id)}
                  className="flex-1 py-2 text-xs font-semibold text-[#a78bfa] bg-[rgba(124,92,252,0.08)] border border-[rgba(124,92,252,0.18)] rounded-lg hover:bg-[rgba(124,92,252,0.14)] transition-colors">
                  + Add Set
                </button>
                <button onClick={() => voiceLogSet(ex.exercise_id)} disabled={listeningSetKey === ex.exercise_id}
                  className={`px-3.5 py-2 rounded-lg border text-xs font-semibold transition-colors ${
                    listeningSetKey === ex.exercise_id
                      ? 'bg-[#7c5cfc] border-[#7c5cfc] text-white animate-pulse'
                      : 'bg-white/[0.06] border-white/[0.1] text-[#d8d8de] hover:bg-white/[0.1]'}`}>
                  🎤 {listeningSetKey === ex.exercise_id ? 'Listening…' : 'Say a set'}
                </button>
                {ex.sets.length > 0 && (
                  <button onClick={() => startRest(90)}
                    className="px-3 py-2 rounded-lg border text-xs font-semibold bg-white/[0.04] border-white/[0.08] text-[#5a5a68] hover:bg-white/[0.08] hover:text-[#9a9aa6] transition-colors">
                    ⏱
                  </button>
                )}
              </div>
            </div>
            );
          })}
        </div>
      )}

      {/* Optional duration */}
      {exercisesInSession.length > 0 && (
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/[0.06]">
          <span className="text-xs text-[#9a9aa6]">Session duration:</span>
          <input type="number" inputMode="numeric" value={durationMin}
            onChange={e => handleDurationChange(e.target.value)}
            placeholder="30" className="w-16 px-2 py-1 bg-[#1a1a20] border border-white/[0.1] rounded-lg text-sm text-center text-[#ededf0] focus:outline-none focus:ring-2 focus:ring-[rgba(124,92,252,0.30)]" />
          <span className="text-xs text-[#5a5a68]">min</span>
        </div>
      )}

      {!voiceSupported && (
        <p className="text-[10px] text-[#5a5a68] mt-3 italic">
          Voice logging isn't supported in this browser — try Chrome on Android.
        </p>
      )}
    </Card>
  );
}
