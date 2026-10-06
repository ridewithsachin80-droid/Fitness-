import { useEffect, useState } from 'react';
import api from '../../api/client';
import { Eyebrow, Pressable } from '../primitives';
import { haptic } from '../../store/settingsStore';

/**
 * SwapsPanel — Phase 6, in the coach's Diet Plan Studio.
 *
 * The AI suggests alternatives for the foods in the member's plan; members ask
 * for others. Nothing is offered to the member until the coach approves it
 * here. Kept per member, by food, so the list survives a plan revision.
 * A swap keeps the calories: the member's app works out the grams.
 */
export default function SwapsPanel({ memberId, memberName = '' }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [add, setAdd] = useState({ food: '', alt: '' });
  const first = (memberName || '').split(' ')[0] || 'The member';

  const load = () => api.get(`/swaps/member/${memberId}`).then(({ data }) => setRows(data.swaps || [])).catch(() => setRows([]));
  useEffect(() => { load(); }, [memberId]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (key, fn) => {
    haptic(10); setBusy(key); setError('');
    try { const { data } = await fn(); if (data?.swaps) setRows(data.swaps); }
    catch (e) { setError(e.response?.data?.error || 'That did not work. Try again.'); }
    finally { setBusy(''); }
  };

  if (rows == null) return null;
  const requests = rows.filter(r => r.status === 'requested');
  const suggested = rows.filter(r => r.status === 'suggested');
  const approved = rows.filter(r => r.status === 'approved');
  const kcal = (r) => Math.round(Number(r.alt_per_100g?.calories) || 0);
  const decide = (r, approve) => act(`d${r.id}`, () => api.post(`/swaps/${r.id}/decide`, { approve }));
  const Row = (r, kind) => (
    <div key={r.id} className={`rounded-xl px-3 py-2 border ${kind === 'request' ? 'border-amber-400/40 bg-amber-400/[0.04]' : 'border-hair bg-white/[0.02]'}`} data-testid={`swap-${kind}`}>
      <p className="text-sm text-white leading-snug">
        <span className="text-mid">{r.food_name} →</span> {r.alt_name}
        <span className="text-caption text-mid"> · {kcal(r) ? `${kcal(r)} kcal/100 g` : 'no calories yet'}</span>
      </p>
      {kind === 'request' && <p className="text-caption text-amber-300">{first} asked{r.note ? `: "${r.note}"` : ''}</p>}
      <div className="flex gap-2 mt-1.5">
        <button type="button" disabled={!!busy || !kcal(r)} onClick={() => decide(r, true)} style={{ minHeight: 36 }}
          className="flex-1 rounded-lg border border-gold text-gold text-caption font-bold disabled:opacity-40" data-testid="swap-approve">Approve</button>
        <button type="button" disabled={!!busy} onClick={() => decide(r, false)} style={{ minHeight: 36 }}
          className="flex-1 rounded-lg border border-white/[0.12] text-white text-caption font-semibold" data-testid="swap-decline">Decline</button>
      </div>
    </div>
  );

  return (
    <div className="rounded-xl bg-white/[0.03] border border-hair px-3 py-3 space-y-3" data-testid="swaps-panel">
      <div className="flex items-baseline justify-between gap-2">
        <Eyebrow>Swaps{requests.length ? ` · ${requests.length} asked` : ''}</Eyebrow>
        <span className="text-caption text-mid">{approved.length} approved</span>
      </div>
      <p className="text-caption text-mid leading-snug">{first} can swap a planned food only for one you approve here. The portion keeps the same calories.</p>
      {error && <p className="text-caption text-red-300">{error}</p>}

      {requests.length > 0 && <div className="space-y-1.5">{requests.map(r => Row(r, 'request'))}</div>}

      <Pressable variant="secondary" className="w-full" disabled={!!busy} data-testid="swaps-suggest"
        onPress={() => act('suggest', () => api.post(`/swaps/member/${memberId}/suggest`, {}, { timeout: 90000 }))}>
        {busy === 'suggest' ? 'Asking the AI…' : suggested.length || approved.length ? 'Suggest more swaps (AI)' : 'Suggest swaps for this plan (AI)'}
      </Pressable>
      {suggested.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-caption text-lo">Suggested by the AI. Approve the ones you are happy with.</p>
          {suggested.map(r => Row(r, 'suggested'))}
        </div>
      )}

      {approved.length > 0 && (
        <div>
          <p className="text-caption text-lo mb-1">Approved</p>
          <div className="flex flex-wrap gap-1.5" data-testid="swaps-approved">
            {approved.map(r => (
              <span key={r.id} className="text-caption rounded-full border border-gold/40 pl-3 pr-1 py-0.5 text-white flex items-center gap-1">
                {r.food_name} → {r.alt_name}
                <button type="button" aria-label={`Remove ${r.alt_name} as a swap for ${r.food_name}`} onClick={() => decide(r, false)}
                  style={{ minWidth: 28, minHeight: 28 }} className="text-lo hover:text-white">×</button>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-1.5">
        <input value={add.food} onChange={e => setAdd(a => ({ ...a, food: e.target.value }))} placeholder="Food in plan" aria-label="Food in the plan" maxLength={100}
          className="flex-1 min-w-0 rounded-lg border border-white/[0.12] bg-transparent px-2 text-caption text-white" style={{ minHeight: 40 }} />
        <input value={add.alt} onChange={e => setAdd(a => ({ ...a, alt: e.target.value }))} placeholder="Swap for" aria-label="Swap it for" maxLength={100}
          className="flex-1 min-w-0 rounded-lg border border-white/[0.12] bg-transparent px-2 text-caption text-white" style={{ minHeight: 40 }} />
        <button type="button" disabled={!!busy || !add.food.trim() || !add.alt.trim()} style={{ minHeight: 40 }} data-testid="swaps-add"
          onClick={() => act('add', async () => { const r = await api.post(`/swaps/member/${memberId}`, { food_name: add.food.trim(), alt_name: add.alt.trim() }); setAdd({ food: '', alt: '' }); return r; })}
          className="rounded-lg border border-gold text-gold text-caption font-bold px-3 disabled:opacity-40">Add</button>
      </div>
    </div>
  );
}
