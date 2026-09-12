/**
 * components/admin/AssignModal.jsx — moved out of pages/AdminDashboard.jsx verbatim
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

// ── Assign Coach modal ──────────────────────────────────────────────────────
export function AssignModal({ member, coaches, onClose, onAssigned }) {
  const [coachId, setCoachId] = useState(member.monitor_id || '');
  const [saving,    setSaving]    = useState(false);

  const submit = async () => {
    if (!coachId) return;
    setSaving(true);
    try {
      await api.post('/admin/assign', { monitor_id: coachId, patient_id: member.id });
      onAssigned(member.id, coachId, coaches.find(m => m.id == coachId)?.name);
      onClose();
    } catch (e) {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Assign Coach — ${member.name}`} onClose={onClose}>
      <div className="space-y-4">
        <select value={coachId} onChange={e => setCoachId(e.target.value)}
          /* Same borrowed `.bg-white` remap as the select above. */
          className="w-full border border-white/[0.08] rounded-xl px-3 py-3 text-sm
            focus:outline-none focus:ring-2 focus:ring-gold/30 bg-surface text-white">
          <option value="">— Unassigned —</option>
          {assignableCoaches(coaches).map(m => (
            <option key={m.id} value={m.id}>{m.display} · {roleLabel(m.role)} · {m.patient_count} members</option>
          ))}
        </select>
        <button onClick={submit} disabled={saving || !coachId}
          className="w-full py-3 bg-gold hover:bg-gold-deep text-charcoal font-bold
            rounded-xl disabled:opacity-50 transition-colors">
          {saving ? 'Saving…' : 'Confirm Assignment'}
        </button>
      </div>
    </Modal>
  );
}

// ── Main Admin Dashboard ──────────────────────────────────────────────────────

/**
 * Typed confirmation for deleting a member.
 *
 * The server checks the same thing, so this dialog is not the security
 * boundary — it is there so the destructive path FEELS different from every
 * other button in the menu. Everything else in the app is one tap; this asks
 * you to write the person's name.
 */

