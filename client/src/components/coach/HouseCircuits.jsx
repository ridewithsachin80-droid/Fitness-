import { useEffect, useState } from 'react';
import api from '../../api/client';
import { Card, SectionTitle } from '../UI';
import { Eyebrow, Pressable, Icon, EmptyState, SkeletonText } from '../primitives';
import { haptic } from '../../store/settingsStore';

/**
 * HouseCircuits — the coach's own circuits (Sprint 11d).
 *
 * "Push", "Legs", "Core" … each with the exact exercises and sets × reps the
 * coach teaches. Once saved, saying "push day Monday, legs Friday" to the
 * coach AI assigns THESE, not five gym staples the model picked.
 *
 * Typed the way a coach writes them, one exercise per line:
 *     Bench press 4x8-12 chest
 *     Incline DB press 3 x 10
 *     Plank
 */
const EXAMPLE = 'Bench press 4x8-12 chest\nIncline DB press 3x10 chest\nOverhead press 3x8-10 shoulders\nCable fly 3x12-15';

function fmt(e) {
  const rx = e.sets ? ` ${e.sets}×${e.reps_min || '?'}${e.reps_max && e.reps_max !== e.reps_min ? '–' + e.reps_max : ''}` : '';
  return `${e.name}${rx}`;
}

export default function HouseCircuits() {
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null);      // { name, text } or null
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => api.get('/ai-chat/circuits').then(({ data }) => setList(Array.isArray(data?.circuits) ? data.circuits : [])).catch(() => setList([]));
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!editing?.name.trim()) { setError('Give the circuit a name — "Push", "Legs", "Core".'); return; }
    setBusy(true); setError('');
    try {
      await api.put(`/ai-chat/circuits/${encodeURIComponent(editing.name.trim())}`, { text: editing.text });
      setEditing(null); await load(); haptic(12);
    } catch (err) { setError(err.response?.data?.error || 'Could not save the circuit.'); }
    finally { setBusy(false); }
  };
  const remove = async (name) => {
    if (!window.confirm(`Delete "${name}"? The AI will build a generic ${name.toLowerCase()} day instead.`)) return;
    await api.delete(`/ai-chat/circuits/${encodeURIComponent(name)}`).catch(() => {});
    await load();
  };

  return (
    <Card>
      <SectionTitle icon="🏋️" tooltip="When you assign a split by name in the coach chat, the AI uses these exact exercises instead of inventing a generic day.">
        My circuits
      </SectionTitle>
      <p className="text-caption text-mid mb-3">
        Your own Push, Pull, Legs, Core… Say "push day Monday" in the chat and the AI assigns <em>these</em>, not a generic list.
      </p>

      {list === null && <SkeletonText lines={2} />}
      {list && list.length === 0 && !editing && (
        <EmptyState compact icon="dumbbell" title="No circuits yet" body="Add the days you teach, once. Every program you assign uses them." />
      )}
      {list && list.length > 0 && !editing && (
        <div className="space-y-2 mb-3" data-testid="circuit-list">
          {list.map(c => (
            <div key={c.id} className="rounded-xl bg-white/[0.03] border border-hair px-3 py-2.5" data-testid="circuit">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-white">{c.name}</span>
                <span className="flex gap-1">
                  <button type="button" onClick={() => { haptic(8); setEditing({ name: c.name, text: c.exercises.map(e => `${e.name}${e.sets ? ` ${e.sets}x${e.reps_min || ''}${e.reps_max && e.reps_max !== e.reps_min ? '-' + e.reps_max : ''}` : ''}${e.muscle_group ? ' ' + e.muscle_group : ''}`).join('\n') }); }}
                    style={{ minHeight: 32 }} className="text-caption font-bold text-gold px-2">Edit</button>
                  <button type="button" onClick={() => remove(c.name)} data-testid="circuit-delete" aria-label={`Delete ${c.name}`}
                    style={{ minHeight: 32 }} className="text-caption font-bold text-red-400 px-2">Delete</button>
                </span>
              </div>
              <p className="text-caption text-mid mt-0.5 leading-snug">{c.exercises.map(fmt).join(' · ')}</p>
            </div>
          ))}
        </div>
      )}

      {editing ? (
        <div data-testid="circuit-editor">
          <label className="block mb-2">
            <Eyebrow className="mb-1">Name</Eyebrow>
            <input value={editing.name} onChange={e => setEditing(ed => ({ ...ed, name: e.target.value }))} placeholder="Push" data-testid="circuit-name"
              style={{ minHeight: 44 }} className="w-full text-sm font-semibold rounded-xl px-3 border border-white/[0.12] focus:outline-none focus:ring-2 focus:ring-gold/30" />
          </label>
          <label className="block mb-2">
            <Eyebrow className="mb-1">Exercises · one per line · "name sets×reps muscle"</Eyebrow>
            <textarea value={editing.text} onChange={e => setEditing(ed => ({ ...ed, text: e.target.value }))} rows={6} placeholder={EXAMPLE} data-testid="circuit-text"
              className="w-full text-sm rounded-xl px-3 py-2.5 border border-white/[0.12] resize-none font-mono focus:outline-none focus:ring-2 focus:ring-gold/30" />
          </label>
          {error && <p className="text-caption text-red-400 mb-2" role="alert">{error}</p>}
          <div className="flex gap-2">
            <Pressable variant="primary" className="flex-1" onPress={save} disabled={busy} data-testid="circuit-save">{busy ? 'Saving…' : 'Save circuit'}</Pressable>
            <Pressable variant="secondary" onPress={() => { setEditing(null); setError(''); }}>Cancel</Pressable>
          </div>
        </div>
      ) : (
        <Pressable variant="secondary" className="w-full" onPress={() => { haptic(8); setEditing({ name: '', text: '' }); }} data-testid="circuit-add">
          <Icon name="plus" size={15} /> Add a circuit
        </Pressable>
      )}
    </Card>
  );
}
