/**
 * TrainingSummary.jsx — coach-facing view of a member's training.
 *
 * The Monitor page already shows compliance, weight and a per-day session
 * viewer, but none of the data the member now generates: volume lifted, cardio
 * distance/speed, and calories burned. A coach reviewing someone had no way to
 * see "750 kg lifted, 5 km walked" without opening each day one at a time.
 *
 * Also used on the member's own Progress page (same data, no patientId).
 */

import { useState, useEffect } from 'react';
import api from '../api/client';
import { cardioTypeById, cardioEnergy } from '../utils/exerciseCalories';

const RANGES = [
  { days: 7,  label: '7d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
];

function fmtDate(d) {
  return new Date(String(d).slice(0, 10) + 'T00:00:00')
    .toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function TrainingSummary({ patientId = null, bodyWeightKg = 0, refreshTick = 0 }) {
  const [days, setDays]       = useState(30);
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = { days };
    if (patientId) params.patient_id = patientId;
    api.get('/workouts/summary', { params })
      .then(({ data }) => { if (!cancelled) setData(data); })
      .catch(() => { if (!cancelled) setError('Could not load training history'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days, patientId, refreshTick]);

  if (loading && !data) {
    return <p className="text-xs text-[#5a5a68] py-4 text-center">Loading training history…</p>;
  }
  if (error) {
    return <p className="text-xs text-red-400 py-4 text-center">{error}</p>;
  }

  const sessions = data?.sessions || [];
  const totals   = data?.totals   || { volume_kg: 0, sets: 0, cardio_min: 0, session_count: 0 };
  const best     = data?.best     || { volume_kg: 0, cardio_min: 0 };

  // Calories per session, using the same model as the member's own screens
  const withKcal = sessions.map(s => {
    // The summary endpoint returns volume directly (not individual sets), so
    // apply the same 0.08 kcal/kg coefficient the shared model uses.
    const strengthKcal = Math.round(s.volume_kg * 0.08);
    const cardio = cardioEnergy(s.cardio || [], bodyWeightKg);
    return { ...s, strengthKcal, cardioKcal: cardio.kcal, totalKcal: strengthKcal + cardio.kcal };
  });

  const totalKcal = withKcal.reduce((sum, s) => sum + s.totalKcal, 0);
  const maxVolume = Math.max(1, ...withKcal.map(s => s.volume_kg));

  return (
    <div>
      {/* Range switch */}
      <div className="flex gap-1 mb-3">
        {RANGES.map(r => (
          <button key={r.days} onClick={() => setDays(r.days)}
            style={{ minHeight: 32 }}
            className={`flex-1 rounded-lg text-[11px] font-bold transition-colors ${
              days === r.days
                ? 'bg-[#7c5cfc] text-white'
                : 'bg-white/[0.04] text-[#8e8e9a] hover:text-[#d8d8de]'
            }`}>
            {r.label}
          </button>
        ))}
      </div>

      {sessions.length === 0 ? (
        <p className="text-xs text-[#5a5a68] py-6 text-center">
          No training logged in this period.
        </p>
      ) : (
        <>
          {/* Headline stats */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            {[
              { v: totals.session_count,                        l: 'Sessions',   c: 'text-[#a78bfa]' },
              { v: `${(totals.volume_kg / 1000).toFixed(1)}t`,  l: 'Volume',     c: 'text-blue-300' },
              { v: `${totals.cardio_min}m`,                     l: 'Cardio',     c: 'text-emerald-300' },
              { v: totalKcal.toLocaleString(),                  l: 'Kcal burned', c: 'text-orange-400' },
            ].map(s => (
              <div key={s.l} className="bg-white/[0.04] border border-white/[0.07] rounded-xl px-3 py-2">
                <p className={`text-base font-extrabold ${s.c}`}>{s.v}</p>
                <p className="text-[9px] font-bold uppercase tracking-wider text-[#5a5a68] mt-0.5">{s.l}</p>
              </div>
            ))}
          </div>

          {/* Volume trend — simple bars, no chart library needed */}
          <p className="text-[9px] font-bold uppercase tracking-wider text-[#5a5a68] mb-1.5">
            Volume per session
          </p>
          <div className="flex items-end gap-1 h-16 mb-3">
            {withKcal.slice(-14).map((s, i) => {
              const pb = s.volume_kg > 0 && s.volume_kg === best.volume_kg;
              return (
                <div key={i} className="flex-1 flex flex-col justify-end items-center gap-1" title={`${fmtDate(s.date)} · ${s.volume_kg} kg`}>
                  <div className={`w-full rounded-t transition-all ${pb ? 'bg-amber-400' : 'bg-[#7c5cfc]'}`}
                    style={{ height: `${Math.max(4, (s.volume_kg / maxVolume) * 100)}%` }} />
                </div>
              );
            })}
          </div>

          {/* Recent sessions */}
          <p className="text-[9px] font-bold uppercase tracking-wider text-[#5a5a68] mb-1.5">
            Recent sessions
          </p>
          <div className="space-y-1.5">
            {withKcal.slice(-6).reverse().map((s, i) => (
              <div key={i} className="bg-[#0d0d11] border border-white/[0.06] rounded-xl px-3 py-2">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[11px] font-bold text-[#ededf0]">{fmtDate(s.date)}</span>
                  <span className="text-[11px] font-bold text-orange-400">{s.totalKcal} kcal</span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[#8e8e9a]">
                  {s.sets > 0 && (
                    <span>💪 {s.sets} sets · {s.volume_kg.toLocaleString()} kg
                      {s.volume_kg === best.volume_kg && s.volume_kg > 0 && (
                        <span className="text-amber-400 font-bold"> · PB</span>
                      )}
                    </span>
                  )}
                  {(s.cardio || []).map((c, ci) => {
                    const t = cardioTypeById(c.type);
                    const dist = c.distance_km
                      ?? (c.speed_kmh && c.duration_min ? +(c.speed_kmh * c.duration_min / 60).toFixed(1) : null);
                    return (
                      <span key={ci}>
                        {t.icon} {t.label} {c.duration_min}m
                        {dist ? ` · ${dist} km` : ''}
                        {c.speed_kmh ? ` @ ${c.speed_kmh} km/h` : ''}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
