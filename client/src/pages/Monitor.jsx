import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, CartesianGrid,
} from 'recharts';
import { getPatient } from '../api/logs';
import { addLabValue } from '../api/logs';
import { Card, SectionTitle, BackButton, PageLoader, StatPill } from '../components/UI';
import { formatDate, ACTIVITIES, ACV_ITEMS, SUPPLEMENTS } from '../constants';
import { useSync } from '../hooks/useSync';

// ── Compliance from a raw server log row ──────────────────────────────────────
function rowCompliance(log) {
  if (!log) return 0;
  const a = Object.values(log.activities  || {}).filter(Boolean).length;
  const c = Object.values(log.acv         || {}).filter(Boolean).length;
  const s = Object.values(log.supplements || {}).filter(Boolean).length;
  return Math.round(((a + c + s) / 16) * 100);
}

// ── Custom chart tooltip ──────────────────────────────────────────────────────
function WeightTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-stone-200 rounded-xl px-3 py-2 shadow-float text-xs">
      <p className="text-stone-400 mb-0.5">{label}</p>
      <p className="font-bold text-emerald-700">{payload[0].value} kg</p>
    </div>
  );
}

// ── Add lab value modal ───────────────────────────────────────────────────────
function AddLabModal({ patientId, onClose, onAdded }) {
  const [form, setForm] = useState({
    test_date: new Date().toISOString().split('T')[0],
    test_name: '', value: '', unit: '', ref_min: '', ref_max: '',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.test_date || !form.test_name || !form.value) {
      setError('Date, test name and value are required'); return;
    }
    setSaving(true);
    try {
      const { data } = await addLabValue(patientId, form);
      onAdded(data);
      onClose();
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to save');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-sm p-5 space-y-3">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-bold text-stone-800">Add Lab Value</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 text-xl">×</button>
        </div>
        {[
          { key: 'test_date', label: 'Date',      type: 'date' },
          { key: 'test_name', label: 'Test name', type: 'text', placeholder: 'HbA1c, GGT, B12…' },
          { key: 'value',     label: 'Value',     type: 'number', placeholder: '6.2' },
          { key: 'unit',      label: 'Unit',      type: 'text', placeholder: '%  mmol/L  pg/mL…' },
          { key: 'ref_min',   label: 'Ref min',   type: 'number', placeholder: '4.0' },
          { key: 'ref_max',   label: 'Ref max',   type: 'number', placeholder: '5.6' },
        ].map(({ key, label, type, placeholder }) => (
          <div key={key}>
            <label className="block text-xs text-stone-400 font-medium mb-1">{label}</label>
            <input type={type} value={form[key]} placeholder={placeholder}
              onChange={e => set(key, e.target.value)}
              className="w-full border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300" />
          </div>
        ))}
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button onClick={submit} disabled={saving}
          className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition-colors disabled:opacity-50">
          {saving ? 'Saving…' : 'Add Lab Value'}
        </button>
      </div>
    </div>
  );
}

// ── Monitor page ──────────────────────────────────────────────────────────────
export default function Monitor() {
  const { patientId } = useParams();
  const navigate      = useNavigate();
  const [data,       setData]    = useState(null);
  const [loading,    setLoading] = useState(true);
  const [showLabForm,setShowLab] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: res } = await getPatient(patientId);
      setData(res);
    } catch (e) {
      console.error('Failed to load patient', e);
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => { load(); }, [load]);

  // Real-time: reload when this patient saves a new log
  useSync((update) => {
    if (String(update.patientId) === String(patientId)) {
      load();
    }
  });

  if (loading) return <PageLoader />;
  if (!data)   return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center p-4">
      <div className="text-center">
        <p className="text-stone-500 mb-4">Patient not found or not assigned to you.</p>
        <button onClick={() => navigate('/monitor')} className="text-emerald-600 font-semibold">← Back</button>
      </div>
    </div>
  );

  const { profile, logs, labs } = data;

  // Weight chart — reverse so oldest is on left
  const weightData = [...logs]
    .filter(l => l.weight_kg)
    .reverse()
    .map(l => ({ date: formatDate(l.log_date), weight: parseFloat(l.weight_kg) }));

  const delta = profile.latest_weight && profile.start_weight
    ? (parseFloat(profile.start_weight) - parseFloat(profile.latest_weight || profile.start_weight)).toFixed(1)
    : null;

  return (
    <div className="min-h-screen bg-stone-100">
      {/* Header */}
      <div className="bg-gradient-to-br from-emerald-700 to-emerald-900 text-white px-4 pt-10 pb-6">
        <div className="max-w-md mx-auto">
          <BackButton onClick={() => navigate('/monitor')} label="All patients" />
          <div className="mt-3 flex items-start justify-between">
            <div>
              <h1 className="text-xl font-bold">{profile.name}</h1>
              <p className="text-emerald-300 text-xs mt-0.5">
                {profile.height_cm}cm · Start: {profile.start_weight}kg · Goal: {profile.target_weight}kg
              </p>
              {profile.conditions?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {profile.conditions.map(c => (
                    <span key={c} className="text-xs bg-white/15 text-emerald-100 px-2 py-0.5 rounded-full">
                      {c.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {delta !== null && (
              <div className="text-right flex-shrink-0">
                <div className={`text-2xl font-bold ${parseFloat(delta) > 0 ? 'text-emerald-300' : 'text-amber-300'}`}>
                  {parseFloat(delta) > 0 ? '↓' : '↑'} {Math.abs(parseFloat(delta))} kg
                </div>
                <div className="text-xs text-emerald-400">lost so far</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-md mx-auto px-4 pt-4 pb-8 space-y-3">

        {/* Weight chart */}
        {weightData.length > 1 && (
          <Card>
            <SectionTitle icon="📈">Weight Trend</SectionTitle>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={weightData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0efed" />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#a8a29e' }} tickLine={false} axisLine={false} />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 9, fill: '#a8a29e' }} tickLine={false} axisLine={false} />
                <Tooltip content={<WeightTooltip />} />
                {profile.start_weight && (
                  <ReferenceLine y={parseFloat(profile.start_weight)} stroke="#f87171"
                    strokeDasharray="4 4" label={{ value: 'Start', position: 'right', fontSize: 9, fill: '#f87171' }} />
                )}
                {profile.target_weight && (
                  <ReferenceLine y={parseFloat(profile.target_weight)} stroke="#34d399"
                    strokeDasharray="4 4" label={{ value: 'Goal', position: 'right', fontSize: 9, fill: '#34d399' }} />
                )}
                <Line type="monotone" dataKey="weight" stroke="#10b981" strokeWidth={2.5}
                  dot={{ fill: '#10b981', r: 3, strokeWidth: 0 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        )}

        {/* Lab values */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <SectionTitle icon="🧪">Lab Values</SectionTitle>
            <button onClick={() => setShowLab(true)}
              className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-xl hover:bg-emerald-100 transition-colors">
              + Add
            </button>
          </div>
          {labs.length === 0 ? (
            <p className="text-xs text-stone-300 italic text-center py-4">No lab values recorded yet</p>
          ) : (
            <div className="space-y-0 divide-y divide-stone-50">
              {labs.map(l => (
                <div key={l.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <div className="text-sm font-semibold text-stone-700">{l.test_name}</div>
                    <div className="text-xs text-stone-400">{formatDate(l.test_date)}</div>
                  </div>
                  <div className="text-right">
                    <span className={`font-bold text-sm ${
                      l.status === 'high' ? 'text-red-600' :
                      l.status === 'low'  ? 'text-blue-600' : 'text-emerald-600'
                    }`}>
                      {l.value} {l.unit}
                    </span>
                    <div className={`text-xs mt-0.5 font-medium px-1.5 py-0.5 rounded-full inline-block ml-1 ${
                      l.status === 'high' ? 'bg-red-50 text-red-600' :
                      l.status === 'low'  ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600'
                    }`}>
                      {l.status}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Recent logs */}
        <Card>
          <SectionTitle icon="📋">Recent Logs</SectionTitle>
          {logs.length === 0 ? (
            <p className="text-xs text-stone-300 italic text-center py-4">No logs yet</p>
          ) : (
            <div className="space-y-2">
              {logs.map(log => {
                const score = rowCompliance(log);
                const badge = score >= 75 ? { bg: 'bg-emerald-100', text: 'text-emerald-700' }
                            : score >= 50 ? { bg: 'bg-amber-100',   text: 'text-amber-700'   }
                            :               { bg: 'bg-red-100',     text: 'text-red-700'      };
                return (
                  <div key={log.id} className="bg-stone-50 rounded-2xl p-3 border border-stone-100">
                    {/* Row 1 — date, weight, score */}
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-stone-700 text-sm">{formatDate(log.log_date)}</span>
                      <div className="flex items-center gap-2">
                        {log.weight_kg && (
                          <span className="text-xs font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                            {log.weight_kg} kg
                          </span>
                        )}
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${badge.bg} ${badge.text}`}>
                          {score}%
                        </span>
                      </div>
                    </div>

                    {/* Row 2 — water / sleep / foods */}
                    <div className="grid grid-cols-3 gap-1.5 mb-2">
                      <StatPill value={`${((log.water_ml || 0) / 1000).toFixed(1)}L`} label="Water" color="blue" />
                      <StatPill
                        value={log.sleep?.quality > 0 ? '⭐'.repeat(log.sleep.quality) : '—'}
                        label="Sleep" color="purple" />
                      <StatPill value={log.food_items?.length || 0} label="Foods" color="stone" />
                    </div>

                    {/* Activity pills */}
                    <div className="flex flex-wrap gap-1">
                      {ACTIVITIES.map(a => (
                        <span key={a.id} className={`text-xs px-1.5 py-0.5 rounded-md font-medium ${
                          log.activities?.[a.id] ? 'bg-emerald-500 text-white' : 'bg-stone-200 text-stone-400'
                        }`}>{a.icon}</span>
                      ))}
                      {ACV_ITEMS.map((a, i) => (
                        <span key={a.id} className={`text-xs px-1.5 py-0.5 rounded-md font-bold ${
                          log.acv?.[a.id] ? 'bg-purple-500 text-white' : 'bg-stone-200 text-stone-400'
                        }`}>ACV{i + 1}</span>
                      ))}
                    </div>

                    {log.notes && (
                      <p className="mt-2 text-xs text-stone-500 italic border-t border-stone-100 pt-2">
                        {log.notes}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Add lab modal */}
      {showLabForm && (
        <AddLabModal
          patientId={patientId}
          onClose={() => setShowLab(false)}
          onAdded={(newLab) => setData(d => ({ ...d, labs: [newLab, ...d.labs] }))}
        />
      )}
    </div>
  );
}
