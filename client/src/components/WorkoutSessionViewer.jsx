/**
 * WorkoutSessionViewer.jsx
 *
 * Coach-facing, read-only. Shows whatever resistance training a patient
 * actually logged on a given date — this was a real gap: Phases 1-4 built
 * patient logging, patient progress, and coach program *assignment*, but
 * never wired "coach sees what was actually logged" into the existing Daily
 * Log detail view. The backend already supported this (GET /api/workouts
 * already accepts ?patient_id= with the proper assignment check) — it just
 * was never exposed through the client API or any UI.
 */
import { useState, useEffect } from 'react';
import { getWorkout } from '../api/workouts';

export default function WorkoutSessionViewer({ patientId, date, refreshTick = 0 }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getWorkout(date, patientId)
      .then(({ data }) => !cancelled && setData(data))
      .catch(() => !cancelled && setData(null))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [date, patientId, refreshTick]);

  if (loading) return null; // avoid a flash of "nothing logged" while this loads
  if (!data?.exercises?.length) return null; // nothing logged that day — say nothing rather than an empty box

  return (
    <div className="rounded-xl border border-white/[0.07] overflow-hidden">
      <div className="px-3 py-2 bg-[#1a1a20] border-b border-white/[0.06] flex justify-between items-center">
        <span className="text-[10px] font-bold text-[#4e4e5c] uppercase tracking-[0.10em]">🏋️ Workout Log</span>
        {data.session?.duration_min && (
          <span className="text-xs text-[#6a6a78]">{data.session.duration_min} min</span>
        )}
      </div>
      <div className="divide-y divide-white/[0.05]">
        {data.exercises.map(ex => (
          <div key={ex.exercise_id} className="px-3 py-2.5">
            <p className="text-sm font-semibold text-[#d8d8de] mb-1.5">{ex.exercise_name}</p>
            <div className="flex flex-wrap gap-1.5">
              {ex.sets.map((s, i) => (
                <span key={i} className="text-xs font-medium text-[#9a9aa6] bg-white/[0.04] px-2 py-1 rounded-lg">
                  {s.weight_kg > 0 ? `${s.weight_kg}kg × ${s.reps}` : `${s.reps} reps`}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
