/**
 * components/admin/AddMemberModal.jsx — moved out of pages/AdminDashboard.jsx verbatim
 * (Sprint 12c). The dashboard was 2,163 lines, 1,400 of them modals that
 * closed over nothing on the page. Each is now a file with its own imports;
 * the page imports what it renders. Behaviour unchanged.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../api/client';
import { adminResetPin, adminSendPush, getAuditLog, adminDeleteMember, markMessagesRead } from '../../api/logs';
import { Card, SectionTitle } from '../UI';
import { ACTIVITIES, ACV_ITEMS, SUPPLEMENTS, RDA_TARGETS, RDA_OVERRIDE_KEYS, roleLabel, plural } from '../../constants';
import { StatCard, Modal, Field, assignableCoaches } from './AdminAtoms';

export function AddMemberModal({ coaches, onClose, onAdded }) {
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

        {/* Assign coach */}
        <div>
          <label className="block text-note font-medium text-mute mb-1.5">
            Assign to Coach
          </label>
          <select
            value={form.monitor_id}
            onChange={e => set('monitor_id', e.target.value)}
            /* Was `text-white bg-surface`. That reads as white on white and
               was not, only because index.css remaps `.bg-white` to #1A1C20 —
               a rule in another file, on a class named for the opposite
               colour. Now says what it means, matching the select styling in
               StrengthProgress and WorkoutLog. */
            className="w-full border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm
              focus:outline-none focus:ring-2 focus:ring-gold/30 bg-surface text-white"
          >
            <option value="">— Unassigned —</option>
            {assignableCoaches(coaches).map(m => (
              <option key={m.id} value={m.id}>{m.display} ({roleLabel(m.role)})</option>
            ))}
          </select>
        </div>

        {error && <p className="text-xs text-red-400 bg-red-400/10 px-3 py-2 rounded-xl">{error}</p>}

        <button onClick={submit} disabled={saving}
          className="w-full py-3 bg-gold hover:bg-gold-deep text-charcoal font-bold
            rounded-xl transition-colors disabled:opacity-50 mt-2">
          {saving ? 'Creating…' : 'Create Member'}
        </button>
      </div>
    </Modal>
  );
}

// ── MealPlanTab — top-level component so hooks are always stable ──────────────
// Must be OUTSIDE EditMemberModal. If defined inside, React error #310 fires
// because the tab is rendered conditionally — hook count changes between renders.

