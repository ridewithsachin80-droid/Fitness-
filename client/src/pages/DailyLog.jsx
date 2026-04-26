import { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLogStore }  from '../store/logStore';
import { useAuthStore } from '../store/authStore';
import {
  today, formatDate,
  ACTIVITIES, ACV_ITEMS, SUPPLEMENTS,
  calcCompliance,
} from '../constants';
import { Card, SectionTitle, CheckRow, OfflineBanner } from '../components/UI';
import WaterTracker  from '../components/WaterTracker';
import FoodLog       from '../components/FoodLog';
import SleepTracker  from '../components/SleepTracker';
import InstallPrompt from '../components/InstallPrompt';
import { usePush }        from '../hooks/usePush';
import { useOfflineSync } from '../hooks/useOfflineQueue';

function ComplianceRing({ pct }) {
  const r = 24, circ = 2 * Math.PI * r;
  return (
    <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
      <circle cx="28" cy="28" r={r} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="5" />
      <circle cx="28" cy="28" r={r} fill="none" stroke="#6ee7b7" strokeWidth="5"
        strokeDasharray={`${(pct / 100) * circ} ${circ}`} strokeLinecap="round"
        className="transition-all duration-700" />
      <text x="28" y="28" dominantBaseline="middle" textAnchor="middle"
        fontSize="11" fontWeight="600" fill="white" transform="rotate(90 28 28)">
        {pct}%
      </text>
    </svg>
  );
}

export default function DailyLog() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { date, log, protocol, loading, saving, saved, error, setDate, updateLog, saveLog } = useLogStore();

  // Merge default + custom items, then filter by protocol
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

  const activeActivities  = allActivities.filter(a =>
    !protocol?.activities  || protocol.activities.includes(a.id));
  const activeACV         = allACV.filter(a =>
    !protocol?.acv         || protocol.acv.includes(a.id));
  const activeSupplements = allSupplements.filter(s =>
    !protocol?.supplements || protocol.supplements.includes(s.id));

  // Register Web Push subscription on first load (patient only)
  usePush();
  // Auto-sync any offline-queued logs when connection restores
  useOfflineSync();

  useEffect(() => { setDate(today()); }, []);

  const compliance = calcCompliance(log, activeActivities, activeACV, activeSupplements);
  const actDone    = activeActivities.filter(a => log.activities?.[a.id]).length;
  const acvDone    = activeACV.filter(a => log.acv?.[a.id]).length;
  const suppDone   = activeSupplements.filter(s => log.supplements?.[s.id]).length;
  const update     = useCallback(updateLog, [updateLog]);

  return (
    <div className="min-h-screen bg-stone-100 font-sans">
      <OfflineBanner />

      {/* Header */}
      <div className="bg-gradient-to-br from-emerald-700 to-emerald-900 text-white px-4 pt-10 pb-6">
        <div className="max-w-md mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs font-bold tracking-widest uppercase text-emerald-300 mb-0.5">FitLife</p>
              <h1 className="text-xl font-bold">{user?.name}</h1>
              <p className="text-emerald-300 text-xs mt-0.5">Building healthy habits daily 🌱</p>
            </div>
            <button onClick={() => navigate('/settings')}
              className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
          <div className="bg-white/10 rounded-2xl p-3 flex items-center gap-4">
            <ComplianceRing pct={compliance} />
            <div className="flex-1">
              <div className="text-sm font-semibold">Today's Compliance</div>
              <div className="text-xs text-emerald-200 mt-0.5">
                {actDone}/{activeActivities.length} activities · {acvDone}/{activeACV.length} ACV · {suppDone}/{activeSupplements.length} supps
              </div>
              {log.weight && <div className="text-xs text-emerald-300 mt-1 font-medium">⚖ {log.weight} kg logged</div>}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-md mx-auto px-4 space-y-3 pb-32 pt-4">
        {/* Date picker */}
        <Card>
          <div className="flex items-center gap-3">
            <span>📅</span>
            <input type="date" value={date} max={today()} onChange={e => setDate(e.target.value)}
              className="flex-1 text-sm font-semibold text-stone-700 border border-stone-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-300" />
            <button onClick={() => setDate(today())}
              className="text-xs text-emerald-600 font-bold px-3 py-2 bg-emerald-50 rounded-xl hover:bg-emerald-100 transition-colors whitespace-nowrap">
              Today
            </button>
          </div>
          {date !== today() && (
            <p className="text-xs text-amber-600 mt-2 ml-7 font-medium">Editing: {formatDate(date)}</p>
          )}
        </Card>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-4 border-emerald-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Morning Weight */}
            <Card>
              <SectionTitle icon="⚖️">Morning Weight</SectionTitle>
              <p className="text-xs text-stone-400 mb-3">After washroom, before food — first thing in the morning</p>
              <div className="flex items-center gap-3">
                <input type="number" step="0.1" inputMode="decimal" value={log.weight} placeholder="e.g. 92.5"
                  onChange={e => update('weight', e.target.value)}
                  className="flex-1 text-2xl font-bold text-center border-2 border-stone-200 rounded-2xl py-3 focus:outline-none focus:ring-2 focus:ring-emerald-300 text-stone-800" />
                <span className="text-stone-400 font-bold">kg</span>
              </div>
              {log.weight && (
                <div className="mt-3 text-center text-xs font-semibold py-2 rounded-xl bg-emerald-50 text-emerald-700">
                  ✓ Weight logged — great job tracking!
                </div>
              )}
            </Card>

            {/* Activities */}
            <Card>
              <SectionTitle icon="🏃">Physical Activity</SectionTitle>
              <div className="space-y-2">
                {activeActivities.map(a => (
                  <CheckRow key={a.id} label={a.label} sub={a.sub} icon={a.icon}
                    checked={!!log.activities?.[a.id]}
                    onChange={v => update('activities', { ...log.activities, [a.id]: v })} />
                ))}
              </div>
            </Card>

            {/* ACV */}
            <Card>
              <SectionTitle icon="🍶">Apple Cider Vinegar</SectionTitle>
              <p className="text-xs text-stone-400 mb-3">1 tbsp in 200ml warm water · through a straw · 15 min before meal</p>
              <div className="space-y-2">
                {activeACV.map(a => (
                  <CheckRow key={a.id} label={a.label} sub={a.sub}
                    checked={!!log.acv?.[a.id]}
                    onChange={v => update('acv', { ...log.acv, [a.id]: v })} />
                ))}
              </div>
            </Card>

            {/* Food */}
            <Card>
              <SectionTitle icon="🥗">Food Log</SectionTitle>
              <p className="text-xs text-stone-400 mb-3">Enter raw weight before cooking</p>
              <FoodLog items={log.food} onChange={v => update('food', v)} />
            </Card>

            {/* Water */}
            <Card>
              <SectionTitle icon="💧">Water Intake</SectionTitle>
              <p className="text-xs text-stone-400 mb-3">Target 3L · Stop 1 hr before sleep · Not during meals</p>
              <WaterTracker value={log.water} onChange={v => update('water', v)} />
            </Card>

            {/* Supplements */}
            <Card>
              <SectionTitle icon="💊">Supplements</SectionTitle>
              <div className="space-y-2">
                {activeSupplements.map(s => (
                  <CheckRow key={s.id} label={s.label} sub={s.sub}
                    checked={!!log.supplements?.[s.id]}
                    onChange={v => update('supplements', { ...log.supplements, [s.id]: v })} />
                ))}
              </div>
            </Card>

            {/* Sleep */}
            <Card>
              <SectionTitle icon="🌙">Sleep</SectionTitle>
              <p className="text-xs text-stone-400 mb-3">Target 10:00 PM → 6:30 AM (8 hrs)</p>
              <SleepTracker value={log.sleep} onChange={v => update('sleep', v)} />
            </Card>

            {/* Notes */}
            <Card>
              <SectionTitle icon="📝">Notes</SectionTitle>
              <textarea value={log.notes} onChange={e => update('notes', e.target.value)}
                placeholder="Symptoms, how you felt, energy levels, challenges…" rows={3}
                className="w-full text-sm text-stone-700 border border-stone-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-300 resize-none placeholder-stone-300" />
            </Card>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>
            )}
          </>
        )}
      </div>

      {/* Sticky save */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-stone-100 via-stone-100/90 to-transparent">
        <div className="max-w-md mx-auto">
          <button onClick={saveLog} disabled={saving || loading}
            className={`w-full py-4 rounded-2xl text-white font-bold text-base shadow-float transition-all duration-200 ${
              saved ? 'bg-emerald-400' : saving ? 'bg-emerald-500 opacity-80' : 'bg-emerald-600 hover:bg-emerald-700 active:scale-98'
            }`}>
            {saving ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Saving…
              </span>
            ) : saved ? '✓ Saved!' : "Save Today's Log"}
          </button>
        </div>
      </div>

      <InstallPrompt />
    </div>
  );
}
