import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import api from '../api/client';
import { Card, SectionTitle, PageLoader } from '../components/UI';
import { ACTIVITIES, ACV_ITEMS, SUPPLEMENTS } from '../constants';

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ value, label, icon, color }) {
  const colors = {
    emerald: 'bg-emerald-50 text-emerald-700',
    blue:    'bg-blue-50    text-blue-700',
    purple:  'bg-purple-50  text-purple-700',
  };
  return (
    <div className={`rounded-2xl p-4 ${colors[color]}`}>
      <div className="text-2xl mb-1">{icon}</div>
      <div className="text-3xl font-bold">{value}</div>
      <div className="text-xs font-medium opacity-70 mt-0.5">{label}</div>
    </div>
  );
}

// ── Modal wrapper ─────────────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-sm max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-stone-100">
          <h3 className="font-bold text-stone-800 text-base">{title}</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 text-2xl leading-none">×</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ── Input helper ──────────────────────────────────────────────────────────────
function Field({ label, type = 'text', value, onChange, placeholder, required }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1.5">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm
          focus:outline-none focus:ring-2 focus:ring-emerald-300 text-stone-800"
      />
    </div>
  );
}

// ── Add Member modal ──────────────────────────────────────────────────────────
function AddMemberModal({ monitors, onClose, onAdded }) {
  const [form, setForm] = useState({
    name: '', phone: '', height_cm: '', start_weight: '',
    target_weight: '', monitor_id: '',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.name || !form.phone) { setError('Name and phone are required'); return; }
    setSaving(true); setError('');
    try {
      const { data } = await api.post('/admin/members', {
        ...form,
        monitor_id:    form.monitor_id   || null,
        height_cm:     form.height_cm    || null,
        start_weight:  form.start_weight || null,
        target_weight: form.target_weight|| null,
      });
      onAdded(data);
      onClose();
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to create member');
      setSaving(false);
    }
  };

  return (
    <Modal title="Add New Member" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Full Name"   value={form.name}         onChange={v=>set('name',v)}         placeholder="Mrs. Padmini" required />
        <Field label="Phone"       value={form.phone}        onChange={v=>set('phone',v)}        placeholder="9876543210"   required type="tel" />
        <Field label="Height (cm)" value={form.height_cm}    onChange={v=>set('height_cm',v)}    placeholder="165"         type="number" />
        <Field label="Start Weight (kg)" value={form.start_weight} onChange={v=>set('start_weight',v)} placeholder="85"   type="number" />
        <Field label="Target Weight (kg)" value={form.target_weight} onChange={v=>set('target_weight',v)} placeholder="70" type="number" />

        {/* Assign monitor */}
        <div>
          <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1.5">
            Assign to Monitor
          </label>
          <select
            value={form.monitor_id}
            onChange={e => set('monitor_id', e.target.value)}
            className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm
              focus:outline-none focus:ring-2 focus:ring-emerald-300 text-stone-800 bg-white"
          >
            <option value="">— Unassigned —</option>
            {monitors.map(m => (
              <option key={m.id} value={m.id}>{m.name} ({m.role})</option>
            ))}
          </select>
        </div>

        {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-xl">{error}</p>}

        <button onClick={submit} disabled={saving}
          className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold
            rounded-xl transition-colors disabled:opacity-50 mt-2">
          {saving ? 'Creating…' : 'Create Member'}
        </button>
      </div>
    </Modal>
  );
}

// ── Edit Member modal ─────────────────────────────────────────────────────────
function EditMemberModal({ member, onClose, onSaved }) {
  // ── Fetch full profile on open (list query only has basic fields) ───────────
  // We use 'data' as the source of truth once loaded; falls back to 'member' prop.
  const [data, setData] = useState(member);
  const [loadingProfile, setLoadingProfile] = useState(true);

  useEffect(() => {
    api.get(`/admin/members/${member.id}`)
      .then(res => setData({ ...member, ...res.data }))
      .catch(() => { /* use member prop as fallback */ })
      .finally(() => setLoadingProfile(false));
  }, [member.id]);

  const [form, setForm] = useState({
    name:          member.name          || '',
    phone:         member.phone         || '',
    pin:           '',
    confirmPin:    '',
    height_cm:     member.height_cm     || '',
    start_weight:  member.start_weight  || '',
    target_weight: member.target_weight || '',
  });

  // Re-init form fields when full profile loads
  useEffect(() => {
    if (loadingProfile) return;
    setForm(f => ({
      ...f,
      height_cm:     data.height_cm     || '',
      start_weight:  data.start_weight  || '',
      target_weight: data.target_weight || '',
    }));
    setProto({
      activities:  data.protocol_activities  || null,
      acv:         data.protocol_acv         || null,
      supplements: data.protocol_supplements || null,
    });
    setOverrides(data.item_overrides || {});
    setCustomItems({
      activities:  data.custom_activities  || [],
      acv:         data.custom_acv         || [],
      supplements: data.custom_supplements || [],
    });
    setFasting({
      start: data.fasting_start ? String(data.fasting_start).slice(0, 5) : '',
      end:   data.fasting_end   ? String(data.fasting_end).slice(0, 5)   : '',
      note:  data.fasting_note  || '',
      label: data.fasting_label || '',
    });
    setMacros({
      kcal:  data.macro_kcal  ? String(data.macro_kcal)  : '',
      pro:   data.macro_pro   ? String(data.macro_pro)   : '',
      carb:  data.macro_carb  ? String(data.macro_carb)  : '',
      fat:   data.macro_fat   ? String(data.macro_fat)   : '',
      phase: data.macro_phase || '',
    });
  }, [loadingProfile]);

  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [showPin, setShowPin] = useState(false);
  const [tab,     setTab]     = useState('identity');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Protocol enabled IDs (null = all enabled)
  const [proto, setProto] = useState({
    activities:  member.protocol_activities  || null,
    acv:         member.protocol_acv         || null,
    supplements: member.protocol_supplements || null,
  });

  // Per-item overrides: { [itemId]: { label, sub, fromTime, toTime, totalTime } }
  const [overrides, setOverrides] = useState(member.item_overrides || {});

  // Custom items per section
  const [customItems, setCustomItems] = useState({
    activities:  member.custom_activities  || [],
    acv:         member.custom_acv         || [],
    supplements: member.custom_supplements || [],
  });

  // Which item is being edited inline
  const [editingId, setEditingId] = useState(null);
  // Draft state while editing
  const [draft, setDraft] = useState({});

  // Adding new custom item
  const [addingKey, setAddingKey] = useState(null);
  const [newItem, setNewItem]     = useState({ label: '', sub: '', fromTime: '', toTime: '', totalTime: '' });

  // ── Sprint 2: Fasting window ───────────────────────────────────────────────
  const [fasting, setFasting] = useState({
    start: member.fasting_start ? String(member.fasting_start).slice(0, 5) : '',
    end:   member.fasting_end   ? String(member.fasting_end).slice(0, 5)   : '',
    note:  member.fasting_note  || '',
    label: member.fasting_label || '',
  });
  const setF = (k, v) => setFasting(f => ({ ...f, [k]: v }));

  // ── Sprint 2: Macro targets ────────────────────────────────────────────────
  const [macros, setMacros] = useState({
    kcal:  member.macro_kcal  ? String(member.macro_kcal)  : '',
    pro:   member.macro_pro   ? String(member.macro_pro)   : '',
    carb:  member.macro_carb  ? String(member.macro_carb)  : '',
    fat:   member.macro_fat   ? String(member.macro_fat)   : '',
    phase: member.macro_phase || '',
  });
  const setM = (k, v) => setMacros(m => ({ ...m, [k]: v }));

  // ── Protocol sub-tab (items / fasting / macros) ────────────────────────────
  const [protoTab, setProtoTab] = useState('items');

  const toggleProto = (key, id, defaultItems) => {
    setProto(p => {
      const current = p[key] || defaultItems.map(i => i.id);
      const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id];
      return { ...p, [key]: next.length === defaultItems.length ? null : next };
    });
  };

  const startEdit = (item) => {
    const ov = overrides[item.id] || {};
    setDraft({
      label:     ov.label     ?? item.label ?? '',
      sub:       ov.sub       ?? item.sub   ?? '',
      fromTime:  ov.fromTime  ?? '',
      toTime:    ov.toTime    ?? '',
      totalTime: ov.totalTime ?? '',
    });
    setEditingId(item.id);
  };

  const saveEdit = (id) => {
    setOverrides(o => ({ ...o, [id]: { ...draft } }));
    setEditingId(null);
  };

  const deleteItem = (key, id, isCustom) => {
    if (isCustom) {
      setCustomItems(c => ({ ...c, [key]: c[key].filter(i => i.id !== id) }));
    }
    setProto(p => {
      const def = key === 'activities' ? ACTIVITIES : key === 'acv' ? ACV_ITEMS : SUPPLEMENTS;
      const current = p[key] || def.map(i => i.id);
      return { ...p, [key]: current.filter(x => x !== id) };
    });
    setOverrides(o => { const n = { ...o }; delete n[id]; return n; });
  };

  const confirmAddCustom = (key) => {
    if (!newItem.label.trim()) return;
    const id   = `custom_${Date.now()}`;
    const item = { id, label: newItem.label.trim(), sub: newItem.sub.trim(), custom: true };
    const ov   = { label: item.label, sub: item.sub,
                   fromTime: newItem.fromTime, toTime: newItem.toTime, totalTime: newItem.totalTime };
    setCustomItems(c => ({ ...c, [key]: [...c[key], item] }));
    setOverrides(o => ({ ...o, [id]: ov }));
    setProto(p => {
      const def = key === 'activities' ? ACTIVITIES : key === 'acv' ? ACV_ITEMS : SUPPLEMENTS;
      const current = p[key] || def.map(i => i.id);
      return { ...p, [key]: [...current, id] };
    });
    setAddingKey(null);
    setNewItem({ label: '', sub: '', fromTime: '', toTime: '', totalTime: '' });
  };

  const submit = async () => {
    if (!form.name.trim() || !form.phone.trim()) { setError('Name and phone are required'); return; }
    if (form.pin && form.pin !== form.confirmPin) { setError('PINs do not match'); return; }
    setSaving(true); setError('');
    try {
      const { data } = await api.put(`/admin/members/${member.id}`, {
        name:          form.name.trim(),
        phone:         form.phone.trim(),
        pin:           form.pin || undefined,
        height_cm:     form.height_cm     || null,
        start_weight:  form.start_weight  || null,
        target_weight: form.target_weight || null,
        protocol_activities:  proto.activities,
        protocol_acv:         proto.acv,
        protocol_supplements: proto.supplements,
        custom_activities:    customItems.activities,
        custom_acv:           customItems.acv,
        custom_supplements:   customItems.supplements,
        item_overrides:       overrides,
        // Sprint 2
        fasting_start: fasting.start || null,
        fasting_end:   fasting.end   || null,
        fasting_note:  fasting.note  || null,
        fasting_label: fasting.label || null,
        macro_kcal:  macros.kcal  ? parseInt(macros.kcal)  : null,
        macro_pro:   macros.pro   ? parseInt(macros.pro)   : null,
        macro_carb:  macros.carb  ? parseInt(macros.carb)  : null,
        macro_fat:   macros.fat   ? parseInt(macros.fat)   : null,
        macro_phase: macros.phase || null,
      });
      onSaved(data);
      onClose();
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to save changes');
      setSaving(false);
    }
  };

  // ── Fasting tab ────────────────────────────────────────────────────────────
  const FastingTab = () => {
    // Live preview bar (recalculates on fasting state change)
    const timeToMin = (t) => { if (!t) return 0; const [h,m]=t.split(':').map(Number); return h*60+m; };
    const TOTAL = 1440;
    const fastStartMin = timeToMin(fasting.start);
    const fastEndMin   = timeToMin(fasting.end);
    const hasValues    = fasting.start && fasting.end;
    const crossesMid   = hasValues && fastStartMin > fastEndMin;
    const eatHrs  = hasValues ? (crossesMid ? (fastStartMin - fastEndMin) : (fastEndMin - fastStartMin)) / 60 : 0;
    const fastHrs = hasValues ? 24 - eatHrs : 0;

    // Segments for preview bar
    let segments = [];
    if (hasValues) {
      if (crossesMid) {
        if (fastEndMin > 0)        segments.push({ pct: (fastEndMin / TOTAL)*100, type:'fast' });
        segments.push({ pct: ((fastStartMin - fastEndMin) / TOTAL)*100, type:'eat' });
        if (fastStartMin < TOTAL)  segments.push({ pct: ((TOTAL - fastStartMin) / TOTAL)*100, type:'fast' });
      } else {
        if (fastStartMin > 0)      segments.push({ pct: (fastStartMin / TOTAL)*100, type:'eat' });
        segments.push({ pct: ((fastEndMin - fastStartMin) / TOTAL)*100, type:'fast' });
        if (fastEndMin < TOTAL)    segments.push({ pct: ((TOTAL - fastEndMin) / TOTAL)*100, type:'eat' });
      }
    }

    return (
      <div className="space-y-4">
        <p className="text-xs text-stone-400">
          Set the fasting window. Member sees a live bar showing exactly where they are right now.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1.5">
              Fast Begins ⏸
            </label>
            <input type="time" value={fasting.start} onChange={e => setF('start', e.target.value)}
              className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm
                focus:outline-none focus:ring-2 focus:ring-emerald-300 text-stone-800" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1.5">
              Eating Window Opens ▶
            </label>
            <input type="time" value={fasting.end} onChange={e => setF('end', e.target.value)}
              className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm
                focus:outline-none focus:ring-2 focus:ring-emerald-300 text-stone-800" />
          </div>
        </div>

        {/* Live preview bar */}
        {hasValues && (
          <div className="bg-stone-50 rounded-2xl p-3">
            <div className="flex justify-between text-xs text-stone-500 mb-1.5">
              <span className="font-semibold text-blue-600">🔵 Fasting {fastHrs.toFixed(1)}h</span>
              <span className="font-semibold text-emerald-600">🟢 Eating {eatHrs.toFixed(1)}h</span>
            </div>
            <div className="h-5 rounded-full overflow-hidden flex">
              {segments.map((s, i) => (
                <div key={i} style={{ width: `${s.pct}%` }}
                  className={s.type === 'eat' ? 'bg-emerald-400' : 'bg-blue-400'} />
              ))}
            </div>
            <div className="flex justify-between mt-1 text-xs text-stone-400">
              <span>12AM</span><span>6AM</span><span>12PM</span><span>6PM</span><span>12AM</span>
            </div>
            <p className="text-xs text-stone-500 mt-2 text-center font-medium">
              Eating: {fasting.end} – {fasting.start} · Fasting: {fasting.start} – {fasting.end}
            </p>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1.5">
            Protocol Label (shown to member)
          </label>
          <input value={fasting.label} onChange={e => setF('label', e.target.value)}
            placeholder="e.g. 16:8 Intermittent Fasting"
            className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm
              focus:outline-none focus:ring-2 focus:ring-emerald-300 text-stone-800" />
        </div>

        <div>
          <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1.5">
            Member-Facing Note
          </label>
          <textarea value={fasting.note} onChange={e => setF('note', e.target.value)} rows={2}
            placeholder="e.g. Water and black coffee allowed during fasting window"
            className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm
              focus:outline-none focus:ring-2 focus:ring-emerald-300 text-stone-800 resize-none" />
        </div>

        {(fasting.start || fasting.end) && (
          <button onClick={() => setFasting({ start:'', end:'', note:'', label:'' })}
            className="text-xs text-red-400 hover:text-red-600 font-semibold">
            🗑 Clear fasting window
          </button>
        )}
      </div>
    );
  };

  // ── Macros tab ─────────────────────────────────────────────────────────────
  const MacrosTab = () => {
    const p = parseFloat(macros.pro)  || 0;
    const c = parseFloat(macros.carb) || 0;
    const f = parseFloat(macros.fat)  || 0;
    const fromMacros = Math.round(p * 4 + c * 4 + f * 9);
    const target     = parseInt(macros.kcal) || 0;
    const diff       = target - fromMacros;
    const absDiff    = Math.abs(diff);
    const diffOk     = target === 0 || absDiff <= 100;

    return (
      <div className="space-y-3">
        <p className="text-xs text-stone-400">
          Set daily targets. Member sees live progress bars that fill as food is logged.
        </p>

        <div>
          <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1.5">
            Daily Calorie Target (kcal)
          </label>
          <input type="number" value={macros.kcal} onChange={e => setM('kcal', e.target.value)}
            placeholder="e.g. 1450"
            className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm
              focus:outline-none focus:ring-2 focus:ring-emerald-300 text-stone-800" />
        </div>

        <div className="grid grid-cols-3 gap-2">
          {[['pro','Protein (g)','66'],['carb','Net Carbs (g)','144'],['fat','Fat (g)','57']].map(([k,lbl,ph]) => (
            <div key={k}>
              <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1.5">{lbl}</label>
              <input type="number" value={macros[k]} onChange={e => setM(k, e.target.value)}
                placeholder={ph}
                className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm
                  focus:outline-none focus:ring-2 focus:ring-emerald-300 text-stone-800" />
            </div>
          ))}
        </div>

        {/* Live macro → kcal calculator */}
        {(p > 0 || c > 0 || f > 0) && (
          <div className={`rounded-xl px-3 py-2.5 text-xs ${diffOk ? 'bg-emerald-50' : 'bg-amber-50'}`}>
            <div className="flex justify-between items-center">
              <span className="text-stone-500">
                {p}×4 + {c}×4 + {f}×9 = <span className="font-bold text-stone-700">{fromMacros} kcal from macros</span>
              </span>
              {target > 0 && (
                <span className={`font-bold ml-2 ${diffOk ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {diffOk ? '✓ Balanced' : `${diff > 0 ? '+' : ''}${diff} kcal off`}
                </span>
              )}
            </div>
            {!diffOk && (
              <p className="text-amber-600 mt-1">⚠️ Macro kcal is {absDiff} kcal away from target — adjust to match.</p>
            )}
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1.5">
            Phase / Label (shown to member)
          </label>
          <input value={macros.phase} onChange={e => setM('phase', e.target.value)}
            placeholder="e.g. Phase 1 — Fat Loss"
            className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm
              focus:outline-none focus:ring-2 focus:ring-emerald-300 text-stone-800" />
        </div>

        {(macros.kcal || macros.pro) && (
          <button onClick={() => setMacros({ kcal:'', pro:'', carb:'', fat:'', phase:'' })}
            className="text-xs text-red-400 hover:text-red-600 font-semibold">
            🗑 Clear macro targets
          </button>
        )}
      </div>
    );
  };

  // ── Inline timing edit form ────────────────────────────────────────────────
  const EditForm = ({ onSave, onCancel }) => (
    <div className="mt-2 ml-7 space-y-2 p-2.5 bg-stone-50 rounded-xl border border-stone-200">
      <div className="flex gap-2">
        <div className="flex-1">
          <p className="text-xs text-stone-400 mb-1">Label</p>
          <input value={draft.label} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))}
            placeholder="Item name"
            className="w-full text-sm border border-stone-200 rounded-lg px-2 py-1.5 outline-none focus:border-emerald-400" />
        </div>
      </div>
      <div>
        <p className="text-xs text-stone-400 mb-1">Description (optional)</p>
        <input value={draft.sub} onChange={e => setDraft(d => ({ ...d, sub: e.target.value }))}
          placeholder="e.g. 30 min · 6:30–7:00 AM"
          className="w-full text-sm border border-stone-200 rounded-lg px-2 py-1.5 outline-none focus:border-emerald-400" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <p className="text-xs text-stone-400 mb-1">From</p>
          <input type="time" value={draft.fromTime} onChange={e => setDraft(d => ({ ...d, fromTime: e.target.value }))}
            className="w-full text-xs border border-stone-200 rounded-lg px-2 py-1.5 outline-none focus:border-emerald-400" />
        </div>
        <div>
          <p className="text-xs text-stone-400 mb-1">To</p>
          <input type="time" value={draft.toTime} onChange={e => setDraft(d => ({ ...d, toTime: e.target.value }))}
            className="w-full text-xs border border-stone-200 rounded-lg px-2 py-1.5 outline-none focus:border-emerald-400" />
        </div>
        <div>
          <p className="text-xs text-stone-400 mb-1">Duration</p>
          <input value={draft.totalTime} onChange={e => setDraft(d => ({ ...d, totalTime: e.target.value }))}
            placeholder="30 min"
            className="w-full text-xs border border-stone-200 rounded-lg px-2 py-1.5 outline-none focus:border-emerald-400" />
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={onSave}
          className="flex-1 py-1.5 text-xs bg-emerald-600 text-white rounded-lg font-semibold hover:bg-emerald-700">
          ✓ Save
        </button>
        <button onClick={onCancel}
          className="px-3 py-1.5 text-xs text-stone-500 hover:text-stone-700 rounded-lg border border-stone-200">
          Cancel
        </button>
      </div>
    </div>
  );

  // ── Add new custom item form ───────────────────────────────────────────────
  const AddForm = ({ protoKey }) => (
    <div className="mt-2 p-2.5 bg-emerald-50 rounded-xl border border-emerald-200 space-y-2">
      <p className="text-xs font-semibold text-emerald-700">New item</p>
      <input autoFocus value={newItem.label}
        onChange={e => setNewItem(n => ({ ...n, label: e.target.value }))}
        onKeyDown={e => e.key === 'Enter' && confirmAddCustom(protoKey)}
        placeholder="Item name (required)"
        className="w-full text-sm border border-emerald-300 rounded-lg px-2.5 py-1.5 outline-none focus:border-emerald-500 bg-white" />
      <input value={newItem.sub}
        onChange={e => setNewItem(n => ({ ...n, sub: e.target.value }))}
        placeholder="Description (optional)"
        className="w-full text-sm border border-stone-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-emerald-400 bg-white" />
      <div className="grid grid-cols-3 gap-2">
        <div>
          <p className="text-xs text-stone-400 mb-1">From</p>
          <input type="time" value={newItem.fromTime}
            onChange={e => setNewItem(n => ({ ...n, fromTime: e.target.value }))}
            className="w-full text-xs border border-stone-200 rounded-lg px-2 py-1.5 outline-none focus:border-emerald-400 bg-white" />
        </div>
        <div>
          <p className="text-xs text-stone-400 mb-1">To</p>
          <input type="time" value={newItem.toTime}
            onChange={e => setNewItem(n => ({ ...n, toTime: e.target.value }))}
            className="w-full text-xs border border-stone-200 rounded-lg px-2 py-1.5 outline-none focus:border-emerald-400 bg-white" />
        </div>
        <div>
          <p className="text-xs text-stone-400 mb-1">Duration</p>
          <input value={newItem.totalTime}
            onChange={e => setNewItem(n => ({ ...n, totalTime: e.target.value }))}
            placeholder="30 min"
            className="w-full text-xs border border-stone-200 rounded-lg px-2 py-1.5 outline-none focus:border-emerald-400 bg-white" />
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={() => confirmAddCustom(protoKey)}
          className="flex-1 py-1.5 text-xs bg-emerald-600 text-white rounded-lg font-semibold hover:bg-emerald-700">
          + Add
        </button>
        <button onClick={() => { setAddingKey(null); setNewItem({ label:'',sub:'',fromTime:'',toTime:'',totalTime:'' }); }}
          className="px-3 py-1.5 text-xs text-stone-500 hover:text-stone-700 rounded-lg border border-stone-200">
          Cancel
        </button>
      </div>
    </div>
  );

  // ── Protocol section ───────────────────────────────────────────────────────
  const ProtocolSection = ({ label, icon, items, protoKey }) => {
    const allItems = [...items, ...customItems[protoKey]];
    const assigned = proto[protoKey] || items.map(i => i.id);

    return (
      <div className="border border-stone-100 rounded-2xl p-3 space-y-1">
        <p className="text-xs font-bold tracking-widest uppercase text-stone-400 mb-2">{icon} {label}</p>

        {allItems.map(item => {
          const ov       = overrides[item.id] || {};
          const dispLabel = ov.label || item.label || '';
          const dispSub   = ov.sub   || item.sub   || '';
          const timing    = [ov.fromTime, ov.toTime].filter(Boolean).join('–');
          const duration  = ov.totalTime || '';
          const subLine   = [duration, timing].filter(Boolean).join(' · ') || dispSub;
          const isEditing = editingId === item.id;
          const enabled   = assigned.includes(item.id);

          return (
            <div key={item.id} className={`rounded-xl transition-colors ${enabled ? '' : 'opacity-40'}`}>
              <div className="flex items-center gap-2 py-1.5">
                {/* Checkbox */}
                <input type="checkbox" checked={enabled}
                  onChange={() => toggleProto(protoKey, item.id, items)}
                  className="w-4 h-4 accent-emerald-600 flex-shrink-0 cursor-pointer" />

                {/* Label + sub */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-stone-700 leading-tight">{dispLabel}</div>
                  {subLine && <div className="text-xs text-stone-400 mt-0.5">{subLine}</div>}
                </div>

                {/* Edit button */}
                <button onClick={() => isEditing ? setEditingId(null) : startEdit(item)}
                  className={`text-xs px-2 py-1 rounded-lg font-medium transition-colors flex-shrink-0 ${
                    isEditing ? 'bg-emerald-100 text-emerald-700' : 'text-stone-400 hover:text-emerald-600 hover:bg-emerald-50'}`}>
                  ✏️
                </button>

                {/* Delete button */}
                <button onClick={() => deleteItem(protoKey, item.id, !!item.custom)}
                  className="text-xs px-2 py-1 rounded-lg text-stone-300 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0">
                  🗑
                </button>
              </div>

              {/* Inline edit form */}
              {isEditing && <EditForm onSave={() => saveEdit(item.id)} onCancel={() => setEditingId(null)} />}
            </div>
          );
        })}

        {/* Add item */}
        {addingKey === protoKey
          ? <AddForm protoKey={protoKey} />
          : (
            <button onClick={() => setAddingKey(protoKey)}
              className="flex items-center gap-1.5 text-xs text-emerald-600 hover:text-emerald-800 font-semibold mt-2 px-1">
              <span className="text-base leading-none">+</span> Add custom item
            </button>
          )
        }
      </div>
    );
  };

  return (
    <Modal title={`Edit — ${member.name}`} onClose={onClose}>
      {/* Tab switcher */}
      <div className="flex gap-1 bg-stone-100 p-1 rounded-xl mb-4">
        {[['identity','👤 Identity'],['protocol','📋 Protocol']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-colors ${
              tab === id ? 'bg-white text-emerald-700 shadow-sm' : 'text-stone-500'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'identity' && (
        <div className="space-y-3">
          <p className="text-xs font-bold tracking-widest uppercase text-stone-400">Identity</p>
          <Field label="Full Name"        value={form.name}  onChange={v=>set('name',v)}  placeholder="Mrs. Padmini" required />
          <Field label="Phone (Login ID)" type="tel" value={form.phone} onChange={v=>set('phone',v)} placeholder="9876543210" required />

          <div className="border border-stone-100 rounded-2xl p-3 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold tracking-widest uppercase text-stone-400">PIN / Password</p>
              <button onClick={() => { setShowPin(s => !s); set('pin',''); set('confirmPin',''); }}
                className={`text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors ${
                  showPin ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700'}`}>
                {showPin ? 'Cancel' : '🔑 Change PIN'}
              </button>
            </div>
            {showPin ? (
              <>
                <Field label="New PIN (min 4 digits)" type="password" value={form.pin} onChange={v=>set('pin',v)} placeholder="e.g. 1234" />
                <Field label="Confirm PIN" type="password" value={form.confirmPin} onChange={v=>set('confirmPin',v)} placeholder="Repeat PIN" />
              </>
            ) : (
              <p className="text-xs text-stone-400">Leave unchanged — member uses existing PIN.</p>
            )}
          </div>

          <p className="text-xs font-bold tracking-widest uppercase text-stone-400 mt-1">Profile</p>
          <Field label="Height (cm)"        type="number" value={form.height_cm}     onChange={v=>set('height_cm',v)}     placeholder="165" />
          <Field label="Start Weight (kg)"  type="number" value={form.start_weight}  onChange={v=>set('start_weight',v)}  placeholder="85" />
          <Field label="Target Weight (kg)" type="number" value={form.target_weight} onChange={v=>set('target_weight',v)} placeholder="70" />
        </div>
      )}

      {tab === 'protocol' && (
        <div className="space-y-3">
          {/* Protocol sub-tabs */}
          <div className="flex gap-1 bg-stone-100 p-1 rounded-xl">
            {[['items','📋 Items'],['fasting','⏰ Fasting'],['macros','🎯 Macros']].map(([id, label]) => (
              <button key={id} onClick={() => setProtoTab(id)}
                className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                  protoTab === id ? 'bg-white text-emerald-700 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}>
                {label}
              </button>
            ))}
          </div>

          {protoTab === 'items' && (
            <>
              <p className="text-xs text-stone-400 bg-amber-50 px-3 py-2 rounded-xl">
                ✅ Check/uncheck to assign. ✏️ Edit label & timing. 🗑 Delete item.
              </p>
              <ProtocolSection label="Physical Activities" icon="🏃" items={ACTIVITIES}  protoKey="activities"  />
              <ProtocolSection label="Apple Cider Vinegar" icon="🍶" items={ACV_ITEMS}   protoKey="acv"         />
              <ProtocolSection label="Supplements"         icon="💊" items={SUPPLEMENTS} protoKey="supplements" />
            </>
          )}

          {protoTab === 'fasting' && FastingTab()}
          {protoTab === 'macros'  && MacrosTab()}
        </div>
      )}

      {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-xl mt-3">{error}</p>}

      <button onClick={submit} disabled={saving}
        className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold
          rounded-xl transition-colors disabled:opacity-50 mt-4">
        {saving ? 'Saving…' : 'Save Changes'}
      </button>
    </Modal>
  );
}

// ── Add Monitor modal ─────────────────────────────────────────────────────────
function AddMonitorModal({ onClose, onAdded }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'monitor' });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.name || !form.email || !form.password) { setError('All fields required'); return; }
    if (form.password.length < 8) { setError('Password must be at least 8 characters'); return; }
    setSaving(true); setError('');
    try {
      const { data } = await api.post('/admin/monitors', form);
      onAdded(data);
      onClose();
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to create monitor');
      setSaving(false);
    }
  };

  return (
    <Modal title="Add Monitor / Trainer" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Full Name" value={form.name} onChange={v=>set('name',v)} placeholder="Dr. Sachin" required />
        <Field label="Email" type="email" value={form.email} onChange={v=>set('email',v)} placeholder="trainer@fitlife.app" required />
        <Field label="Password" type="password" value={form.password} onChange={v=>set('password',v)} placeholder="Min 8 characters" required />

        <div>
          <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1.5">Role</label>
          <div className="flex gap-2">
            {['monitor','admin'].map(r => (
              <button key={r} onClick={() => set('role', r)}
                className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-all capitalize ${
                  form.role === r
                    ? 'bg-stone-800 text-white border-stone-800'
                    : 'bg-white text-stone-500 border-stone-200 hover:border-stone-300'
                }`}>
                {r === 'admin' ? '👑 Admin' : '🏋️ Monitor'}
              </button>
            ))}
          </div>
          {form.role === 'admin' && (
            <p className="text-xs text-amber-600 mt-1.5 bg-amber-50 px-3 py-1.5 rounded-lg">
              Admin has full access including creating/managing all users.
            </p>
          )}
        </div>

        {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-xl">{error}</p>}

        <button onClick={submit} disabled={saving}
          className="w-full py-3 bg-stone-800 hover:bg-stone-900 text-white font-bold
            rounded-xl transition-colors disabled:opacity-50 mt-2">
          {saving ? 'Creating…' : 'Create Account'}
        </button>
      </div>
    </Modal>
  );
}

// ── Assign Monitor modal ──────────────────────────────────────────────────────
function AssignModal({ member, monitors, onClose, onAssigned }) {
  const [monitorId, setMonitorId] = useState(member.monitor_id || '');
  const [saving,    setSaving]    = useState(false);

  const submit = async () => {
    if (!monitorId) return;
    setSaving(true);
    try {
      await api.post('/admin/assign', { monitor_id: monitorId, patient_id: member.id });
      onAssigned(member.id, monitorId, monitors.find(m => m.id == monitorId)?.name);
      onClose();
    } catch (e) {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Assign Monitor — ${member.name}`} onClose={onClose}>
      <div className="space-y-4">
        <select value={monitorId} onChange={e => setMonitorId(e.target.value)}
          className="w-full border border-stone-200 rounded-xl px-3 py-3 text-sm
            focus:outline-none focus:ring-2 focus:ring-emerald-300 bg-white text-stone-800">
          <option value="">— Unassigned —</option>
          {monitors.map(m => (
            <option key={m.id} value={m.id}>{m.name} · {m.role} · {m.patient_count} members</option>
          ))}
        </select>
        <button onClick={submit} disabled={saving || !monitorId}
          className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold
            rounded-xl disabled:opacity-50 transition-colors">
          {saving ? 'Saving…' : 'Confirm Assignment'}
        </button>
      </div>
    </Modal>
  );
}

// ── Main Admin Dashboard ──────────────────────────────────────────────────────
export default function AdminDashboard() {
  const navigate         = useNavigate();
  const { user, logout } = useAuthStore();
  const [tab,       setTab]       = useState('members');
  const [stats,     setStats]     = useState(null);
  const [members,   setMembers]   = useState([]);
  const [monitors,  setMonitors]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [showAddMember,  setShowAddMember]  = useState(false);
  const [showAddMonitor, setShowAddMonitor] = useState(false);
  const [assignTarget,   setAssignTarget]   = useState(null);
  const [editTarget,     setEditTarget]     = useState(null);
  const [search,    setSearch]    = useState('');

  const load = useCallback(async () => {
    try {
      const [s, m, mo] = await Promise.all([
        api.get('/admin/stats'),
        api.get('/admin/members'),
        api.get('/admin/monitors'),
      ]);
      setStats(s.data);
      setMembers(m.data);
      setMonitors(mo.data);
    } catch (e) {
      console.error('Admin load error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleUser = async (id, type) => {
    const url = `/admin/${type}s/${id}/toggle`;
    const { data } = await api.patch(url);
    if (type === 'member') {
      setMembers(prev => prev.map(m => m.id === id ? { ...m, active: data.active } : m));
    } else {
      setMonitors(prev => prev.map(m => m.id === id ? { ...m, active: data.active } : m));
    }
  };

  const filtered = (list, key) =>
    list.filter(x => x[key]?.toLowerCase().includes(search.toLowerCase()));

  if (loading) return <PageLoader />;

  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="min-h-screen bg-stone-100">

      {/* Header */}
      <div className="bg-gradient-to-br from-stone-800 to-stone-900 text-white px-4 pt-10 pb-6">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs font-bold tracking-widest uppercase text-stone-400 mb-0.5">FitLife Admin</p>
              <h1 className="text-xl font-bold">Welcome, {user?.name} 👑</h1>
              <p className="text-stone-400 text-xs mt-0.5">Full access — manage all members & monitors</p>
            </div>
            <button onClick={() => { logout(); }}
              className="text-xs text-stone-400 hover:text-white px-3 py-1.5 border border-stone-700
                hover:border-stone-500 rounded-xl transition-colors">
              Sign out
            </button>
          </div>

          {/* Stats */}
          {stats && (
            <div className="grid grid-cols-3 gap-3">
              <StatCard value={stats.members}   label="Members"    icon="👥" color="emerald" />
              <StatCard value={stats.monitors}  label="Monitors"   icon="🏋️" color="blue" />
              <StatCard value={stats.logsToday} label="Logs today" icon="📋" color="purple" />
            </div>
          )}
        </div>
      </div>

      {/* Tabs + search */}
      <div className="max-w-2xl mx-auto px-4 pt-4">
        <div className="flex gap-2 mb-3">
          {[
            { id: 'members',  label: '👥 Members'  },
            { id: 'monitors', label: '🏋️ Monitors' },
          ].map(t => (
            <button key={t.id} onClick={() => { setTab(t.id); setSearch(''); }}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                tab === t.id
                  ? 'bg-white text-stone-800 shadow-card'
                  : 'text-stone-500 hover:text-stone-700'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Search + add button */}
        <div className="flex gap-2 mb-4">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={`Search ${tab}…`}
            className="flex-1 px-3 py-2.5 bg-white border border-stone-200 rounded-xl text-sm
              focus:outline-none focus:ring-2 focus:ring-emerald-300 text-stone-800"
          />
          <button
            onClick={() => tab === 'members' ? setShowAddMember(true) : setShowAddMonitor(true)}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold
              rounded-xl transition-colors whitespace-nowrap">
            + Add {tab === 'members' ? 'Member' : 'Monitor'}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-4 pb-10 space-y-2">

        {/* ── Members tab ── */}
        {tab === 'members' && (
          <>
            {filtered(members, 'name').length === 0 ? (
              <div className="text-center py-16 text-stone-400">
                <div className="text-4xl mb-3">👥</div>
                <p className="font-medium">No members yet</p>
                <button onClick={() => setShowAddMember(true)}
                  className="mt-3 text-emerald-600 font-semibold text-sm">+ Add first member</button>
              </div>
            ) : (
              filtered(members, 'name').map(m => {
                const noLog = m.last_logged !== today;
                return (
                  <div key={m.id} className={`bg-white rounded-2xl p-4 shadow-card border
                    ${!m.active ? 'opacity-50 border-stone-200' : noLog ? 'border-amber-200' : 'border-stone-100'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-stone-800 truncate">{m.name}</h3>
                          {!m.active && <span className="text-xs bg-stone-100 text-stone-400 px-2 py-0.5 rounded-full">Inactive</span>}
                        </div>
                        <p className="text-xs text-stone-400 mt-0.5">📱 {m.phone}</p>
                        {m.monitor_name ? (
                          <p className="text-xs text-emerald-600 mt-0.5 font-medium">🏋️ {m.monitor_name}</p>
                        ) : (
                          <p className="text-xs text-amber-500 mt-0.5">⚠ Unassigned</p>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        {m.latest_weight && (
                          <div className="font-bold text-stone-700 text-sm">{m.latest_weight} kg</div>
                        )}
                        {m.last_compliance != null && (
                          <div className={`text-xs font-bold px-2 py-0.5 rounded-full mt-0.5 inline-block ${
                            m.last_compliance >= 75 ? 'bg-emerald-100 text-emerald-700' :
                            m.last_compliance >= 50 ? 'bg-amber-100 text-amber-700' :
                                                       'bg-red-100 text-red-700'
                          }`}>{m.last_compliance}%</div>
                        )}
                      </div>
                    </div>

                    {/* Row 2 — target + actions */}
                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-stone-50">
                      <div className="text-xs text-stone-400">
                        {m.start_weight && m.target_weight && (
                          <span>{m.start_weight} kg → {m.target_weight} kg goal</span>
                        )}
                        {noLog && m.active && (
                          <span className="text-amber-500 font-medium ml-2">· No log today</span>
                        )}
                      </div>
                      <div className="flex gap-1.5">
                        <button onClick={() => setAssignTarget(m)}
                          className="text-xs px-2.5 py-1.5 bg-emerald-50 text-emerald-700 font-semibold
                            rounded-lg hover:bg-emerald-100 transition-colors">
                          Assign
                        </button>
                        <button onClick={() => setEditTarget(m)}
                          className="text-xs px-2.5 py-1.5 bg-blue-50 text-blue-700 font-semibold
                            rounded-lg hover:bg-blue-100 transition-colors">
                          ✏️ Edit
                        </button>
                        <button onClick={() => navigate(`/monitor/${m.id}`)}
                          className="text-xs px-2.5 py-1.5 bg-stone-50 text-stone-600 font-semibold
                            rounded-lg hover:bg-stone-100 transition-colors">
                          View
                        </button>
                        <button onClick={() => toggleUser(m.id, 'member')}
                          className={`text-xs px-2.5 py-1.5 font-semibold rounded-lg transition-colors ${
                            m.active
                              ? 'bg-red-50 text-red-600 hover:bg-red-100'
                              : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                          }`}>
                          {m.active ? 'Disable' : 'Enable'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </>
        )}

        {/* ── Monitors tab ── */}
        {tab === 'monitors' && (
          <>
            {filtered(monitors, 'name').length === 0 ? (
              <div className="text-center py-16 text-stone-400">
                <div className="text-4xl mb-3">🏋️</div>
                <p className="font-medium">No monitors yet</p>
                <button onClick={() => setShowAddMonitor(true)}
                  className="mt-3 text-emerald-600 font-semibold text-sm">+ Add first monitor</button>
              </div>
            ) : (
              filtered(monitors, 'name').map(m => (
                <div key={m.id} className={`bg-white rounded-2xl p-4 shadow-card border
                  ${!m.active ? 'opacity-50 border-stone-200' : 'border-stone-100'}`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-stone-800">{m.name}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold capitalize ${
                          m.role === 'admin'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}>
                          {m.role === 'admin' ? '👑 admin' : '🏋️ monitor'}
                        </span>
                        {!m.active && <span className="text-xs bg-stone-100 text-stone-400 px-2 py-0.5 rounded-full">Inactive</span>}
                      </div>
                      <p className="text-xs text-stone-400 mt-0.5">✉ {m.email}</p>
                      <p className="text-xs text-emerald-600 mt-0.5 font-medium">
                        {m.patient_count} member{m.patient_count !== 1 ? 's' : ''} assigned
                      </p>
                    </div>
                    <div className="flex gap-1.5">
                      <button onClick={() => navigate('/monitor')}
                        className="text-xs px-2.5 py-1.5 bg-stone-50 text-stone-600 font-semibold
                          rounded-lg hover:bg-stone-100 transition-colors">
                        View
                      </button>
                      {m.id !== user?.id && (
                        <button onClick={() => toggleUser(m.id, 'monitor')}
                          className={`text-xs px-2.5 py-1.5 font-semibold rounded-lg transition-colors ${
                            m.active
                              ? 'bg-red-50 text-red-600 hover:bg-red-100'
                              : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                          }`}>
                          {m.active ? 'Disable' : 'Enable'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </div>

      {/* Modals */}
      {showAddMember  && <AddMemberModal  monitors={monitors} onClose={() => setShowAddMember(false)}  onAdded={u => { setMembers(prev => [u, ...prev]); load(); }} />}
      {showAddMonitor && <AddMonitorModal onClose={() => setShowAddMonitor(false)} onAdded={u => { setMonitors(prev => [u, ...prev]); load(); }} />}
      {assignTarget   && <AssignModal member={assignTarget} monitors={monitors}
        onClose={() => setAssignTarget(null)}
        onAssigned={(pid, mid, mname) => {
          setMembers(prev => prev.map(m => m.id === pid ? { ...m, monitor_id: mid, monitor_name: mname } : m));
          setAssignTarget(null);
        }} />}
      {editTarget && <EditMemberModal member={editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={updated => {
          setMembers(prev => prev.map(m => m.id === updated.id ? { ...m, ...updated } : m));
          setEditTarget(null);
        }} />}
    </div>
  );
}
