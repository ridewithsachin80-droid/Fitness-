import { useEffect, useState } from 'react';
import { Sheet, Pressable } from '../primitives';
import api from '../../api/client';
import { haptic } from '../../store/settingsStore';

/**
 * CheckinSheet — Phase 7: the member's weekly check-in. Five taps (1 to 5)
 * and an optional note for the coach. Open on Sunday and Monday; answering
 * again the same week replaces the earlier answers.
 */
export default function CheckinSheet({ open, onClose, data, onSaved }) {
  const [answers, setAnswers] = useState({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    setAnswers(data?.checkin?.answers || {}); setNote(data?.checkin?.note || ''); setError('');
  }, [open, data]);

  const questions = data?.questions || [];
  const done = questions.every(q => answers[q.key]);
  const save = async () => {
    if (!done) return;
    setBusy(true); setError('');
    try { await api.post('/weekly/checkin', { answers, note }); haptic(30); onSaved?.(); onClose(); }
    catch (e) { setError(e.response?.data?.error || 'Could not save. Try again.'); }
    finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onClose={onClose} eyebrow="Weekly check-in" title="How was your week?"
      footer={<Pressable variant="primary" className="w-full" disabled={!done || busy} onPress={save} data-testid="checkin-save">
        {busy ? 'Saving…' : done ? 'Send to my coach' : `${questions.filter(q => answers[q.key]).length} of ${questions.length} answered`}
      </Pressable>}>
      <p className="text-caption text-mid mb-3">Thirty seconds. Your coach reads this with your week's numbers.</p>
      <div className="space-y-3" data-testid="checkin-questions">
        {questions.map(q => (
          <div key={q.key} role="radiogroup" aria-label={q.label}>
            <div className="flex justify-between items-baseline mb-1">
              <span className="text-sm font-semibold text-white">{q.label}</span>
              <span className="text-caption text-lo">1 {q.low} · 5 {q.high}</span>
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} type="button" role="radio" aria-checked={answers[q.key] === n} aria-label={`${q.label} ${n} of 5`}
                  onClick={() => { haptic(8); setAnswers(a => ({ ...a, [q.key]: n })); }} style={{ minHeight: 44 }}
                  className={`rounded-xl text-sm font-bold border ${answers[q.key] === n ? 'bg-gold text-charcoal border-gold' : 'border-white/[0.12] text-white'}`}>{n}</button>
              ))}
            </div>
          </div>
        ))}
        <label className="block">
          <span className="text-sm font-semibold text-white">Anything to tell your coach? <span className="text-lo font-normal">(optional)</span></span>
          <textarea value={note} onChange={e => setNote(e.target.value)} maxLength={600} rows={3} data-testid="checkin-note"
            placeholder="A wedding this week, knee is sore, travelling…"
            className="mt-1 w-full rounded-xl border border-white/[0.12] bg-transparent p-3 text-sm text-white" />
        </label>
        {error && <p className="text-caption text-red-300">{error}</p>}
      </div>
    </Sheet>
  );
}
