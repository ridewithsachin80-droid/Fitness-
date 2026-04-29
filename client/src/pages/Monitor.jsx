import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  LineChart, BarChart, Bar, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, CartesianGrid,
} from 'recharts';
import { getPatient } from '../api/logs';
import { addLabValue } from '../api/logs';
import { setMemberPin, addNote, logWeightForPatient } from '../api/logs';
import { Card, SectionTitle, BackButton, PageLoader, StatPill, BottomNav } from '../components/UI';
import { formatDate, ACTIVITIES, ACV_ITEMS, SUPPLEMENTS, getNutrition, RDA_TARGETS } from '../constants';
import { useSync } from '../hooks/useSync';
import { useAuthStore } from '../store/authStore';

// ── Nutrition helper — Sprint 1 foods have per_100g, legacy fall back to NUTRITION_DB
function calcN(item) {
  if (!item) return null;
  if (item.per_100g) {
    const f = (item.grams || 0) / 100;
    const n = item.per_100g;
    return {
      cal:  Math.round((n.calories || 0) * f),
      pro:  +((n.protein    || 0) * f).toFixed(1),
      carb: +((n.net_carbs != null ? n.net_carbs : n.total_carbs || 0) * f).toFixed(1),
      fat:  +((n.fat        || 0) * f).toFixed(1),
    };
  }
  return getNutrition(item.name, item.grams);
}

// ── Compliance from a raw server log row ──────────────────────────────────────
function calcMicrosFromItems(foodItems = [], supplements = {}) {
  const m = foodItems.reduce((acc, item) => {
    if (!item.per_100g) return acc;
    const f = item.grams / 100;
    const n = item.per_100g;
    const add = (k) => acc[k] + (n[k] || 0) * f;
    return {
      vit_a:add('vit_a'),vit_b1:add('vit_b1'),vit_b2:add('vit_b2'),vit_b3:add('vit_b3'),
      vit_b5:add('vit_b5'),vit_b6:add('vit_b6'),vit_b12:add('vit_b12'),vit_c:add('vit_c'),
      vit_d:add('vit_d'),vit_e:add('vit_e'),vit_k:add('vit_k'),folate:add('folate'),
      biotin:add('biotin'),choline:add('choline'),
      calcium:add('calcium'),iron:add('iron'),magnesium:add('magnesium'),
      phosphorus:add('phosphorus'),potassium:add('potassium'),sodium:add('sodium'),
      zinc:add('zinc'),copper:add('copper'),manganese:add('manganese'),selenium:add('selenium'),
      omega3_ala:add('omega3_ala'),omega3_epa:add('omega3_epa'),omega3_dha:add('omega3_dha'),
      omega6:add('omega6'),fiber:add('fiber'),lycopene:add('lycopene'),beta_glucan:add('beta_glucan'),
    };
  }, {
    vit_a:0,vit_b1:0,vit_b2:0,vit_b3:0,vit_b5:0,vit_b6:0,vit_b12:0,vit_c:0,vit_d:0,
    vit_e:0,vit_k:0,folate:0,biotin:0,choline:0,calcium:0,iron:0,magnesium:0,
    phosphorus:0,potassium:0,sodium:0,zinc:0,copper:0,manganese:0,selenium:0,
    omega3_ala:0,omega3_epa:0,omega3_dha:0,omega6:0,fiber:0,lycopene:0,beta_glucan:0,
  });

  // Add supplement contributions
  if (supplements?.b12)     m.vit_b12  += 1000;
  if (supplements?.d3)      m.vit_d    += 8571;
  if (supplements?.fishoil) { m.omega3_epa += 180; m.omega3_dha += 120; }
  if (supplements?.flax)    m.omega3_ala += 533;
  if (supplements?.multi)   {
    m.vit_b12+=2.4; m.vit_d+=600; m.vit_c+=90; m.calcium+=200;
    m.iron+=8; m.magnesium+=100; m.zinc+=8; m.folate+=400;
  }
  if (supplements?.yeast)   { m.vit_b12+=1.0; m.folate+=125; }
  return m;
}
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
    <div className="bg-[#1a1a20] border border-white/[0.10] rounded-xl px-3 py-2 shadow-float text-xs">
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
      <div className="bg-[#131317] rounded-3xl border border-white/[0.08] w-full max-w-sm p-5 space-y-3">
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
            <label className="block text-[10px] text-[#4e4e5c] font-semibold uppercase tracking-[0.10em] mb-1.5">{label}</label>
            <input type={type} value={form[key]} placeholder={placeholder}
              onChange={e => set(key, e.target.value)}
              className="w-full border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300" />
          </div>
        ))}
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button onClick={submit} disabled={saving}
          className="w-full py-3 bg-[#2ce89c] hover:bg-[#34d399] text-[#040c08] font-bold rounded-xl transition-colors disabled:opacity-50">
          {saving ? 'Saving…' : 'Add Lab Value'}
        </button>
      </div>
    </div>
  );
}

// ── Set PIN modal (Sprint 8) ──────────────────────────────────────────────────
function SetPinModal({ patientId, patientName, onClose, onSaved }) {
  const [pin,     setPin]     = useState('');
  const [confirm, setConfirm] = useState('');
  const [show,    setShow]    = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState(false);

  const submit = async () => {
    if (pin.length < 4)     { setError('PIN must be at least 4 characters'); return; }
    if (pin !== confirm)    { setError('PINs do not match'); return; }
    setSaving(true); setError('');
    try {
      await setMemberPin(patientId, pin);
      setSuccess(true);
      setTimeout(() => { onSaved(); onClose(); }, 1200);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to set PIN');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center p-4">
      <div className="bg-[#131317] rounded-3xl border border-white/[0.08] w-full max-w-sm p-5 space-y-3">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h3 className="font-bold text-stone-800">Set Login PIN</h3>
            <p className="text-xs text-stone-400 mt-0.5">{patientName}</p>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 text-xl">×</button>
        </div>
        {success ? (
          <div className="text-center py-4">
            <div className="text-3xl mb-2">✅</div>
            <p className="font-semibold text-[#2ce89c]">PIN set successfully!</p>
            <p className="text-xs text-stone-400 mt-1">Member can now log in with this PIN</p>
          </div>
        ) : (
          <>
            <p className="text-xs text-stone-500 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
              Share this PIN with the member in person. They use it with their phone number to log in.
            </p>
            {[
              { label: 'New PIN', value: pin, onChange: setPin },
              { label: 'Confirm PIN', value: confirm, onChange: setConfirm },
            ].map(({ label, value, onChange }) => (
              <div key={label}>
                <label className="block text-[10px] text-[#4e4e5c] font-semibold uppercase tracking-[0.10em] mb-1.5">{label}</label>
                <div className="relative">
                  <input type={show ? 'text' : 'password'} inputMode="numeric" value={value}
                    onChange={e => onChange(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()}
                    placeholder="Min. 4 characters"
                    className="w-full border border-stone-200 rounded-xl px-3 py-2.5 pr-14 text-sm
                      focus:outline-none focus:ring-2 focus:ring-emerald-300 tracking-widest" />
                  {label === 'New PIN' && (
                    <button type="button" onClick={() => setShow(s => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-stone-400 font-medium">
                      {show ? 'Hide' : 'Show'}
                    </button>
                  )}
                </div>
              </div>
            ))}
            {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-xl">{error}</p>}
            <button onClick={submit} disabled={saving || !pin || !confirm}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold
                rounded-xl transition-colors disabled:opacity-50">
              {saving ? 'Saving…' : 'Set PIN'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Add Note modal (Sprint 9) ─────────────────────────────────────────────────
function AddNoteModal({ patientId, onClose, onAdded }) {
  const today = new Date().toISOString().split('T')[0];
  const [form,    setForm]    = useState({ note_date: today, note: '', flagged: false });
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.note.trim()) { setError('Note cannot be empty'); return; }
    setSaving(true); setError('');
    try {
      const { data } = await addNote(patientId, form);
      onAdded(data);
      onClose();
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to save note');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center p-4">
      <div className="bg-[#131317] rounded-3xl border border-white/[0.08] w-full max-w-sm p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-stone-800">Add Clinical Note</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 text-xl">×</button>
        </div>

        <div>
          <label className="block text-[10px] text-[#4e4e5c] font-semibold uppercase tracking-[0.10em] mb-1.5">Date</label>
          <input type="date" value={form.note_date} max={today}
            onChange={e => set('note_date', e.target.value)}
            className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm
              focus:outline-none focus:ring-2 focus:ring-emerald-300" />
        </div>

        <div>
          <label className="block text-[10px] text-[#4e4e5c] font-semibold uppercase tracking-[0.10em] mb-1.5">Note</label>
          <textarea value={form.note} onChange={e => set('note', e.target.value)}
            rows={4} placeholder="Clinical observations, progress notes, instructions…"
            className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm
              focus:outline-none focus:ring-2 focus:ring-emerald-300 resize-none" />
        </div>

        <label className="flex items-center gap-3 cursor-pointer select-none">
          <input type="checkbox" checked={form.flagged} onChange={e => set('flagged', e.target.checked)}
            className="w-4 h-4 accent-red-500 rounded" />
          <div>
            <span className="text-sm font-semibold text-stone-700">🚩 Flag for follow-up</span>
            <p className="text-xs text-stone-400">Highlights this note for urgent attention</p>
          </div>
        </label>

        {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-xl">{error}</p>}

        <button onClick={submit} disabled={saving || !form.note.trim()}
          className="w-full py-3 bg-[#0e0e12] hover:bg-[#08080b] text-white font-bold
            rounded-xl transition-colors disabled:opacity-50">
          {saving ? 'Saving…' : 'Save Note'}
        </button>
      </div>
    </div>
  );
}

// ── Weight Entry modal (Sprint 11) ───────────────────────────────────────────
function WeightEntryModal({ patientId, patientName, onClose, onSaved }) {
  const todayStr = new Date().toISOString().split('T')[0];
  const [date,    setDate]    = useState(todayStr);
  const [weight,  setWeight]  = useState('');
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState(false);

  const submit = async () => {
    const w = parseFloat(weight);
    if (!weight || isNaN(w) || w < 20 || w > 400) {
      setError('Enter a valid weight between 20–400 kg');
      return;
    }
    setSaving(true); setError('');
    try {
      const { data } = await logWeightForPatient(patientId, date, w);
      setSuccess(true);
      setTimeout(() => { onSaved(data.log); onClose(); }, 1000);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to save weight');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center p-4">
      <div className="bg-[#131317] rounded-3xl border border-white/[0.08] w-full max-w-sm p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-stone-800">Log Weight</h3>
            <p className="text-xs text-stone-400 mt-0.5">{patientName}</p>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 text-xl">×</button>
        </div>

        {success ? (
          <div className="text-center py-4">
            <div className="text-3xl mb-2">✅</div>
            <p className="font-semibold text-[#2ce89c]">Weight saved!</p>
          </div>
        ) : (
          <>
            <p className="text-xs text-stone-500 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2">
              Creates or updates the weight entry for the selected date. Other log data is preserved.
            </p>
            <div>
              <label className="block text-[10px] text-[#4e4e5c] font-semibold uppercase tracking-[0.10em] mb-1.5">Date</label>
              <input type="date" value={date} max={todayStr}
                onChange={e => setDate(e.target.value)}
                className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm
                  focus:outline-none focus:ring-2 focus:ring-emerald-300" />
            </div>
            <div>
              <label className="block text-[10px] text-[#4e4e5c] font-semibold uppercase tracking-[0.10em] mb-1.5">Weight (kg)</label>
              <div className="flex items-center gap-2">
                <input type="number" step="0.1" inputMode="decimal" value={weight}
                  onChange={e => setWeight(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && submit()}
                  placeholder="e.g. 84.5"
                  className="flex-1 text-2xl font-bold text-center border-2 border-stone-200
                    rounded-2xl py-3 focus:outline-none focus:ring-2 focus:ring-emerald-300 text-stone-800" />
                <span className="text-stone-400 font-bold text-lg">kg</span>
              </div>
            </div>
            {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-xl">{error}</p>}
            <button onClick={submit} disabled={saving || !weight}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold
                rounded-xl transition-colors disabled:opacity-50">
              {saving ? 'Saving…' : 'Save Weight'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Monitor page ──────────────────────────────────────────────────────────────
export default function Monitor() {
  const { patientId } = useParams();
  const navigate      = useNavigate();
  const { user }      = useAuthStore();
  const [data,          setData]      = useState(null);
  const [loading,       setLoading]   = useState(true);
  const [showLabForm,   setShowLab]   = useState(false);
  const [showPinForm,   setShowPin]   = useState(false);
  const [showNoteForm,  setShowNote]  = useState(false);
  const [showWeightForm,setShowWeight]= useState(false);
  const [selectedLog,   setSelectedLog] = useState(null); // compliance chart drill-down
  const [viewDate,      setViewDate]    = useState(null); // selected date in log viewer

  // Sprint 13: open a print-ready report in a new tab
  const printReport = () => {
    if (!data) return;
    const { profile, logs, labs, notes = [] } = data;
    const sorted = [...logs].sort((a, b) => a.log_date.localeCompare(b.log_date));
    const last30 = sorted.slice(-30);
    const avg = last30.length
      ? Math.round(last30.reduce((s, l) => s + (l.compliance_pct || 0), 0) / last30.length)
      : null;
    const latestW = sorted.filter(l => l.weight_kg).slice(-1)[0]?.weight_kg;
    const lostKg  = profile.start_weight && latestW
      ? +(profile.start_weight - latestW).toFixed(1) : null;
    const flaggedNotes = notes.filter(n => n.flagged);

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>FitLife Report — ${profile.name}</title>
    <style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1c1917;padding:32px;font-size:13px;line-height:1.5}
      h1{font-size:22px;font-weight:700;margin-bottom:4px}
      h2{font-size:14px;font-weight:700;margin:20px 0 8px;color:#166534;border-bottom:1px solid #d1fae5;padding-bottom:4px}
      .meta{color:#78716c;font-size:12px;margin-bottom:20px}
      .grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:4px}
      .stat{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 14px}
      .stat .val{font-size:20px;font-weight:700;color:#15803d}
      .stat .lbl{font-size:11px;color:#4ade80;margin-top:2px}
      table{width:100%;border-collapse:collapse;font-size:12px}
      th{background:#f5f5f4;padding:6px 8px;text-align:left;font-weight:600;color:#57534e;border-bottom:2px solid #e7e5e4}
      td{padding:5px 8px;border-bottom:1px solid #f5f5f4}
      tr:nth-child(even) td{background:#fafaf9}
      .badge{display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600}
      .ok{background:#dcfce7;color:#166534}.warn{background:#fef3c7;color:#92400e}.bad{background:#fee2e2;color:#991b1b}
      .flag{background:#fee2e2;color:#991b1b;padding:8px 12px;border-radius:8px;border-left:3px solid #ef4444;margin-bottom:8px}
      .note-item{padding:8px 12px;border-radius:8px;background:#f5f5f4;margin-bottom:6px;font-size:12px}
      .footer{margin-top:32px;padding-top:12px;border-top:1px solid #e7e5e4;color:#a8a29e;font-size:11px;display:flex;justify-content:space-between}
      @media print{body{padding:20px}@page{margin:1.5cm}}
    </style></head><body>
    <h1>${profile.name}</h1>
    <p class="meta">Phone: ${profile.phone || '—'} &nbsp;·&nbsp; Height: ${profile.height_cm || '—'} cm &nbsp;·&nbsp;
      Conditions: ${(profile.conditions || []).map(c => c.replace(/_/g,' ')).join(', ') || 'None'} &nbsp;·&nbsp;
      Coach: ${profile.monitor_name || '—'} &nbsp;·&nbsp; Report generated: ${new Date().toLocaleDateString('en-IN', {day:'numeric',month:'long',year:'numeric'})}</p>

    <div class="grid2">
      <div class="stat"><div class="val">${latestW || '—'} kg</div><div class="lbl">Current weight</div></div>
      <div class="stat"><div class="val">${lostKg !== null ? (lostKg >= 0 ? `↓ ${lostKg}` : `↑ ${Math.abs(lostKg)}`) : '—'} kg</div><div class="lbl">Change since start</div></div>
      <div class="stat"><div class="val">${profile.start_weight || '—'} kg</div><div class="lbl">Start weight</div></div>
      <div class="stat"><div class="val">${profile.target_weight || '—'} kg</div><div class="lbl">Target weight</div></div>
      <div class="stat"><div class="val">${avg !== null ? avg + '%' : '—'}</div><div class="lbl">30-day avg compliance</div></div>
      <div class="stat"><div class="val">${last30.length}</div><div class="lbl">Days logged (last 30)</div></div>
    </div>

    ${flaggedNotes.length ? `<h2>🚩 Flagged Notes</h2>
      ${flaggedNotes.map(n => `<div class="flag"><strong>${new Date(n.note_date+'T00:00:00').toLocaleDateString('en-IN')}</strong> — ${n.note}</div>`).join('')}` : ''}

    <h2>📊 Last 30 Days Compliance</h2>
    <table><thead><tr><th>Date</th><th>Compliance</th><th>Weight</th><th>Water</th><th>Sleep</th></tr></thead><tbody>
    ${[...last30].reverse().map(l => {
      const p = l.compliance_pct;
      const cls = p >= 75 ? 'ok' : p >= 50 ? 'warn' : 'bad';
      const s = l.sleep || {};
      const sleepStr = s.bedtime && s.waketime ? `${s.bedtime.slice(0,5)}→${s.waketime.slice(0,5)}` : '—';
      const d = new Date(l.log_date + 'T00:00:00');
      return `<tr><td>${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()}</td>
        <td><span class="badge ${cls}">${p != null ? p + '%' : '—'}</span></td>
        <td>${l.weight_kg || '—'} kg</td>
        <td>${l.water_ml ? (l.water_ml/1000).toFixed(1)+'L' : '—'}</td>
        <td>${sleepStr}</td></tr>`;
    }).join('')}
    </tbody></table>

    ${labs.length ? `<h2>🧪 Lab Values</h2>
    <table><thead><tr><th>Test</th><th>Value</th><th>Unit</th><th>Status</th><th>Date</th></tr></thead><tbody>
    ${labs.map(l => `<tr><td>${l.test_name}</td><td>${l.value}</td><td>${l.unit||'—'}</td>
      <td><span class="badge ${l.status==='normal'?'ok':l.status==='high'?'bad':'warn'}">${l.status||'—'}</span></td>
      <td>${new Date(l.test_date).toLocaleDateString('en-IN')}</td></tr>`).join('')}
    </tbody></table>` : ''}

    ${notes.length ? `<h2>📝 Clinical Notes</h2>
    ${notes.map(n => `<div class="note-item${n.flagged?' flag':''}">
      <strong>${new Date(n.note_date+'T00:00:00').toLocaleDateString('en-IN')}</strong>
      ${n.flagged ? ' 🚩' : ''} — ${n.note}</div>`).join('')}` : ''}

    <div class="footer"><span>FitLife Health Monitor</span><span>Confidential — for clinical use only</span></div>
    <script>window.onload=()=>window.print()</script></body></html>`;

    const win = window.open('', '_blank');
    if (win) { win.document.write(html); win.document.close(); }
  };

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

  const { profile, logs, labs, notes = [] } = data;

  // Date-scoped log viewer — default to most recent log date
  const sortedLogs   = [...logs].sort((a, b) => b.log_date.localeCompare(a.log_date));
  const activeDate   = viewDate || sortedLogs[0]?.log_date || null;
  const activeLog    = sortedLogs.find(l => l.log_date === activeDate) || null;

  // Weight chart — reverse so oldest is on left
  const weightData = [...logs]
    .filter(l => l.weight_kg)
    .reverse()
    .map(l => ({ date: formatDate(l.log_date), weight: parseFloat(l.weight_kg) }));

  // Sprint 6: 30-day compliance bar chart — attach full log so bars are tappable
  const complianceData = [...logs]
    .slice(0, 30)
    .reverse()
    .map(l => {
      const d = new Date(l.log_date + 'T00:00:00');
      return {
        date:  `${d.getDate()}/${d.getMonth()+1}`,
        score: l.compliance_pct || 0,
        log:   l,           // carry the full log for drill-down
      };
    });
  const avg30 = complianceData.length
    ? Math.round(complianceData.reduce((s, d) => s + d.score, 0) / complianceData.length)
    : 0;

  // Lab value charts — group by test name, show latest 8 per test
  const labByTest = {};
  labs.forEach(l => {
    if (!labByTest[l.test_name]) labByTest[l.test_name] = [];
    labByTest[l.test_name].push({ date: l.test_date.slice(0, 10), value: parseFloat(l.value) || 0 });
  });
  Object.values(labByTest).forEach(arr => arr.sort((a, b) => a.date.localeCompare(b.date)));

  const delta = profile.latest_weight && profile.start_weight
    ? (parseFloat(profile.start_weight) - parseFloat(profile.latest_weight || profile.start_weight)).toFixed(1)
    : null;

  return (
    <div className="min-h-screen bg-[#0b0b0e]">
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

          {/* Sprint 8+9+11+13: Quick-action buttons */}
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => setShowPin(true)}
              className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl
                transition-colors border ${profile.has_pin
                  ? 'text-emerald-100 bg-white/10 hover:bg-white/20 border-white/20'
                  : 'text-amber-900 bg-amber-400 hover:bg-amber-300 border-amber-300'}`}>
              🔑 {profile.has_pin ? 'Reset PIN' : '⚠ Set PIN (required to login)'}
            </button>
            <button onClick={() => setShowNote(true)}
              className="flex items-center gap-1.5 text-xs font-semibold text-emerald-100
                bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-xl transition-colors border border-white/20">
              📝 Add Note
            </button>
            <button onClick={() => setShowWeight(true)}
              className="flex items-center gap-1.5 text-xs font-semibold text-emerald-100
                bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-xl transition-colors border border-white/20">
              ⚖️ Log Weight
            </button>
            <button onClick={printReport}
              className="flex items-center gap-1.5 text-xs font-semibold text-emerald-100
                bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-xl transition-colors border border-white/20">
              🖨️ Print Report
            </button>
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
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#4e4e5c' }} tickLine={false} axisLine={false} />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 9, fill: '#4e4e5c' }} tickLine={false} axisLine={false} />
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

        {/* Sprint 6: 30-day compliance chart — tap a bar to drill into that day */}
        {complianceData.length > 1 && (
          <Card>
            <div className="flex items-center justify-between mb-2">
              <SectionTitle icon="📊">30-Day Compliance</SectionTitle>
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                avg30 >= 75 ? 'bg-emerald-100 text-emerald-700' :
                avg30 >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-50 text-red-500'
              }`}>avg {avg30}%</span>
            </div>
            <ResponsiveContainer width="100%" height={100}>
              <BarChart data={complianceData} margin={{ top: 2, right: 4, left: -24, bottom: 0 }}
                style={{ cursor: 'pointer' }}>
                <XAxis dataKey="date" tick={{ fontSize: 8, fill: '#4e4e5c' }} tickLine={false} axisLine={false}
                  interval={Math.floor(complianceData.length / 5)} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 8, fill: '#4e4e5c' }} tickLine={false} axisLine={false} />
                <Tooltip
                  content={({ active, payload }) => active && payload?.length
                    ? <div className="bg-[#1a1a20] border border-white/[0.07] rounded-xl px-2 py-1 shadow-sm text-xs">
                        <span className="font-bold text-emerald-600">{payload[0].value}%</span>
                        <span className="text-stone-400 ml-1">{payload[0].payload.date}</span>
                        <span className="text-stone-300 ml-1">· tap to view</span>
                      </div>
                    : null}
                />
                <Bar dataKey="score" fill="#10b981" radius={[2, 2, 0, 0]}
                  onClick={(data) => data?.log && setSelectedLog(data.log)} />
              </BarChart>
            </ResponsiveContainer>
            <p className="text-[10px] text-[#4e4e5c] mt-1.5 text-center">Tap any bar to see what they logged that day</p>
          </Card>
        )}

        {/* Drill-down modal — log detail for the tapped bar */}
        {selectedLog && (() => {
          const fl    = selectedLog;
          const dateLabel = new Date(fl.log_date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
          const foodItems = fl.food_items || [];
          const totalKcal = foodItems.reduce((s, i) => s + (calcN(i)?.cal || 0), 0);
          return (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center p-2"
              onClick={() => setSelectedLog(null)}>
              <div className="bg-[#131317] rounded-3xl border border-white/[0.08] w-full max-w-md max-h-[82vh] flex flex-col"
                onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-stone-100 flex-shrink-0">
                  <div>
                    <h3 className="font-bold text-stone-800">{dateLabel}</h3>
                    <div className="flex gap-3 mt-1">
                      {fl.weight_kg && <span className="text-xs font-semibold text-emerald-600">⚖ {fl.weight_kg} kg</span>}
                      {fl.compliance_pct != null && (
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                          fl.compliance_pct >= 75 ? 'bg-emerald-100 text-emerald-700' :
                          fl.compliance_pct >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'
                        }`}>{fl.compliance_pct}%</span>
                      )}
                    </div>
                  </div>
                  <button onClick={() => setSelectedLog(null)} className="text-stone-400 hover:text-stone-600 text-2xl leading-none">×</button>
                </div>
                <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
                  {foodItems.length > 0 && (
                    <div>
                      <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-2">
                        🥗 Food {totalKcal > 0 && <span className="font-normal text-orange-500 normal-case">· {totalKcal} kcal</span>}
                      </p>
                      <div className="space-y-1">
                        {foodItems.map((item, i) => {
                          const n = calcN(item);
                          return (
                            <div key={i} className="flex items-center justify-between text-sm py-1.5 border-b border-white/[0.05] last:border-0">
                              <div>
                                <span className="text-stone-700 font-medium">{item.name}</span>
                                <span className="text-xs text-stone-400 ml-1">{item.grams}g{item.meal ? ` · ${item.meal}` : ''}</span>
                              </div>
                              {n && <span className="text-xs font-bold text-orange-500">{n.cal} kcal</span>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {fl.water_ml > 0 && (
                    <p className="text-sm text-blue-600 font-semibold">💧 {(fl.water_ml / 1000).toFixed(1)} L water</p>
                  )}
                  {fl.notes && (
                    <div>
                      <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-1">📝 Notes</p>
                      <p className="text-sm text-stone-600 whitespace-pre-wrap leading-relaxed">{fl.notes}</p>
                    </div>
                  )}
                  {!foodItems.length && !fl.weight_kg && <p className="text-sm text-stone-400 italic text-center py-4">No data recorded this day.</p>}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Sprint 6: Lab value trend charts per test */}
        {Object.entries(labByTest).map(([testName, values]) => values.length < 2 ? null : (
          <Card key={testName}>
            <SectionTitle icon="📈">{testName} Trend</SectionTitle>
            <ResponsiveContainer width="100%" height={100}>
              <LineChart data={values} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" tick={{ fontSize: 8, fill: '#4e4e5c' }} tickLine={false} axisLine={false} />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 8, fill: '#4e4e5c' }} tickLine={false} axisLine={false} />
                <Tooltip
                  content={({ active, payload }) => active && payload?.length
                    ? <div className="bg-[#1a1a20] border border-white/[0.07] rounded-xl px-2 py-1 shadow-sm text-xs">
                        <span className="font-bold text-blue-600">{payload[0].value}</span>
                        <span className="text-stone-400 ml-1">{payload[0].payload.date}</span>
                      </div>
                    : null}
                />
                <Line type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={2}
                  dot={{ fill: '#6366f1', r: 3 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        ))}

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

        {/* Sprint 9: Clinical Notes */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <SectionTitle icon="📝">Clinical Notes</SectionTitle>
            <button onClick={() => setShowNote(true)}
              className="text-xs font-semibold text-stone-600 bg-stone-100 px-3 py-1.5 rounded-xl
                hover:bg-white/[0.08] transition-colors">
              + Add
            </button>
          </div>
          {notes.length === 0 ? (
            <p className="text-xs text-stone-300 italic text-center py-4">No clinical notes yet</p>
          ) : (
            <div className="space-y-2">
              {[...notes].sort((a, b) => (b.flagged ? 1 : 0) - (a.flagged ? 1 : 0)).map(n => (
                <div key={n.id}
                  className={`rounded-2xl px-4 py-3 border ${n.flagged
                    ? 'bg-red-50 border-red-200'
                    : 'bg-stone-50 border-stone-100'}`}>
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      {n.flagged && (
                        <span className="text-xs font-semibold text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full">
                          🚩 Follow-up
                        </span>
                      )}
                      <span className="text-xs font-semibold text-stone-500">
                        {formatDate(n.note_date)}
                      </span>
                      <span className="text-xs text-stone-400">· {n.monitor_name}</span>
                    </div>
                  </div>
                  <p className="text-sm text-stone-700 leading-relaxed whitespace-pre-wrap">{n.note}</p>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Daily Log Viewer — date chip navigator + single-date detail */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <SectionTitle icon="📋">Daily Log</SectionTitle>
            {activeLog && (
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                (activeLog.compliance_pct||0) >= 75 ? 'bg-[rgba(44,232,156,0.12)] text-[#2ce89c]' :
                (activeLog.compliance_pct||0) >= 50 ? 'bg-amber-400/10 text-amber-400' :
                                                      'bg-red-400/10 text-red-400'
              }`}>{activeLog.compliance_pct||0}%</span>
            )}
          </div>

          {logs.length === 0 ? (
            <p className="text-xs text-[#4e4e5c] italic text-center py-4">No logs yet</p>
          ) : (
            <>
              {/* Date chip navigator — horizontal scroll, newest first */}
              <div className="flex gap-1.5 overflow-x-auto pb-2 mb-4 [&::-webkit-scrollbar]:hidden"
                style={{ scrollbarWidth: 'none' }}>
                {sortedLogs.map(log => {
                  const d = new Date(log.log_date + 'T00:00:00');
                  const isToday = log.log_date === new Date().toISOString().split('T')[0];
                  const isActive = log.log_date === activeDate;
                  const pct = log.compliance_pct || 0;
                  const dotColor = pct >= 75 ? '#2ce89c' : pct >= 50 ? '#fbbf24' : '#f87171';
                  const dayLabel = isToday ? 'Today' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                  return (
                    <button key={log.log_date}
                      onClick={() => setViewDate(log.log_date)}
                      className={`flex-shrink-0 flex flex-col items-center gap-1 px-3 py-2 rounded-xl
                        border transition-all text-xs font-semibold ${
                        isActive
                          ? 'bg-[rgba(44,232,156,0.10)] border-[rgba(44,232,156,0.30)] text-[#2ce89c]'
                          : 'bg-[#1a1a20] border-white/[0.07] text-[#6a6a78] hover:border-white/[0.18] hover:text-[#ededf0]'
                      }`}>
                      <span>{dayLabel}</span>
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: dotColor }} />
                    </button>
                  );
                })}
              </div>

              {/* Selected day full detail */}
              {activeLog ? (() => {
                const log = activeLog;
                const score = log.compliance_pct || rowCompliance(log);
                const weightKg = parseFloat(log.weight_kg) || 0;
                const burnedKcal = weightKg > 0
                  ? ACTIVITIES.reduce((sum, a) => {
                      if (!log.activities?.[a.id] || !a.met) return sum;
                      return sum + Math.round(a.met * weightKg * ((a.durationMin || 30) / 60));
                    }, 0)
                  : 0;
                const eatenKcal = (log.food_items || []).reduce((sum, f) => {
                  const n = calcN(f); return sum + (n?.cal || 0);
                }, 0);
                const netKcal = eatenKcal - burnedKcal;

                return (
                  <div className="space-y-3">

                    {/* Weight + stats row */}
                    <div className="grid grid-cols-3 gap-2">
                      <StatPill value={log.weight_kg ? `${log.weight_kg} kg` : '—'} label="Weight" color="emerald" />
                      <StatPill value={`${((log.water_ml || 0) / 1000).toFixed(1)}L`} label="Water" color="blue" />
                      <StatPill value={log.sleep?.quality > 0 ? '⭐'.repeat(log.sleep.quality) : '—'} label="Sleep" color="purple" />
                    </div>

                    {/* Net calorie row */}
                    {burnedKcal > 0 && (
                      <div className={`flex items-center justify-between text-xs px-3 py-2.5 rounded-xl border ${
                        netKcal <= 0 ? 'bg-[rgba(44,232,156,0.07)] border-[rgba(44,232,156,0.20)] text-[#2ce89c]'
                        : netKcal <= 200 ? 'bg-amber-400/10 border-amber-400/20 text-amber-400'
                        : 'bg-red-400/10 border-red-400/20 text-red-400'
                      }`}>
                        <div className="flex gap-3">
                          <span>🍽 <strong>{eatenKcal}</strong> eaten</span>
                          <span>🔥 <strong>{burnedKcal}</strong> burned</span>
                        </div>
                        <span className="font-bold">Net {netKcal > 0 ? `+${netKcal}` : netKcal} kcal{netKcal <= 0 && ' 🎯'}</span>
                      </div>
                    )}

                    {/* Meal plan adherence */}
                    {data?.profile?.meal_plan?.length > 0 && (
                      <div className="rounded-xl border border-white/[0.07] overflow-hidden">
                        <div className="px-3 py-2 bg-[#1a1a20] border-b border-white/[0.06]">
                          <span className="text-[10px] font-bold text-[#4e4e5c] uppercase tracking-[0.10em]">🍽 Meal Plan Adherence</span>
                        </div>
                        <div className="px-3 py-2.5 flex flex-wrap gap-2">
                          {data.profile.meal_plan.map(meal => {
                            const logged  = (log.food_items || []).map(f => f.name?.toLowerCase());
                            const total   = (meal.items || []).length;
                            const matched = (meal.items || []).filter(i => logged.includes(i.food_name?.toLowerCase())).length;
                            const pct     = total > 0 ? matched / total : 0;
                            const color   = pct >= 0.8 ? 'bg-[rgba(44,232,156,0.10)] text-[#2ce89c] border-[rgba(44,232,156,0.22)]'
                                          : pct >= 0.5 ? 'bg-amber-400/10 text-amber-400 border-amber-400/25'
                                          :              'bg-red-400/10 text-red-400 border-red-400/25';
                            const icon    = pct >= 0.8 ? '✓' : pct >= 0.5 ? '~' : '✗';
                            return (
                              <div key={meal.id} className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${color}`}>
                                {icon} {meal.name} {total > 0 ? `${matched}/${total}` : ''}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Food log */}
                    {log.food_items?.length > 0 && (
                      <div className="rounded-xl border border-white/[0.07] overflow-hidden">
                        <div className="px-3 py-2 bg-[#1a1a20] border-b border-white/[0.06] flex justify-between">
                          <span className="text-[10px] font-bold text-[#4e4e5c] uppercase tracking-[0.10em]">🥗 Food Log</span>
                          <span className="text-xs font-bold text-[#2ce89c]">{eatenKcal} kcal total</span>
                        </div>
                        {['Meal 1', 'Meal 2', 'Meal 3'].map(meal => {
                          const mealItems = log.food_items.filter(f => f.meal === meal);
                          if (!mealItems.length) return null;
                          const mealCal = mealItems.reduce((s, f) => s + (calcN(f)?.cal || 0), 0);
                          return (
                            <div key={meal} className="border-b border-white/[0.05] last:border-0">
                              <div className="px-3 py-1.5 flex justify-between items-center bg-white/[0.02]">
                                <span className="text-[10px] font-semibold text-[#6a6a78] uppercase tracking-wide">{meal}</span>
                                <span className="text-xs text-[#4e4e5c]">{mealCal} kcal</span>
                              </div>
                              {mealItems.map((f, i) => {
                                const n = calcN(f);
                                return (
                                  <div key={i} className="px-3 py-2 flex items-start justify-between gap-2 border-t border-white/[0.04]">
                                    <div className="min-w-0">
                                      <div className="text-sm font-medium text-[#d8d8de] truncate">{f.name}</div>
                                      <div className="text-xs text-[#4e4e5c]">{f.grams}g</div>
                                    </div>
                                    {n && (
                                      <div className="flex gap-2.5 text-right flex-shrink-0">
                                        <div className="text-center">
                                          <div className="text-xs font-bold text-orange-400">{n.cal}</div>
                                          <div className="text-[10px] text-[#4e4e5c]">kcal</div>
                                        </div>
                                        <div className="text-center">
                                          <div className="text-xs font-bold text-blue-400">{n.pro}g</div>
                                          <div className="text-[10px] text-[#4e4e5c]">pro</div>
                                        </div>
                                        <div className="text-center">
                                          <div className="text-xs font-bold text-amber-400">{n.carb}g</div>
                                          <div className="text-[10px] text-[#4e4e5c]">carb</div>
                                        </div>
                                        <div className="text-center">
                                          <div className="text-xs font-bold text-purple-400">{n.fat}g</div>
                                          <div className="text-[10px] text-[#4e4e5c]">fat</div>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                        {/* Day total row */}
                        {(() => {
                          const t = log.food_items.reduce((acc, f) => {
                            const n = calcN(f);
                            if (!n) return acc;
                            return { cal: acc.cal+n.cal, pro: acc.pro+n.pro, carb: acc.carb+n.carb, fat: acc.fat+n.fat };
                          }, { cal:0, pro:0, carb:0, fat:0 });
                          return (
                            <div className="px-3 py-2.5 bg-[rgba(44,232,156,0.05)] flex items-center justify-between border-t border-[rgba(44,232,156,0.12)]">
                              <span className="text-xs font-bold text-[#2ce89c]">Day Total</span>
                              <div className="flex gap-3 text-xs">
                                <span className="font-bold text-orange-400">{t.cal} kcal</span>
                                <span className="text-blue-400">{t.pro.toFixed(1)}g P</span>
                                <span className="text-amber-400">{t.carb.toFixed(1)}g C</span>
                                <span className="text-purple-400">{t.fat.toFixed(1)}g F</span>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {/* Activity + ACV pills */}
                    <div className="flex flex-wrap gap-1.5">
                      {ACTIVITIES.map(a => (
                        <span key={a.id} className={`text-xs px-2 py-1 rounded-lg font-medium border ${
                          log.activities?.[a.id]
                            ? 'bg-[rgba(44,232,156,0.10)] border-[rgba(44,232,156,0.22)] text-[#2ce89c]'
                            : 'bg-white/[0.04] border-white/[0.06] text-[#4e4e5c]'
                        }`}>{a.icon}</span>
                      ))}
                      {ACV_ITEMS.map((a, i) => (
                        <span key={a.id} className={`text-xs px-2 py-1 rounded-lg font-semibold border ${
                          log.acv?.[a.id]
                            ? 'bg-purple-500/10 border-purple-500/20 text-purple-400'
                            : 'bg-white/[0.04] border-white/[0.06] text-[#4e4e5c]'
                        }`}>ACV{i+1}</span>
                      ))}
                    </div>

                    {/* Key nutrients collapsible */}
                    {(log.food_items || []).some(f => f.per_100g) && (() => {
                      const rdaOv = data?.profile?.rda_overrides || {};
                      const micros = calcMicrosFromItems(log.food_items, log.supplements);
                      const KEYS = ['vit_b12','vit_d','vit_c','calcium','iron','magnesium','zinc','folate','omega3_epa','omega3_dha','fiber'];
                      const met  = KEYS.filter(k => {
                        const meta = RDA_TARGETS[k];
                        if (!meta) return false;
                        const rda = rdaOv[k] ? parseFloat(rdaOv[k]) : meta.rda;
                        return (micros[k]||0) / rda >= 0.8;
                      }).length;
                      return (
                        <details className="border border-white/[0.07] rounded-xl overflow-hidden">
                          <summary className="px-3 py-2.5 text-xs font-semibold text-[#6a6a78] cursor-pointer
                            hover:text-[#2ce89c] list-none flex justify-between items-center bg-[#1a1a20]">
                            <span>🔬 Key Nutrients</span>
                            <span className={`px-2 py-0.5 rounded-full font-bold text-xs ${
                              met >= KEYS.length*0.8 ? 'bg-[rgba(44,232,156,0.12)] text-[#2ce89c]' :
                              met >= KEYS.length*0.5 ? 'bg-amber-400/10 text-amber-400' : 'bg-red-400/10 text-red-400'
                            }`}>{met}/{KEYS.length} ▼</span>
                          </summary>
                          <div className="px-3 py-3 space-y-2 bg-[#131317]">
                            {KEYS.map(k => {
                              const meta = RDA_TARGETS[k];
                              if (!meta) return null;
                              const rda  = rdaOv[k] ? parseFloat(rdaOv[k]) : meta.rda;
                              const raw  = micros[k] || 0;
                              const dec  = ['vit_b12','folate','vit_b6'].includes(k) ? 1 : 0;
                              const val  = +raw.toFixed(dec);
                              const pct  = Math.min(100, (raw / rda) * 100);
                              const cls  = pct>=80 ? 'bg-[#2ce89c]' : pct>=50 ? 'bg-amber-400' : 'bg-red-400';
                              const tcls = pct>=80 ? 'text-[#2ce89c]' : pct>=50 ? 'text-amber-400' : 'text-red-400';
                              return (
                                <div key={k}>
                                  <div className="flex justify-between text-xs mb-1">
                                    <span className="text-[#6a6a78]">{meta.icon} {meta.label}</span>
                                    <span className={`font-bold ${tcls}`}>{val}/{rda} {meta.unit}</span>
                                  </div>
                                  <div className="h-1 bg-white/[0.06] rounded-full overflow-hidden">
                                    <div className={`h-full rounded-full transition-all ${cls}`} style={{width:`${pct}%`}} />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </details>
                      );
                    })()}

                    {/* Notes */}
                    {log.notes && (
                      <p className="text-xs text-[#6a6a78] italic border-t border-white/[0.06] pt-2.5 leading-relaxed">
                        📝 {log.notes}
                      </p>
                    )}
                  </div>
                );
              })() : (
                <p className="text-xs text-[#4e4e5c] italic text-center py-4">No log for this date</p>
              )}
            </>
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

      {/* Sprint 8: Set PIN modal */}
      {showPinForm && (
        <SetPinModal
          patientId={patientId}
          patientName={profile.name}
          onClose={() => setShowPin(false)}
          onSaved={() => setData(d => ({ ...d, profile: { ...d.profile, has_pin: true } }))}
        />
      )}

      {/* Sprint 9: Add note modal */}
      {showNoteForm && (
        <AddNoteModal
          patientId={patientId}
          onClose={() => setShowNote(false)}
          onAdded={(newNote) => setData(d => ({ ...d, notes: [newNote, ...(d.notes || [])] }))}
        />
      )}

      {/* Sprint 11: Weight entry modal */}
      {showWeightForm && (
        <WeightEntryModal
          patientId={patientId}
          patientName={profile.name}
          onClose={() => setShowWeight(false)}
          onSaved={(log) => {
            setData(d => ({
              ...d,
              logs: d.logs.some(l => l.log_date === log.log_date)
                ? d.logs.map(l => l.log_date === log.log_date ? { ...l, weight_kg: log.weight_kg } : l)
                : [log, ...d.logs],
            }));
          }}
        />
      )}

      <BottomNav role={user?.role} />
    </div>
  );
}
