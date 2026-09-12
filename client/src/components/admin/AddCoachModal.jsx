/**
 * components/admin/AddCoachModal.jsx — moved out of pages/AdminDashboard.jsx verbatim
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

// ── Add Coach modal ─────────────────────────────────────────────────────────
export function AddCoachModal({ onClose, onAdded }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'monitor' });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.name || !form.email || !form.password) { setError('All fields required'); return; }
    if (form.password.length < 8) { setError('Password must be at least 8 characters'); return; }
    setSaving(true); setError('');
    try {
      const { data } = await api.post('/admin/coaches', form);
      onAdded(data);
      onClose();
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to create coach');
      setSaving(false);
    }
  };

  return (
    <Modal title="Add Coach / Trainer" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Full Name" value={form.name} onChange={v=>set('name',v)} placeholder="Dr. Sachin" required />
        <Field label="Email" type="email" value={form.email} onChange={v=>set('email',v)} placeholder="trainer@fitlife.app" required />
        <Field label="Password" type="password" value={form.password} onChange={v=>set('password',v)} placeholder="Min 8 characters" required />

        <div>
          <label className="block text-note font-medium text-mute mb-1.5">Role</label>
          <div className="flex gap-2">
            {['monitor','admin'].map(r => (
              <button key={r} onClick={() => set('role', r)}
                /* The selected state used to carry `border` a second time and
                   TWO border colours — `border-white/[0.1]` and
                   `border-charcoal`. Tailwind emits one class per utility, so
                   which one won came down to stylesheet order rather than
                   intent. The unselected state was `bg-surface`: a solid white
                   pill on a charcoal modal. Selected is now the same gold wash
                   the admin tab strip uses, so "selected" reads the same way in
                   both places. */
                className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-all capitalize ${
                  form.role === r
                    ? 'bg-gold/[0.14] border-gold/30 text-gold-light'
                    : 'bg-surface text-mid border-white/[0.08] hover:border-white/[0.1]'
                }`}>
                {r === 'admin' ? 'Admin' : 'Coach'}
              </button>
            ))}
          </div>
          {form.role === 'admin' && (
            <p className="text-xs text-amber-300 mt-1.5 bg-amber-400/10 px-3 py-1.5 rounded-lg">
              Admin has full access including creating/managing all users.
            </p>
          )}
        </div>

        {error && <p className="text-xs text-red-400 bg-red-400/10 px-3 py-2 rounded-xl">{error}</p>}

        <button onClick={submit} disabled={saving}
          className="w-full py-3 bg-charcoal hover:bg-charcoal text-white font-bold
            rounded-xl transition-colors disabled:opacity-50 mt-2">
          {saving ? 'Creating…' : 'Create Account'}
        </button>
      </div>
    </Modal>
  );
}

// ── Assign Coach modal ──────────────────────────────────────────────────────

