import { useState } from 'react';
import { logWeightForMember } from '../../api/logs';

/**
 * WeightEntryModal — the coach logs or corrects a member's weight for a date.
 *
 * Moved out of pages/Monitor.jsx on 10 Oct 2026 (CMP-010). It was written in
 * Sprint 11 but never mounted, so "⚖️ Log Weight" on the member page did
 * nothing. Monitor.jsx is held under a line budget (test-layout-contracts),
 * so the modal lives here and the page only mounts it.
 */
// ── Weight Entry modal (Sprint 11) ───────────────────────────────────────────
export default function WeightEntryModal({ memberId, memberName, onClose, onSaved }) {
  const todayStr = (() => { const now = new Date(); return new Date(now.getTime() + 5.5*60*60*1000).toISOString().split('T')[0]; })();
  const [date,    setDate]    = useState(todayStr);
  const [weight,  setWeight]  = useState('');
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState(false);

  const submit = async () => {
    const w = parseFloat(weight);
    if (!weight || isNaN(w) || w < 20 || w > 400) {
      setError('Enter a valid weight between 20–400 kg');
      return;
    }
    setSaving(true); setError('');
    try {
      const { data } = await logWeightForMember(memberId, date, w);
      setSuccess(true);
      setTimeout(() => { onSaved(data.log); onClose(); }, 1000);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to save weight');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center p-4">
      <div className="bg-surface rounded-3xl border border-white/[0.08] w-full max-w-sm p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-white">Log Weight</h3>
            <p className="text-xs text-lo mt-0.5">{memberName}</p>
          </div>
          <button onClick={onClose} className="text-lo hover:text-white text-xl">×</button>
        </div>

        {success ? (
          <div className="text-center py-4">
            <div className="text-3xl mb-2">✅</div>
            <p className="font-semibold text-gold">Weight saved!</p>
          </div>
        ) : (
          <>
            <p className="text-xs text-faint bg-blue-400/[0.08] border border-blue-400/15 rounded-xl px-3 py-2">
              Creates or updates the weight entry for the selected date. Other log data is preserved.
            </p>
            <div>
              <label className="block text-eyebrow text-lo font-semibold mb-1.5">Date</label>
              <input type="date" value={date} max={todayStr}
                onChange={e => setDate(e.target.value)}
                className="w-full border border-hair-med rounded-xl px-3 py-2.5 text-sm
                  focus:outline-none focus:ring-2 focus:ring-gold/[0.28]" />
            </div>
            <div>
              <label className="block text-eyebrow text-lo font-semibold mb-1.5">Weight (kg)</label>
              <div className="flex items-center gap-2">
                <input type="number" step="0.1" inputMode="decimal" value={weight}
                  onChange={e => setWeight(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && submit()}
                  placeholder="e.g. 84.5"
                  className="flex-1 text-2xl font-bold text-center border-2 border-hair-med
                    rounded-2xl py-3 focus:outline-none focus:ring-2 focus:ring-gold/[0.28] text-white" />
                <span className="text-lo font-bold text-lg">kg</span>
              </div>
            </div>
            {error && <p className="text-xs text-red-400 bg-red-400/[0.08] px-3 py-2 rounded-xl">{error}</p>}
            <button onClick={submit} disabled={saving || !weight}
              className="w-full py-3 bg-gold hover:bg-gold-deep text-charcoal font-bold
                rounded-xl transition-colors disabled:opacity-50">
              {saving ? 'Saving…' : 'Save Weight'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Coach page ──────────────────────────────────────────────────────────────
