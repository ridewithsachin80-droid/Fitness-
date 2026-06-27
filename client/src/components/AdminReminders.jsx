import { useState, useEffect, useCallback } from 'react';
import api from '../api/client';

const TYPES = [
  { key: 'water',    label: '💧 Water',    desc: 'Hydration reminders' },
  { key: 'activity', label: '🏃 Activity', desc: 'Physical activity reminders' },
  { key: 'weight',   label: '⚖️ Weight',   desc: 'Morning weight log reminder' },
  { key: 'acv',      label: '🍎 ACV',      desc: 'Apple Cider Vinegar reminders' },
];

const DEFAULT_TIMES = {
  water:    [],
  activity: [],
  weight:   [],
  acv:      [],
};

export default function AdminReminders({ patients = [] }) {
  const [schedules, setSchedules]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [msg, setMsg]               = useState('');

  // Editor state
  const [editing, setEditing]       = useState(null); // { patient_id, type, times, max_retries, retry_interval_min }
  const [newTime, setNewTime]       = useState('');

  // Devices panel state — lazy-loaded per patient when expanded
  const [openDevicesFor, setOpenDevicesFor] = useState(null);
  const [devices, setDevices]               = useState({}); // { [patientId]: [...subs] }
  const [devicesLoading, setDevicesLoading] = useState(false);

  async function toggleDevices(patientId) {
    if (openDevicesFor === patientId) { setOpenDevicesFor(null); return; }
    setOpenDevicesFor(patientId);
    if (!devices[patientId]) {
      setDevicesLoading(true);
      try {
        const { data } = await api.get(`/reminders/subscriptions/${patientId}`);
        setDevices(d => ({ ...d, [patientId]: data }));
      } catch {
        setDevices(d => ({ ...d, [patientId]: [] }));
      } finally {
        setDevicesLoading(false);
      }
    }
  }

  async function removeDevice(patientId, subId) {
    if (!confirm('Remove this device? It will stop receiving reminders.')) return;
    try {
      await api.delete(`/reminders/subscriptions/${subId}`);
      setDevices(d => ({ ...d, [patientId]: d[patientId].filter(s => s.id !== subId) }));
    } catch {
      setMsg('Failed to remove device');
    }
  }

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/reminders/schedules');
      setSchedules(data);
    } catch (e) {
      setMsg('Failed to load schedules');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function startEdit(patientId, type) {
    const existing = schedules.find(
      s => s.patient_id == patientId && s.type === type
    );
    setEditing({
      id:                existing?.id,
      patient_id:        patientId,
      type,
      times:             existing?.times || DEFAULT_TIMES[type],
      max_retries:       existing?.max_retries ?? 3,
      retry_interval_min: existing?.retry_interval_min ?? 5,
    });
    setNewTime('');
  }

  function addTime() {
    if (!newTime || editing.times.includes(newTime)) return;
    setEditing(e => ({ ...e, times: [...e.times, newTime].sort() }));
    setNewTime('');
  }

  function removeTime(t) {
    setEditing(e => ({ ...e, times: e.times.filter(x => x !== t) }));
  }

  async function save() {
    if (!editing.times.length) return setMsg('Add at least one time');
    setSaving(true);
    try {
      await api.post('/reminders/schedules', editing);
      setMsg('✅ Saved!');
      setEditing(null);
      load();
    } catch (e) {
      setMsg('Failed to save');
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(''), 3000);
    }
  }

  async function deleteSchedule(id) {
    if (!confirm('Delete this reminder schedule?')) return;
    await api.delete(`/reminders/schedules/${id}`);
    load();
  }

  async function sendTest(patientId, type) {
    try {
      const { data } = await api.post('/reminders/test', { patient_id: patientId, type });
      if (!data.deviceCount) {
        setMsg(`⚠️ No active devices found for this patient — they won't receive anything until they open the app and allow notifications.`);
      } else {
        setMsg(`✅ Sent to ${data.deviceCount} device${data.deviceCount > 1 ? 's' : ''}: ${data.devices.filter(Boolean).join(', ') || 'unnamed device'}`);
      }
      setTimeout(() => setMsg(''), 6000);
    } catch {
      setMsg('Failed to send test');
    }
  }

  // Group existing schedules by patient
  const globalSchedules  = schedules.filter(s => !s.patient_id);
  const patientSchedules = schedules.filter(s =>  s.patient_id);

  const cardStyle = {
    background: '#1a1a2e', border: '1px solid #2a2a3e',
    borderRadius: 12, padding: 16, marginBottom: 12,
  };

  const btnStyle = (color = '#7c5cfc') => ({
    background: color, color: '#08052a', border: 'none',
    borderRadius: 8, padding: '6px 14px', cursor: 'pointer',
    fontSize: 13, fontWeight: 700,
  });

  if (loading) return <div style={{ color: '#aaa', padding: 24 }}>Loading...</div>;

  return (
    <div style={{ color: '#e0e0e0', maxWidth: 700 }}>
      <h2 style={{ color: '#c4b5fd', fontFamily: 'Fraunces, serif', fontWeight: 600, fontSize: 20, marginBottom: 4 }}>🔔 Reminder Schedules</h2>
      <p style={{ color: '#888', fontSize: 13, marginBottom: 20 }}>
        Set custom times for water and activity reminders. Repeats every {editing?.retry_interval_min ?? 5} min until client taps OK.
      </p>

      {msg && (
        <div style={{ background: '#1e3a2e', border: '1px solid rgba(124,92,252,0.35)', borderRadius: 8,
          padding: '10px 16px', marginBottom: 16, color: '#c4b5fd', fontSize: 14 }}>
          {msg}
        </div>
      )}

      {/* ── Editor Modal ── */}
      {editing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#12122a', borderRadius: 16, padding: 24,
            width: 360, border: '1px solid rgba(124,92,252,0.35)' }}>
            <h3 style={{ color: '#c4b5fd', fontFamily: 'Fraunces, serif', fontWeight: 600, margin: '0 0 4px' }}>
              {editing.type === 'water' ? '💧 Water' : '🏃 Activity'} Reminders
            </h3>
            <p style={{ color: '#888', fontSize: 12, margin: '0 0 16px' }}>
              {editing.patient_id
                ? `For: ${patients.find(p => p.id == editing.patient_id)?.name || 'Patient'}`
                : 'Global — applies to all patients'}
            </p>

            {/* Times list */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: '#aaa', marginBottom: 6 }}>Reminder Times (IST)</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                {editing.times.map(t => (
                  <div key={t} style={{ background: 'rgba(124,92,252,0.13)', border: '1px solid #7c5cfc',
                    borderRadius: 20, padding: '4px 12px', fontSize: 13,
                    display: 'flex', alignItems: 'center', gap: 6 }}>
                    {t}
                    <span onClick={() => removeTime(t)}
                      style={{ cursor: 'pointer', color: '#f87171', fontWeight: 700 }}>×</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="time" value={newTime}
                  onChange={e => setNewTime(e.target.value)}
                  style={{ background: '#1a1a2e', border: '1px solid #3a3a5e',
                    borderRadius: 8, padding: '6px 10px', color: '#e0e0e0', flex: 1 }} />
                <button onClick={addTime} style={btnStyle()}>+ Add</button>
              </div>
            </div>

            {/* Retry settings */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: '#aaa', marginBottom: 4 }}>Max Retries</div>
                <input type="number" min={1} max={10} value={editing.max_retries}
                  onChange={e => setEditing(ed => ({ ...ed, max_retries: +e.target.value }))}
                  style={{ background: '#1a1a2e', border: '1px solid #3a3a5e',
                    borderRadius: 8, padding: '6px 10px', color: '#e0e0e0', width: '100%' }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: '#aaa', marginBottom: 4 }}>Retry Every (min)</div>
                <input type="number" min={1} max={60} value={editing.retry_interval_min}
                  onChange={e => setEditing(ed => ({ ...ed, retry_interval_min: +e.target.value }))}
                  style={{ background: '#1a1a2e', border: '1px solid #3a3a5e',
                    borderRadius: 8, padding: '6px 10px', color: '#e0e0e0', width: '100%' }} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={save} disabled={saving} style={btnStyle('#7c5cfc')}>
                {saving ? 'Saving...' : '✅ Save Schedule'}
              </button>
              <button onClick={() => setEditing(null)} style={btnStyle('#444')}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Global Schedules ── */}
      <div style={cardStyle}>
        <div style={{ fontWeight: 700, marginBottom: 12, color: '#fff' }}>
          🌐 Global Reminders <span style={{ fontSize: 12, color: '#888' }}>(all patients)</span>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {TYPES.map(t => {
            const s = globalSchedules.find(x => x.type === t.key);
            return (
              <div key={t.key} style={{ flex: 1, background: '#0d0d1a',
                borderRadius: 10, padding: 12, border: '1px solid #2a2a3e' }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{t.label}</div>
                {s ? (
                  <>
                    <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>
                      {s.times.join(' · ')}
                    </div>
                    <div style={{ fontSize: 11, color: '#666', marginBottom: 8 }}>
                      Retry {s.retry_interval_min}min × {s.max_retries}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => startEdit(null, t.key)} style={btnStyle()}>Edit</button>
                      <button onClick={() => deleteSchedule(s.id)} style={btnStyle('#dc2626')}>Del</button>
                    </div>
                  </>
                ) : (
                  <button onClick={() => startEdit(null, t.key)} style={btnStyle()}>
                    + Set Times
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Per-Patient Schedules ── */}
      <div style={{ fontWeight: 700, marginBottom: 10, color: '#fff' }}>
        👤 Per-Patient Overrides
      </div>
      {patients.map(patient => {
        const pSchedules = patientSchedules.filter(s => s.patient_id == patient.id);
        return (
          <div key={patient.id} style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between',
              alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontWeight: 600 }}>{patient.name}</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => toggleDevices(patient.id)}
                  style={{ ...btnStyle(openDevicesFor === patient.id ? '#7c5cfc' : '#374151'), fontSize: 11 }}>
                  📱 Devices{devices[patient.id] ? ` (${devices[patient.id].length})` : ''}
                </button>
                <button onClick={() => sendTest(patient.id, 'water')}
                  style={{ ...btnStyle('#0369a1'), fontSize: 11 }}>
                  💧 Test
                </button>
                <button onClick={() => sendTest(patient.id, 'activity')}
                  style={{ ...btnStyle('#065f46'), fontSize: 11 }}>
                  🏃 Test
                </button>
              </div>
            </div>

            {/* Devices panel — diagnoses "patient didn't get the reminder" by
                showing exactly which device(s) are registered for this account. */}
            {openDevicesFor === patient.id && (
              <div style={{ background: '#0d0d1a', border: '1px solid #2a2a3e', borderRadius: 10, padding: 10, marginBottom: 10 }}>
                {devicesLoading ? (
                  <div style={{ fontSize: 12, color: '#888' }}>Loading…</div>
                ) : !devices[patient.id]?.length ? (
                  <div style={{ fontSize: 12, color: '#f59e0b' }}>
                    ⚠️ No devices registered. This patient won't receive any reminders until they
                    open the app on their own phone and allow notifications when prompted.
                  </div>
                ) : (
                  devices[patient.id].map(sub => (
                    <div key={sub.id} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '6px 0', borderBottom: '1px solid #1f1f2e', fontSize: 12,
                    }}>
                      <div>
                        <div style={{ color: sub.active ? '#d8d8de' : '#666' }}>
                          {sub.device_name || 'Unknown device'} {!sub.active && '(inactive)'}
                        </div>
                        <div style={{ color: '#666', fontSize: 10 }}>
                          Registered {new Date(sub.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </div>
                      </div>
                      <button onClick={() => removeDevice(patient.id, sub.id)}
                        style={{ ...btnStyle('#dc2626'), fontSize: 10, padding: '4px 10px' }}>
                        Remove
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              {TYPES.map(t => {
                const s = pSchedules.find(x => x.type === t.key);
                return (
                  <div key={t.key} style={{ flex: 1, background: '#0d0d1a',
                    borderRadius: 10, padding: 10, border: '1px solid #2a2a3e' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{t.label}</div>
                    {s ? (
                      <>
                        <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>
                          {s.times.join(' · ')}
                        </div>
                        <div style={{ fontSize: 10, color: '#666', marginBottom: 6 }}>
                          Retry {s.retry_interval_min}min × {s.max_retries}
                        </div>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button onClick={() => startEdit(patient.id, t.key)} style={{ ...btnStyle(), fontSize: 11 }}>Edit</button>
                          <button onClick={() => deleteSchedule(s.id)} style={{ ...btnStyle('#dc2626'), fontSize: 11 }}>Del</button>
                        </div>
                      </>
                    ) : (
                      <button onClick={() => startEdit(patient.id, t.key)}
                        style={{ ...btnStyle('#374151'), fontSize: 11 }}>
                        + Override
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
