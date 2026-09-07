import { useState } from 'react';
import { Icon } from '../primitives';
import { haptic } from '../../store/settingsStore';

/**
 * NotesRow — free-form notes as one quiet row: "Add a note" until tapped,
 * open when the day already has a note. It used to be a full card with a
 * three-line textarea at the bottom of every day, empty for most members.
 */
export default function NotesRow({ value, onChange, placeholder, label }) {
  const [open, setOpen] = useState(!!value);
  if (!open) {
    return (
      <button type="button" onClick={() => { haptic(8); setOpen(true); }} data-testid="notes-row"
        style={{ minHeight: 44 }}
        className="w-full flex items-center gap-3 text-left text-sm text-mid px-1 rounded-xl active:bg-white/[0.04] transition-colors">
        <span className="w-8 h-8 rounded-full bg-white/[0.05] flex items-center justify-center text-lo"><Icon name="note" size={15} /></span>
        Add a note about today
      </button>
    );
  }
  return (
    <div data-testid="notes-open">
      <label className="block text-eyebrow font-semibold uppercase tracking-widest text-lo mb-2" htmlFor="notes">{label}</label>
      <textarea id="notes" value={value} onChange={e => onChange(e.target.value)} data-testid="notes" autoFocus={!value}
        placeholder={placeholder} rows={3}
        className="w-full text-sm border border-white/[0.12] rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-gold/30 resize-none" />
    </div>
  );
}
