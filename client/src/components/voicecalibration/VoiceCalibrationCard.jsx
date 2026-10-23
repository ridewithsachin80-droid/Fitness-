import { useEffect, useState } from 'react';
import api from '../../api/client';
import { Eyebrow, Icon } from '../primitives';
import { haptic } from '../../store/settingsStore';
import VoiceCalibrationSheet from './VoiceCalibrationSheet';

/**
 * VoiceCalibrationCard — Fixes-2x, on Today. Only on the TEST server, and only for a
 * volunteer an administrator invited to voice calibration round 1. Elsewhere the API
 * answers 404 and nothing is shown.
 */
export default function VoiceCalibrationCard() {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const load = () => api.get('/voice-calibration/me').then(({ data }) => setData(data)).catch(() => setData(null));
  useEffect(() => { load(); }, []);
  if (!data?.invited) return null;
  const slots = data.slots || [];
  const left = slots.filter(s => !s.takes).length;
  if (data.consented && left === 0) return <VoiceCalibrationSheet open={open} onClose={() => setOpen(false)} onChanged={load} />;
  return (
    <>
      <button type="button" onClick={() => { haptic(10); setOpen(true); }} data-testid="vc-card"
        className="w-full text-left rounded-3xl border border-gold/30 bg-surface px-4 py-3 flex items-center gap-3 active:scale-[0.99] transition-transform">
        <span className="w-10 h-10 rounded-full bg-gold/10 text-gold flex items-center justify-center flex-shrink-0"><Icon name="mic" size={18} /></span>
        <span className="min-w-0 flex-1">
          <Eyebrow tone="gold">Voice test · your coach asked</Eyebrow>
          <span className="block text-sm font-semibold text-white">Help tune voice logging{data.consented ? ` · ${left} of ${slots.length} left` : ''}</span>
          <span className="block text-caption text-mid">Short recordings in a quiet room and with everyday noise, about 30 minutes in all.</span>
        </span>
        <Icon name="chevron-right" size={16} className="text-lo" />
      </button>
      <VoiceCalibrationSheet open={open} onClose={() => setOpen(false)} onChanged={load} />
    </>
  );
}
