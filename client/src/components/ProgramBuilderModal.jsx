/**
 * ProgramBuilderModal.jsx
 *
 * Coach-facing (monitor/admin) workout program builder. Lets a coach:
 *  - Quick-assign an existing shared template to this patient
 *  - Or build/edit a multi-day program from scratch, picking exercises per
 *    day with target sets/reps
 *
 * Mirrors the modal style already used throughout Monitor.jsx (AddNoteModal,
 * WeightEntryModal, etc.) for visual consistency.
 */
import { useState, useEffect } from 'react';
import { searchExercises } from '../api/workouts';
import {
  getTemplates, getActiveProgram, createProgram, updateProgram, assignProgram, deleteProgram,
} from '../api/programs';

function emptyDay(n) {
  return { day_number: n, day_label: `Day ${n}`, exercises: [] };
}

export default function ProgramBuilderModal({ patientId, patientName, onClose, onSaved }) {
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');

  const [existingProgramId, setExistingProgramId] = useState(null);
  const [programName, setProgramName] = useState('');
  const [days, setDays] = useState([emptyDay(1)]);
  const [activeDayIdx, setActiveDayIdx] = useState(0);

  const [templates, setTemplates] = useState([]);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);

  // ── Load this patient's current program (if any) + the template list ──────
  useEffect(() => {
    let cancelled = false;
    Promise.all([getActiveProgram(patientId), getTemplates()])
      .then(([activeRes, templatesRes]) => {
        if (cancelled) return;
        setTemplates(templatesRes.data || []);
        const { program, days: loadedDays } = activeRes.data;
        if (program) {
          setExistingProgramId(program.id);
          setProgramName(program.name);
          setDays(loadedDays.length ? loadedDays.map(d => ({
            day_number: d.day_number, day_label: d.day_label,
            exercises: d.exercises.map(e => ({
              exercise_id: e.exercise_id, exercise_name: e.exercise_name,
              target_sets: e.target_sets, target_reps_min: e.target_reps_min, target_reps_max: e.target_reps_max,
            })),
          })) : [emptyDay(1)]);
        }
      })
      .catch(() => !cancelled && setError('Failed to load program data'))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [patientId]);

  // ── Exercise search (for adding to the current day) ────────────────────────
  const runSearch = async (q) => {
    setSearch(q);
    if (!q || q.length < 2) { setResults([]); return; }
    try {
      const { data } = await searchExercises(q);
      setResults(data);
    } catch { setResults([]); }
  };

  const addExerciseToDay = (exercise) => {
    setDays(prev => prev.map((d, i) => {
      if (i !== activeDayIdx) return d;
      if (d.exercises.some(e => e.exercise_id === exercise.id)) return d; // already in this day
      return { ...d, exercises: [...d.exercises, {
        exercise_id: exercise.id, exercise_name: exercise.name,
        target_sets: 3, target_reps_min: 8, target_reps_max: null,
      }] };
    }));
    setSearch(''); setResults([]);
  };

  const removeExerciseFromDay = (exerciseId) => {
    setDays(prev => prev.map((d, i) => i !== activeDayIdx
      ? d : { ...d, exercises: d.exercises.filter(e => e.exercise_id !== exerciseId) }));
  };

  const updateExerciseTarget = (exerciseId, field, value) => {
    setDays(prev => prev.map((d, i) => i !== activeDayIdx ? d : {
      ...d,
      exercises: d.exercises.map(e => e.exercise_id === exerciseId ? { ...e, [field]: value } : e),
    }));
  };

  const updateDayLabel = (label) => {
    setDays(prev => prev.map((d, i) => i !== activeDayIdx ? d : { ...d, day_label: label }));
  };

  const addDay = () => {
    setDays(prev => {
      const next = [...prev, emptyDay(prev.length + 1)];
      setActiveDayIdx(next.length - 1);
      return next;
    });
  };

  const removeDay = (idx) => {
    if (days.length === 1) return; // always keep at least one day
    setDays(prev => prev.filter((_, i) => i !== idx).map((d, i) => ({ ...d, day_number: i + 1 })));
    setActiveDayIdx(0);
  };

  // ── Save (create or update) ─────────────────────────────────────────────────
  const handleSave = async () => {
    if (!programName.trim()) { setError('Program name is required'); return; }
    setSaving(true); setError('');
    const payload = {
      name: programName.trim(),
      patient_id: patientId,
      days: days.map(d => ({
        day_number: d.day_number, day_label: d.day_label,
        exercises: d.exercises.map(e => ({
          exercise_id: e.exercise_id,
          target_sets: e.target_sets, target_reps_min: e.target_reps_min, target_reps_max: e.target_reps_max,
        })),
      })),
    };
    try {
      if (existingProgramId) {
        await updateProgram(existingProgramId, payload);
      } else {
        await createProgram(payload);
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to save program');
    } finally {
      setSaving(false);
    }
  };

  const handleUseTemplate = async (templateId) => {
    setSaving(true); setError('');
    try {
      await assignProgram(templateId, patientId);
      onSaved();
      onClose();
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to assign template');
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!existingProgramId) return;
    if (!confirm(`Remove ${patientName}'s current program? They'll go back to freeform logging only.`)) return;
    setSaving(true);
    try {
      await deleteProgram(existingProgramId);
      onSaved();
      onClose();
    } catch {
      setError('Failed to remove program');
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-[#7c5cfc] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center p-2">
      <div className="bg-[#131317] rounded-3xl border border-white/[0.08] w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-white/[0.07] flex-shrink-0">
          <h3 className="font-bold text-[#ededf0]">🏋️ {patientName}'s Program</h3>
          <button onClick={onClose} className="text-[#5a5a68] hover:text-[#9a9aa6] text-2xl leading-none">×</button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {/* Quick-assign a template */}
          {templates.length > 0 && (
            <div>
              <p className="text-[10px] text-[#5a5a68] font-semibold uppercase tracking-wide mb-1.5">Use a template</p>
              <div className="flex gap-1.5 flex-wrap">
                {templates.map(t => (
                  <button key={t.id} onClick={() => handleUseTemplate(t.id)} disabled={saving}
                    className="px-3 py-1.5 text-xs font-semibold rounded-full bg-white/[0.06] border border-white/[0.10] text-[#d8d8de] hover:bg-white/[0.10] transition-colors disabled:opacity-50">
                    {t.name}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-[#5a5a68] mt-2">— or build a custom program below —</p>
            </div>
          )}

          {/* Program name */}
          <div>
            <label className="block text-[10px] text-[#5a5a68] font-semibold uppercase tracking-wide mb-1.5">Program name</label>
            <input value={programName} onChange={e => setProgramName(e.target.value)}
              placeholder="e.g. Push / Pull / Legs"
              className="w-full px-3 py-2.5 bg-[#1a1a20] border border-white/[0.10] rounded-xl text-sm text-[#ededf0] placeholder-[#5a5a68] focus:outline-none focus:ring-2 focus:ring-[rgba(124,92,252,0.30)]" />
          </div>

          {/* Day tabs */}
          <div>
            <div className="flex items-center gap-1.5 flex-wrap mb-2">
              {days.map((d, i) => (
                <button key={i} onClick={() => setActiveDayIdx(i)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-full transition-colors ${
                    i === activeDayIdx ? 'bg-[#7c5cfc] text-white' : 'bg-white/[0.06] text-[#9a9aa6] hover:bg-white/[0.10]'}`}>
                  {d.day_label}
                </button>
              ))}
              <button onClick={addDay} className="px-3 py-1.5 text-xs font-semibold rounded-full bg-white/[0.04] border border-dashed border-white/[0.15] text-[#5a5a68] hover:text-[#9a9aa6]">
                + Day
              </button>
            </div>

            {/* Active day editor */}
            <div className="bg-white/[0.02] border border-white/[0.07] rounded-xl p-3">
              <div className="flex items-center gap-2 mb-3">
                <input value={days[activeDayIdx].day_label} onChange={e => updateDayLabel(e.target.value)}
                  placeholder="Day label, e.g. Push Day"
                  className="flex-1 px-2.5 py-1.5 bg-[#1a1a20] border border-white/[0.10] rounded-lg text-xs text-[#d8d8de] focus:outline-none focus:ring-2 focus:ring-[rgba(124,92,252,0.30)]" />
                {days.length > 1 && (
                  <button onClick={() => removeDay(activeDayIdx)} className="text-[#5a5a68] hover:text-red-400 text-xs">Remove day</button>
                )}
              </div>

              {/* Exercise search for this day */}
              <div className="relative mb-2">
                <input value={search} onChange={e => runSearch(e.target.value)}
                  placeholder="Search exercises to add…"
                  className="w-full px-2.5 py-2 bg-[#1a1a20] border border-white/[0.10] rounded-lg text-xs text-[#d8d8de] placeholder-[#5a5a68] focus:outline-none focus:ring-2 focus:ring-[rgba(124,92,252,0.30)]" />
                {results.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1 bg-[#1a1a20] border border-white/[0.10] rounded-lg shadow-lg z-10 max-h-40 overflow-y-auto">
                    {results.map(r => (
                      <button key={r.id} onClick={() => addExerciseToDay(r)}
                        className="w-full text-left px-2.5 py-2 text-xs text-[#d8d8de] hover:bg-white/[0.05]">
                        {r.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Exercises in this day */}
              {days[activeDayIdx].exercises.length === 0 ? (
                <p className="text-xs text-[#5a5a68] text-center py-3">No exercises yet — search above to add some.</p>
              ) : (
                <div className="space-y-2">
                  {days[activeDayIdx].exercises.map(ex => (
                    <div key={ex.exercise_id} className="flex items-center gap-2 bg-white/[0.02] rounded-lg p-2">
                      <span className="flex-1 text-xs text-[#d8d8de]">{ex.exercise_name}</span>
                      <input type="number" min="1" value={ex.target_sets}
                        onChange={e => updateExerciseTarget(ex.exercise_id, 'target_sets', e.target.value)}
                        className="w-10 px-1 py-1 bg-[#1a1a20] border border-white/[0.10] rounded text-xs text-center text-[#ededf0]" />
                      <span className="text-[#5a5a68] text-xs">×</span>
                      <input type="number" min="1" value={ex.target_reps_min}
                        onChange={e => updateExerciseTarget(ex.exercise_id, 'target_reps_min', e.target.value)}
                        className="w-10 px-1 py-1 bg-[#1a1a20] border border-white/[0.10] rounded text-xs text-center text-[#ededf0]" />
                      <button onClick={() => removeExerciseFromDay(ex.exercise_id)} className="text-[#5a5a68] hover:text-red-400 text-sm px-1">×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {error && <p className="text-xs text-red-400 bg-red-400/10 px-3 py-2 rounded-xl">{error}</p>}
        </div>

        <div className="px-5 py-4 border-t border-white/[0.07] flex-shrink-0 space-y-2">
          <button onClick={handleSave} disabled={saving}
            className="w-full py-3 bg-[#7c5cfc] hover:bg-[#a78bfa] text-white font-bold rounded-xl transition-colors disabled:opacity-50">
            {saving ? 'Saving…' : existingProgramId ? 'Save Changes' : 'Create Program'}
          </button>
          {existingProgramId && (
            <button onClick={handleDelete} disabled={saving} className="w-full py-2 text-xs text-red-400 hover:text-red-300">
              Remove this patient's program
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
