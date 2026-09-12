/**
 * components/admin/DeleteMemberModal.jsx — moved out of pages/AdminDashboard.jsx verbatim
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

export function DeleteMemberModal({ member, onClose, onDeleted }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState(null);
  const matches = typed.trim() === String(member.name).trim();

  const go = async () => {
    if (!matches || busy) return;
    setBusy(true); setErr(null);
    try {
      await adminDeleteMember(member.id, typed.trim());
      onDeleted(member.id);
    } catch (e) {
      setErr(e?.response?.data?.error || 'Could not delete that member.');
      setBusy(false);
    }
  };

  return (
    <Modal title="Delete member" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-white">
          This permanently deletes <span className="font-bold">{member.name}</span> and every
          log, weight, lab result, workout and message belonging to them.
        </p>
        <p className="text-xs text-mid">
          There is no undo. If you only want to stop them using the app, close this and
          choose “Disable” instead — that keeps their history and can be reversed.
        </p>
        <div>
          <label className="block text-note font-medium text-mute mb-1.5">
            Type “{member.name}” to confirm
          </label>
          <input value={typed} onChange={e => setTyped(e.target.value)}
            placeholder={member.name}
            className="w-full border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm
              bg-surface text-white placeholder-lo
              focus:outline-none focus:ring-2 focus:ring-gold/30" />
        </div>
        {err && (
          <p className="text-xs text-red-300 bg-red-400/10 border border-red-400/25
            rounded-xl px-3 py-2">{err}</p>
        )}
        <div className="flex gap-2 pt-1">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-surface
              border border-white/[0.08] text-mid">
            Cancel
          </button>
          <button onClick={go} disabled={!matches || busy}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-red-500/90 text-charcoal
              disabled:opacity-40 disabled:cursor-not-allowed">
            {busy ? 'Deleting…' : 'Delete permanently'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

