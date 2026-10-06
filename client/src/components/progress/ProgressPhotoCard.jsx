import { useEffect, useState } from 'react';
import api from '../../api/client';
import { Eyebrow, Icon } from '../primitives';
import { haptic } from '../../store/settingsStore';
import ProgressPhotoSheet from './ProgressPhotoSheet';

/**
 * ProgressPhotoCard — on Today, on Sundays only, until this week's three
 * photos are in. No notification: Sachin's rule is one message a day, so
 * this is a card the member sees when they open the app.
 */
export const isSundayIST = (now = new Date()) =>
  new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'Asia/Kolkata' }).format(now) === 'Sun';

export default function ProgressPhotoCard({ now }) {
  const sunday = isSundayIST(now);
  const [count, setCount] = useState(null);
  const [open, setOpen] = useState(false);
  const refresh = () => api.get('/progress-photos/me')
    .then(({ data }) => setCount(Object.keys(data?.weeks?.find(w => w.week === data.week)?.photos || {}).length))
    .catch(() => setCount(null));
  useEffect(() => { if (sunday) refresh(); }, [sunday]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!sunday || count == null) return null;
  return (
    <>
      {count < 3 && (
        <button type="button" onClick={() => { haptic(10); setOpen(true); }} data-testid="pp-card"
          className="w-full text-left rounded-3xl border border-gold/30 bg-surface px-4 py-3 flex items-center gap-3 active:scale-[0.99] transition-transform">
          <span className="w-10 h-10 rounded-full bg-gold/10 text-gold flex items-center justify-center flex-shrink-0"><Icon name="camera" size={18} /></span>
          <span className="min-w-0 flex-1">
            <Eyebrow tone="gold">Sunday</Eyebrow>
            <span className="block text-sm font-semibold text-white">Progress photos{count ? ` · ${count} of 3 done` : ''}</span>
            <span className="block text-caption text-mid">Front, side, back. Two minutes, private to you and your coach.</span>
          </span>
          <Icon name="chevron-right" size={16} className="text-lo" />
        </button>
      )}
      <ProgressPhotoSheet open={open} onClose={() => setOpen(false)} onChanged={refresh} />
    </>
  );
}
