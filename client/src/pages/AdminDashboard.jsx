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

function EditMemberModal({ member, onClose, onSaved }) {
  const [form, setForm] = useState({
    name:          member.name          || '',
    phone:         member.phone         || '',
    pin:           '',
    confirmPin:    '',
    height_cm:     member.height_cm     || '',
    start_weight:  member.start_weight  || '',
    target_weight: member.target_weight || '',
  });

  // Protocol — null means "all items" (default). Array of IDs means only those are assigned.
  const [proto, setProto] = useState({
    activities:  member.protocol_activities  || null,
    acv:         member.protocol_acv         || null,
    supplements: member.protocol_supplements || null,
  });

  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const [showPin, setShowPin] = useState(false);
  const [tab, setTab] = useState('identity'); // 'identity' | 'protocol'

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Toggle an item in a protocol list
  const toggleProto = (key, id, allItems) => {
    setProto(p => {
      const current = p[key] || allItems.map(i => i.id); // if null, expand to all
      const next = current.includes(id)
        ? current.filter(x => x !== id)
        : [...current, id];
      // If all items selected, store null (means "all")
      return { ...p, [key]: next.length === allItems.length ? null : next };
    });
  };

  const submit = async () => {
    if (!form.name.trim() || !form.phone.trim()) {
      setError('Name and phone are required'); return;
    }
    if (form.pin && form.pin !== form.confirmPin) {
      setError('PINs do not match'); return;
    }
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
        custom_activities:  customItems.activities,
        custom_acv:         customItems.acv,
        custom_supplements: customItems.supplements,
      });
      onSaved(data);
      onClose();
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to save changes');
      setSaving(false);
    }
  };

  // Custom items added per member (beyond defaults)
  const [customItems, setCustomItems] = useState({
    activities:  member.custom_activities  || [],
    acv:         member.custom_acv         || [],
    supplements: member.custom_supplements || [],
  });
  const [adding, setAdding] = useState({ activities: false, acv: false, supplements: false });
  const [newLabel, setNewLabel] = useState({ activities: '', acv: '', supplements: '' });

  const addCustomItem = (key) => {
    const label = newLabel[key].trim();
    if (!label) return;
    const id = `custom_${Date.now()}`;
    const item = { id, label, sub: '', custom: true };
    setCustomItems(c => ({ ...c, [key]: [...c[key], item] }));
    // Auto-assign it
    setProto(p => {
      const allDefault = [...(key === 'activities' ? ACTIVITIES : key === 'acv' ? ACV_ITEMS : SUPPLEMENTS)];
      const current = p[key] || allDefault.map(i => i.id);
      return { ...p, [key]: [...current, id] };
    });
    setNewLabel(n => ({ ...n, [key]: '' }));
    setAdding(a => ({ ...a, [key]: false }));
  };

  const removeCustomItem = (key, id) => {
    setCustomItems(c => ({ ...c, [key]: c[key].filter(i => i.id !== id) }));
    setProto(p => ({ ...p, [key]: (p[key] || []).filter(x => x !== id) }));
  };

  const ProtocolSection = ({ label, icon, items, protoKey }) => {
    const allItems  = [...items, ...customItems[protoKey]];
    const assigned  = proto[protoKey] || items.map(i => i.id);
    const isAdding  = adding[protoKey];

    return (
      <div className="border border-stone-100 rounded-2xl p-3 space-y-2">
        <p className="text-xs font-bold tracking-widest uppercase text-stone-400">{icon} {label}</p>

        {/* Default items */}
        {allItems.map(item => (
          <label key={item.id} className="flex items-start gap-3 cursor-pointer group">
            <input type="checkbox"
              checked={assigned.includes(item.id)}
              onChange={() => toggleProto(protoKey, item.id, items)}
              className="mt-0.5 w-4 h-4 accent-emerald-600 flex-shrink-0"
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-stone-700">{item.icon ? `${item.icon} ` : ''}{item.label}</div>
              {item.sub && <div className="text-xs text-stone-400">{item.sub}</div>}
            </div>
            {item.custom && (
              <button onClick={() => removeCustomItem(protoKey, item.id)}
                className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 text-xs px-1 flex-shrink-0 transition-opacity">
                ✕
              </button>
            )}
          </label>
        ))}

        {/* Add custom item inline */}
        {isAdding ? (
          <div className="flex gap-2 mt-2">
            <input
              autoFocus
              type="text"
              value={newLabel[protoKey]}
              onChange={e => setNewLabel(n => ({ ...n, [protoKey]: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') addCustomItem(protoKey); if (e.key === 'Escape') setAdding(a => ({ ...a, [protoKey]: false })); }}
              placeholder="e.g. Evening Walk"
              className="flex-1 text-sm border border-emerald-300 rounded-lg px-2.5 py-1.5 outline-none focus:border-emerald-500"
            />
            <button onClick={() => addCustomItem(protoKey)}
              className="text-xs px-3 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold hover:bg-emerald-700">
              Add
            </button>
            <button onClick={() => setAdding(a => ({ ...a, [protoKey]: false }))}
              className="text-xs px-2 py-1.5 text-stone-400 hover:text-stone-600">
              Cancel
            </button>
          </div>
        ) : (
          <button onClick={() => setAdding(a => ({ ...a, [protoKey]: true }))}
            className="flex items-center gap-1.5 text-xs text-emerald-600 hover:text-emerald-800 font-semibold mt-1 px-1">
            <span className="text-base leading-none">+</span> Add custom item
          </button>
        )}
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
          <Field label="Full Name"         value={form.name}  onChange={v=>set('name',v)}  placeholder="Mrs. Padmini" required />
          <Field label="Phone (Login ID)"  type="tel" value={form.phone} onChange={v=>set('phone',v)} placeholder="9876543210" required />

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
          <p className="text-xs text-stone-400 bg-amber-50 px-3 py-2 rounded-xl">
            ✅ Checked = assigned to this member. Uncheck to remove from their daily log.
          </p>
          <ProtocolSection label="Physical Activities" icon="🏃" items={ACTIVITIES}  protoKey="activities"  />
          <ProtocolSection label="Apple Cider Vinegar"  icon="🍶" items={ACV_ITEMS}   protoKey="acv"         />
          <ProtocolSection label="Supplements"          icon="💊" items={SUPPLEMENTS} protoKey="supplements" />
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
