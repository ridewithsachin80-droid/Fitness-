/**
 * components/admin/AdminAtoms.jsx — moved out of pages/AdminDashboard.jsx verbatim
 * (Sprint 12c). The dashboard was 2,163 lines, 1,400 of them modals that
 * closed over nothing on the page. Each is now a file with its own imports;
 * the page imports what it renders. Behaviour unchanged.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../api/client';
import { adminResetPin, adminSendPush, getAuditLog, adminDeleteMember, markMessagesRead } from '../../api/logs';
import { Card, SectionTitle } from '../UI';
import { ACTIVITIES, ACV_ITEMS, SUPPLEMENTS, RDA_TARGETS, RDA_OVERRIDE_KEYS, roleLabel, plural } from '../../constants';

// ── Stat card ─────────────────────────────────────────────────────────────────
export function StatCard({ value, label, icon, color }) {
  const colors = {
    emerald: 'bg-ok/10 text-gold-light',
    blue:    'bg-blue-400/10    text-blue-300',
    purple:  'bg-gold/10  text-amber-300',
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

// ── Modal wrapper ─────────────────────────────────────────────────────────────
export function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-surface rounded-3xl border border-white/[0.08] w-full max-w-sm max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-hair">
          <h3 className="font-bold text-white text-base">{title}</h3>
          <button onClick={onClose} className="text-mid hover:text-mid text-2xl leading-none">×</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ── Input helper ──────────────────────────────────────────────────────────────

// ── Input helper ──────────────────────────────────────────────────────────────
export function Field({ label, type = 'text', value, onChange, placeholder, required }) {
  return (
    <div>
      <label className="block text-note font-medium text-mute mb-1.5">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm
          focus:outline-none focus:ring-2 focus:ring-gold/[0.28] text-white"
      />
    </div>
  );
}

// ── Add Member modal ──────────────────────────────────────────────────────────
/**
 * The coaches a member may actually be assigned to.
 *
 * Disabled coaches were listed alongside active ones, so a member could be
 * handed to an account that cannot sign in — they would sit on someone's
 * roster with nobody reading it, and nothing on the members list would say
 * why they were never being chased.
 *
 * Duplicate display names get their email appended. Two accounts both reading
 * "Sachin (Admin)" are indistinguishable in a dropdown; the person choosing
 * has no way to pick the right one, and picking the wrong one is silent.
 */

export function assignableCoaches(coaches = []) {
  const live = (coaches || []).filter(c => c.active !== false);
  const seen = new Map();
  live.forEach(c => seen.set(c.name, (seen.get(c.name) || 0) + 1));
  return live.map(c => ({
    ...c,
    display: seen.get(c.name) > 1 && c.email ? `${c.name} · ${c.email}` : c.name,
  }));
}

