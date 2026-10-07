import { useEffect, useState } from 'react';
import api from '../../api/client';
import { Eyebrow, Icon } from '../primitives';
import { haptic } from '../../store/settingsStore';
import VoicePilotSheet from './VoicePilotSheet';

/** On Today, only for members the coach invited, until every line is recorded. */
export default function VoicePilotCard() {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const load = () => api.get('/voice-pilot/me').then(({ data }) => setData(data)).catch(() => setData(null));
  useEffect(() => { load(); }, []);
  if (!data?.invited) return null;
  const left = (data.phrases || []).filter(p => !p.recorded).length;
  return (
    <>
      {left > 0 && (
        <button type="button" onClick={() => { haptic(10); setOpen(true); }} data-testid="vp-card"
          className="w-full text-left rounded-3xl border border-gold/30 bg-surface px-4 py-3 flex items-center gap-3 active:scale-[0.99] transition-transform">
          <span className="w-10 h-10 rounded-full bg-gold/10 text-gold flex items-center justify-center flex-shrink-0"><Icon name="mic" size={18} /></span>
          <span className="min-w-0 flex-1">
            <Eyebrow tone="gold">Your coach asked</Eyebrow>
            <span className="block text-sm font-semibold text-white">Kannada voice test{data.consented ? ` · ${left} lines left` : ''}</span>
            <span className="block text-caption text-mid">Read out short lines so FitLife learns how you speak.</span>
          </span>
          <Icon name="chevron-right" size={16} className="text-lo" />
        </button>
      )}
      <VoicePilotSheet open={open} onClose={() => setOpen(false)} onChanged={load} />
    </>
  );
}
