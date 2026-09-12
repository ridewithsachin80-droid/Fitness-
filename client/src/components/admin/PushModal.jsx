/**
 * components/admin/PushModal.jsx — moved out of pages/AdminDashboard.jsx verbatim
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

// ── Push Notification modal (Sprint 11) ──────────────────────────────────────
export function PushModal({ members, onClose }) {
  const [form,    setForm]    = useState({ patient_id: '', title: '', body: '' });
  const [sending, setSending] = useState(false);
  const [result,  setResult]  = useState(null);
  const [error,   setError]   = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const send = async () => {
    if (!form.title.trim() || !form.body.trim()) { setError('Title and message are required'); return; }
    setSending(true); setError('');
    try {
      const payload = { title: form.title, body: form.body };
      if (form.patient_id) payload.patient_id = form.patient_id;
      const { data } = await adminSendPush(payload);
      setResult(data);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to send');
      setSending(false);
    }
  };

  return (
    <Modal title="Send Push Notification" onClose={onClose}>
      <div className="space-y-3">
        {result ? (
          <div className="text-center py-4 space-y-2">
            <div className="text-4xl">📨</div>
            <p className="font-bold text-white">Notification sent!</p>
            <p className="text-sm text-mid">
              Delivered to <span className="font-semibold text-gold-light">{result.sent}</span> {plural(result.sent, 'device')}
              {result.failed > 0 && `, ${result.failed} failed`}
            </p>
            <button onClick={onClose} className="mt-2 text-sm font-semibold text-mid hover:text-white">Close</button>
          </div>
        ) : (
          <>
            <div>
              <label className="block text-note font-medium text-mute mb-1.5">Recipient</label>
              <select value={form.patient_id} onChange={e => set('patient_id', e.target.value)}
                /* Fourth of the same four. */
                className="w-full border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm bg-surface
                  focus:outline-none focus:ring-2 focus:ring-gold/30 text-white">
                <option value="">📢 All active members ({members.filter(m => m.active).length})</option>
                {members.filter(m => m.active).map(m => (
                  <option key={m.id} value={m.id}>{m.name} · {m.phone}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-note font-medium text-mute mb-1.5">Title</label>
              <input value={form.title} onChange={e => set('title', e.target.value)}
                placeholder="e.g. Reminder: Log your weight today"
                className="w-full border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm
                  focus:outline-none focus:ring-2 focus:ring-gold/[0.28] text-white" />
            </div>

            <div>
              <label className="block text-note font-medium text-mute mb-1.5">Message</label>
              <textarea value={form.body} onChange={e => set('body', e.target.value)} rows={3}
                placeholder="e.g. Great work this week! Don't forget to log your morning weight."
                className="w-full border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm resize-none
                  focus:outline-none focus:ring-2 focus:ring-gold/[0.28] text-white" />
              <p className="text-xs text-mid mt-1">{form.body.length}/140 characters</p>
            </div>

            <div className="bg-amber-400/10 border border-amber-400/25 rounded-xl px-3 py-2">
              <p className="text-xs text-amber-300 font-medium">
                ⚠ Only members with push notifications enabled will receive this.
              </p>
            </div>

            {error && <p className="text-xs text-red-400 bg-red-400/10 px-3 py-2 rounded-xl">{error}</p>}

            <button onClick={send} disabled={sending || !form.title.trim() || !form.body.trim()}
              className="w-full py-3 bg-charcoal hover:bg-charcoal text-white font-bold
                rounded-xl transition-colors disabled:opacity-40">
              {sending ? 'Sending…' : `Send Notification`}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

// ── Add Coach modal ─────────────────────────────────────────────────────────

