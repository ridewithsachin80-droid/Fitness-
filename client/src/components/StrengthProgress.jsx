/**
 * StrengthProgress.jsx
 *
 * Resistance Training — Phase 3 (progress & analytics).
 * Pick a lift you've actually logged, see estimated 1RM trend over time
 * (Epley formula — stays meaningful even when rep schemes vary session to
 * session, unlike raw "weight lifted") plus total volume, with PR sessions
 * highlighted using the same gold-accent treatment as streaks/milestones
 * elsewhere in the app — this one's backed by real data, not decoration.
 */
import { useState, useEffect, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { Card, SectionTitle } from './UI';
import { getLoggedExercises, getExerciseHistory } from '../api/workouts';

// Epley formula: estimated 1-rep-max from any weight × reps combination.
// Deliberately not exact for any one rep range — its value is comparability
// across different rep schemes over time, not precision on any single set.
function estimated1RM(weightKg, reps) {
  if (!weightKg || !reps) return 0;
  return weightKg * (1 + reps / 30);
}

// Collapses flat set rows (already chronological from the API) into one
// point per session: best e1RM, the weight/reps that produced it, and total
// volume (Σ reps×weight across every set that session).
function summarizeSessions(rows) {
  const bySession = new Map();
  for (const row of rows) {
    const reps = parseInt(row.reps) || 0;
    const weight = parseFloat(row.weight_kg) || 0;
    if (reps <= 0) continue; // defensive — backend already excludes these, but don't trust blindly

    if (!bySession.has(row.session_date)) {
      bySession.set(row.session_date, { date: row.session_date, volume: 0, bestE1rm: 0, bestWeight: 0, bestReps: 0 });
    }
    const s = bySession.get(row.session_date);
    s.volume += reps * weight;
    const e1rm = estimated1RM(weight, reps);
    if (e1rm > s.bestE1rm) { s.bestE1rm = e1rm; s.bestWeight = weight; s.bestReps = reps; }
  }

  const sessions = [...bySession.values()]; // Map preserves insertion order — rows arrive chronological from the API
  // PR detection: a session is a PR if its best e1RM beats every session
  // before it. The very first session is a baseline, not a "record" in any
  // meaningful comparative sense, so it's never flagged.
  let runningMax = 0;
  return sessions.map((s, i) => {
    const isPR = i > 0 && s.bestE1rm > runningMax;
    runningMax = Math.max(runningMax, s.bestE1rm);
    return { ...s, isPR, volume: Math.round(s.volume), bestE1rm: Math.round(s.bestE1rm) };
  });
}

function formatDateShort(dateStr) {
  const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00');
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

function PRDot(props) {
  const { cx, cy, payload } = props;
  if (payload.isPR) {
    return (
      <g>
        <circle cx={cx} cy={cy} r={6} fill="#d4af6a" stroke="#0b0b0e" strokeWidth={2} />
        <text x={cx} y={cy - 12} textAnchor="middle" fontSize={10} fontWeight={700} fill="#d4af6a">PR</text>
      </g>
    );
  }
  return <circle cx={cx} cy={cy} r={3} fill="#7c5cfc" />;
}

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const s = payload[0].payload;
  return (
    <div className="bg-[#1a1a20] border border-white/[0.10] rounded-xl px-3 py-2 shadow-card-raised text-xs">
      <p className="text-[#5a5a68] mb-1">{formatDateShort(s.date)}</p>
      <p className="font-display font-semibold text-[#ededf0]">e1RM: {s.bestE1rm} kg</p>
      <p className="text-[#9a9aa6]">Best set: {s.bestWeight} kg × {s.bestReps}</p>
      <p className="text-[#9a9aa6]">Volume: {s.volume} kg</p>
      {s.isPR && <p className="text-[#d4af6a] font-semibold mt-1">🏆 New PR</p>}
    </div>
  );
}

export default function StrengthProgress() {
  const [exercises, setExercises]   = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [history, setHistory]       = useState([]);
  const [loadingList, setLoadingList]     = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Load the list of exercises this patient has actually logged
  useEffect(() => {
    let cancelled = false;
    getLoggedExercises()
      .then(({ data }) => {
        if (cancelled) return;
        setExercises(data);
        if (data.length > 0) setSelectedId(data[0].id); // default to most-recently-logged lift
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoadingList(false));
    return () => { cancelled = true; };
  }, []);

  // Load history whenever the selected exercise changes
  useEffect(() => {
    if (!selectedId) { setHistory([]); return; }
    let cancelled = false;
    setLoadingHistory(true);
    getExerciseHistory(selectedId, 20)
      .then(({ data }) => !cancelled && setHistory(data))
      .catch(() => !cancelled && setHistory([]))
      .finally(() => !cancelled && setLoadingHistory(false));
    return () => { cancelled = true; };
  }, [selectedId]);

  const sessions = useMemo(() => summarizeSessions(history), [history]);
  const prCount = sessions.filter(s => s.isPR).length;

  if (loadingList) return null; // page-level loader already covers the rest of Progress

  if (exercises.length === 0) {
    return (
      <Card>
        <SectionTitle icon="💪">Strength Progress</SectionTitle>
        <p className="text-xs text-[#5a5a68] text-center py-4">
          Log a workout in the Workout Log to see your strength trends here.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <SectionTitle icon="💪">Strength Progress</SectionTitle>
        {prCount > 0 && (
          <span className="text-xs font-bold text-[#d4af6a] bg-[rgba(212,175,106,0.10)] px-2 py-0.5 rounded-full">
            🏆 {prCount} PR{prCount > 1 ? 's' : ''}
          </span>
        )}
      </div>

      <select value={selectedId || ''} onChange={e => setSelectedId(parseInt(e.target.value))}
        className="w-full px-3 py-2.5 bg-[#1a1a20] border border-white/[0.10] rounded-xl text-sm text-[#ededf0]
          focus:outline-none focus:ring-2 focus:ring-[rgba(124,92,252,0.30)] mb-3">
        {exercises.map(ex => <option key={ex.id} value={ex.id}>{ex.name}</option>)}
      </select>

      {loadingHistory ? (
        <p className="text-xs text-[#5a5a68] text-center py-8">Loading…</p>
      ) : sessions.length === 0 ? (
        <p className="text-xs text-[#5a5a68] text-center py-8">No sets logged for this exercise yet.</p>
      ) : sessions.length === 1 ? (
        <div className="text-center py-4">
          <p className="font-display text-2xl font-semibold text-[#ededf0]">{sessions[0].bestE1rm} kg</p>
          <p className="text-xs text-[#5a5a68] mt-1">Estimated 1RM · {sessions[0].bestWeight} kg × {sessions[0].bestReps} reps</p>
          <p className="text-[10px] text-[#5a5a68] mt-2 italic">Log this exercise again to start seeing a trend.</p>
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={sessions} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="date" tickFormatter={formatDateShort} tick={{ fontSize: 9, fill: '#5a5a68' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 9, fill: '#5a5a68' }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="bestE1rm" stroke="#7c5cfc" strokeWidth={2.5}
                dot={<PRDot />} activeDot={{ r: 5, fill: '#7c5cfc' }} />
            </LineChart>
          </ResponsiveContainer>
          <div className="flex justify-between text-xs text-[#5a5a68] mt-1 px-1">
            <span>Estimated 1RM (Epley formula)</span>
            <span>{sessions.length} sessions</span>
          </div>
        </>
      )}
    </Card>
  );
}
