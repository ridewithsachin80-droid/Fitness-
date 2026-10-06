import { useEffect, useState } from 'react';
import api from '../../api/client';
import { Eyebrow, Icon } from '../primitives';
import { haptic } from '../../store/settingsStore';
import CheckinSheet from './CheckinSheet';

/**
 * CheckinCard — on Today, Sunday and Monday, until this week's check-in is in.
 * A card, not a notification (one message a day).
 */
export default function CheckinCard() {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const load = () => api.get('/weekly/checkin').then(({ data }) => setData(data)).catch(() => setData(null));
  useEffect(() => { load(); }, []);
  if (!data?.open) return null;
  return (
    <>
      {!data.checkin && (
        <button type="button" onClick={() => { haptic(10); setOpen(true); }} data-testid="checkin-card"
          className="w-full text-left rounded-3xl border border-gold/30 bg-surface px-4 py-3 flex items-center gap-3 active:scale-[0.99] transition-transform">
          <span className="w-10 h-10 rounded-full bg-gold/10 text-gold flex items-center justify-center flex-shrink-0"><Icon name="chat" size={18} /></span>
          <span className="min-w-0 flex-1">
            <Eyebrow tone="gold">Weekly check-in</Eyebrow>
            <span className="block text-sm font-semibold text-white">How was your week?</span>
            <span className="block text-caption text-mid">Five taps for your coach: energy, hunger, sleep, stress, the plan.</span>
          </span>
          <Icon name="chevron-right" size={16} className="text-lo" />
        </button>
      )}
      <CheckinSheet open={open} onClose={() => setOpen(false)} data={data} onSaved={load} />
    </>
  );
}
