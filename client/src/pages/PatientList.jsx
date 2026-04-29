import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { getPatients }  from '../api/logs';
import { today, formatDate } from '../constants';
import { OfflineBanner, PageLoader, BottomNav } from '../components/UI';
import { useSync } from '../hooks/useSync';

function complianceBadge(pct) {
  if (pct === null || pct === undefined) return { bg: 'bg-stone-100', text: 'text-[#4e4e5c]', label: '—' };
  if (pct >= 75) return { bg: 'bg-emerald-100', text: 'text-emerald-700', label: `${pct}%` };
  if (pct >= 50) return { bg: 'bg-amber-100',   text: 'text-amber-700',   label: `${pct}%` };
  return           { bg: 'bg-red-100',     text: 'text-red-700',     label: `${pct}%` };
}

function weightDelta(current, start) {
  if (!current || !start) return null;
  const delta = parseFloat(current) - parseFloat(start);
  return delta;
}

export default function PatientList() {
  const navigate       = useNavigate();
  const { user, logout } = useAuthStore();
  const [patients, setPatients] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error,   setError]     = useState('');
  const [search,  setSearch]    = useState('');
  const todayStr = today();

  const load = async () => {
    try {
      const { data } = await getPatients();
      setPatients(data);
    } catch (e) {
      setError('Failed to load patients');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Real-time: when a patient saves a log, update their card live
  useSync((update) => {
    setPatients(prev => prev.map(p =>
      p.id === update.patientId
        ? { ...p, last_compliance: update.compliance, latest_weight: update.weight_kg, last_logged: update.date }
        : p
    ));
  });

  const [filter, setFilter] = useState('all');

  if (loading) return <PageLoader />;

  const baseList = search.trim()
    ? patients.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.phone || '').includes(search))
    : patients;

  const filtered = (() => {
    if (filter === 'needs_attention') return baseList.filter(p => p.last_logged !== todayStr);
    if (filter === 'low_compliance')  return baseList.filter(p => p.last_compliance != null && p.last_compliance < 50);
    if (filter === 'no_pin')          return baseList.filter(p => p.has_pin === false);
    return baseList;
  })();

  const noLogToday  = filtered.filter(p => p.last_logged !== todayStr);
  const loggedToday = filtered.filter(p => p.last_logged === todayStr);

  return (
    <div className="min-h-screen bg-[#0b0b0e]">
      <OfflineBanner />

      {/* Header */}
      <div className="bg-gradient-to-br from-[#0b0b0e] to-[#060609] text-white px-4 pt-10 pb-6">
        <div className="max-w-md mx-auto">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold tracking-widest uppercase text-[#4e4e5c] mb-0.5">Monitor</p>
              <h1 className="text-xl font-bold">{user?.name}</h1>
              <p className="text-[#4e4e5c] text-xs mt-0.5">{patients.length} patient{patients.length !== 1 ? 's' : ''} assigned</p>
            </div>
            <button onClick={() => navigate('/settings')}
              className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>

          {/* Quick stats */}
          <div className="grid grid-cols-3 gap-2 mt-4">
            {[
              { label: 'Logged today', value: loggedToday.length, color: 'text-emerald-400' },
              { label: 'Pending',      value: noLogToday.length,  color: noLogToday.length > 0 ? 'text-red-400' : 'text-[#4e4e5c]' },
              { label: 'Total',        value: patients.length,    color: 'text-stone-300' },
            ].map(stat => (
              <div key={stat.label} className="bg-white/[0.05] rounded-xl py-2.5 text-center border border-white/[0.06]">
                <div className={`text-xl font-bold ${stat.color}`}>{stat.value}</div>
                <div className="text-xs text-[#4e4e5c] mt-0.5">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Patient cards */}
      <div className="max-w-md mx-auto px-4 pt-4 pb-8 space-y-3">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>
        )}

        {/* Sprint 9: Search bar */}
        {patients.length > 0 && (
          <div className="relative">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#4e4e5c]"
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name or phone…"
              className="w-full pl-10 pr-4 py-3 bg-[#1a1a20] border border-white/[0.10] rounded-2xl text-sm
                focus:outline-none focus:ring-2 focus:ring-emerald-300 text-stone-800"
            />
            {search && (
              <button onClick={() => setSearch('')}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#4e4e5c] hover:text-stone-600 text-lg">
                ×
              </button>
            )}
          </div>
        )}

        {/* Filter chips */}
        {patients.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1 [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none' }}>
            {[
              { id: 'all',              label: 'All',              count: patients.length },
              { id: 'needs_attention',  label: '⚠ No log today',   count: patients.filter(p => p.last_logged !== todayStr).length },
              { id: 'low_compliance',   label: '📉 Low compliance', count: patients.filter(p => p.last_compliance != null && p.last_compliance < 50).length },
              { id: 'no_pin',           label: '🔑 No PIN',         count: patients.filter(p => p.has_pin === false).length },
            ].map(chip => (
              <button key={chip.id} onClick={() => setFilter(chip.id)}
                className={`flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full transition-all whitespace-nowrap ${
                  filter === chip.id
                    ? 'bg-white/[0.08] border border-white/[0.10] text-[#ededf0] shadow-sm'
                    : 'bg-[#1a1a20] border border-white/[0.10] text-stone-600 hover:border-stone-400'
                }`}>
                {chip.label}
                {chip.count > 0 && (
                  <span className={`ml-1 ${filter === chip.id ? 'text-stone-300' : 'text-[#4e4e5c]'}`}>
                    ({chip.count})
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {filtered.length === 0 && !error && (
          <div className="text-center py-16 text-[#4e4e5c]">
            <div className="text-4xl mb-3">👥</div>
            <p className="font-medium">{search ? `No patients matching "${search}"` : 'No patients assigned yet'}</p>
          </div>
        )}

        {/* Pending logs first */}
        {noLogToday.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-red-400 uppercase tracking-[0.12em] mb-2 px-1">
              ⚠ No log today ({noLogToday.length})
            </p>
            {noLogToday.map(p => <PatientCard key={p.id} patient={p} todayStr={todayStr} onClick={() => navigate(`/monitor/${p.id}`)} />)}
          </div>
        )}

        {loggedToday.length > 0 && (
          <div>
            {noLogToday.length > 0 && (
              <p className="text-[10px] font-semibold text-[#2ce89c] uppercase tracking-[0.12em] mb-2 mt-4 px-1">
                ✓ Logged today ({loggedToday.length})
              </p>
            )}
            {loggedToday.map(p => <PatientCard key={p.id} patient={p} todayStr={todayStr} onClick={() => navigate(`/monitor/${p.id}`)} />)}
          </div>
        )}
      </div>
      <BottomNav role={user?.role} />
    </div>
  );
}

function PatientCard({ patient: p, todayStr, onClick }) {
  const badge  = complianceBadge(p.last_compliance);
  const delta  = weightDelta(p.latest_weight, p.start_weight);
  const noLog  = p.last_logged !== todayStr;
  const conditions = Array.isArray(p.conditions) ? p.conditions : [];

  return (
    <div onClick={onClick}
      className={`bg-[#131317] rounded-2xl border border-white/[0.08] p-4 shadow-card cursor-pointer border transition-all
        hover:shadow-md active:scale-98 ${noLog ? 'border-red-500/25' : 'border-white/[0.07]'}`}>
      <div className="flex items-start justify-between gap-3">
        {/* Left: name + info */}
        <div className="min-w-0 flex-1">
          <h2 className="font-bold text-stone-800 text-base truncate">{p.name}</h2>
          <p className="text-xs text-[#4e4e5c] mt-0.5">{p.phone}</p>

          {conditions.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {conditions.map(c => (
                <span key={c} className="text-xs bg-stone-100 text-stone-500 px-2 py-0.5 rounded-full font-medium">
                  {c.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Right: weight + compliance */}
        <div className="text-right flex-shrink-0">
          {p.latest_weight ? (
            <>
              <div className="font-bold text-stone-800">{p.latest_weight} kg</div>
              {delta !== null && (
                <div className={`text-xs font-semibold mt-0.5 ${delta < 0 ? 'text-emerald-600' : delta > 0 ? 'text-red-500' : 'text-[#4e4e5c]'}`}>
                  {delta < 0 ? '↓' : delta > 0 ? '↑' : '='} {Math.abs(delta).toFixed(1)} kg
                </div>
              )}
            </>
          ) : (
            <span className="text-xs text-stone-300">No weight</span>
          )}
          <div className={`mt-1.5 text-xs font-bold px-2 py-0.5 rounded-full inline-block ${badge.bg} ${badge.text}`}>
            {badge.label}
          </div>
        </div>
      </div>

      {/* Bottom row */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/[0.05]">
        {noLog ? (
          <span className="text-xs font-bold text-red-500">⚠ No log today</span>
        ) : (
          <span className="text-xs text-[#4e4e5c]">
            Logged {p.last_logged === todayStr ? 'today' : formatDate(p.last_logged)}
          </span>
        )}
        <div className="flex items-center gap-2">
          {/* Sprint 9: PIN status warning */}
          {p.has_pin === false && (
            <span className="text-xs font-semibold text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full border border-amber-400/20">
              🔑 No PIN
            </span>
          )}
          <div className="flex items-center gap-1 text-stone-300">
            <span className="text-xs">Goal: {p.target_weight} kg</span>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
