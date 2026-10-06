import { useEffect, useState } from 'react';
import { Sheet, Pressable, Icon } from '../primitives';
import api from '../../api/client';
import { haptic } from '../../store/settingsStore';
import { downscaleImage } from '../../utils/downscaleImage';
import PoseGuide from './PoseGuide';

/**
 * ProgressPhotoSheet — Phase 4: this week's front, side and back photos.
 *
 * One tile per pose. Empty: an outline of how to stand, and "Add". Taken: the
 * photo, with Retake and Delete. A retake replaces that pose for the week.
 * Camera or gallery, the member's choice (many use a timer app or a mirror).
 *
 * Privacy, said on screen: only the member and their coach see these; they
 * are deleted after 12 months. They never go to the AI.
 */
export const POSES = [
  { key: 'front', label: 'Front', how: 'Face the camera, arms a little away from your sides.' },
  { key: 'side',  label: 'Side',  how: 'Turn to your right, arms relaxed.' },
  { key: 'back',  label: 'Back',  how: 'Back to the camera, arms a little away.' },
];

export default function ProgressPhotoSheet({ open, onClose, onChanged }) {
  const [data, setData]   = useState(null);
  const [busy, setBusy]   = useState('');
  const [error, setError] = useState('');

  const load = () => api.get('/progress-photos/me').then(({ data }) => setData(data)).catch(() => setError('Could not load your photos.'));
  useEffect(() => { if (open) { setError(''); load(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const thisWeek = data?.weeks?.find(w => w.week === data.week)?.photos || {};

  const upload = async (pose, file) => {
    setBusy(pose); setError('');
    try {
      const image = await downscaleImage(file, 1600);
      await api.post('/progress-photos', { pose, image, mimeType: 'image/jpeg' }, { timeout: 90000 });
      haptic(30); await load(); onChanged?.();
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't save that photo. Check your connection and try again.");
    } finally { setBusy(''); }
  };
  const remove = async (pose, id) => {
    if (!window.confirm(`Delete this week's ${pose} photo?`)) return;
    setBusy(pose); setError('');
    try { await api.delete(`/progress-photos/${id}`); await load(); onChanged?.(); }
    catch (err) { setError(err.response?.data?.error || "Couldn't delete it just now."); }
    finally { setBusy(''); }
  };

  const done = POSES.filter(p => thisWeek[p.key]).length;

  return (
    <Sheet open={open} onClose={onClose} eyebrow="Progress photos" title={done === 3 ? 'This week: done' : `This week: ${done} of 3`}>
      <p className="text-caption text-mid mb-3">Same spot, same light, every Sunday. Only you and your coach see these, and they are deleted after 12 months.</p>
      {error && <p className="text-caption text-red-300 mb-2" data-testid="pp-error">{error}</p>}
      <div className="grid grid-cols-3 gap-2" data-testid="pp-tiles">
        {POSES.map(p => {
          const ph = thisWeek[p.key];
          return (
            <div key={p.key} className="rounded-2xl bg-charcoal border border-hair overflow-hidden flex flex-col" data-testid={`pp-tile-${p.key}`}>
              <div className="relative aspect-[3/5] flex items-center justify-center bg-white/[0.02]">
                {ph?.url
                  ? <img src={ph.url} alt={`${p.label} photo, this week`} className="w-full h-full object-cover" />
                  : <PoseGuide pose={p.key} className="w-3/4 h-3/4 text-white/25" />}
                {busy === p.key && <span className="absolute inset-0 bg-black/60 flex items-center justify-center text-caption text-white">Saving…</span>}
              </div>
              <div className="px-2 py-2 space-y-1.5">
                <p className="text-caption font-semibold text-white">{p.label}</p>
                <label className={`flex items-center justify-center gap-1 rounded-xl border text-caption font-semibold cursor-pointer ${ph ? 'border-white/[0.12] text-white' : 'border-gold text-gold'}`} style={{ minHeight: 40 }}>
                  <Icon name="camera" size={13} /> {ph ? 'Retake' : 'Add'}
                  <input type="file" accept="image/*" className="sr-only" disabled={!!busy} aria-label={`${ph ? 'Retake' : 'Add'} ${p.label.toLowerCase()} photo`}
                    onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(p.key, f); }} />
                </label>
                {ph && (
                  <button type="button" onClick={() => remove(p.label.toLowerCase(), ph.id)} disabled={!!busy} style={{ minHeight: 36 }}
                    className="w-full text-caption text-lo hover:text-red-300" data-testid={`pp-delete-${p.key}`}>Delete</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <ul className="mt-3 space-y-1">
        {POSES.map(p => <li key={p.key} className="text-caption text-lo"><span className="text-mid font-semibold">{p.label}:</span> {p.how}</li>)}
      </ul>
      <Pressable variant="secondary" className="w-full mt-3" onPress={onClose}>Close</Pressable>
    </Sheet>
  );
}
