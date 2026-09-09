import { useEffect, useState } from 'react';
import api from '../../api/client';
import { Sheet, Segmented, Pressable, Eyebrow } from '../primitives';
import MessageMember from '../MessageMember';
import { useAuthStore } from '../../store/authStore';

/**
 * MemberActionSheet — Note · Message · Push in one place (Sprint 9b).
 *
 * The member page had three separate ways to reach a member: an Add Note
 * modal, a Message overlay (WhatsApp / SMS from the coach's own phone) and,
 * for admins, push from the dashboard. One sheet, one tab strip:
 *
 *   Note     — saved on the member's record (date, text, "action needed")
 *   Message  — MessageMember embedded: WhatsApp / SMS, copy kept as a note
 *   Push     — admin only: an in-app notification (POST /admin/push)
 *
 * `initialTab` lets the header buttons open straight to the right tab.
 */
const todayIST = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);

function NoteTab({ memberId, onAdded, onClose }) {
  const [form, setForm] = useState({ note_date: todayIST(), note: '', flagged: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const save = async () => {
    if (!form.note.trim()) return;
    setSaving(true); setError('');
    try {
      const { data } = await api.post(`/members/${memberId}/notes`, form);
      onAdded?.(data);
      setForm({ note_date: todayIST(), note: '', flagged: false });
      onClose?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save the note — check your connection and try again.');
    } finally { setSaving(false); }
  };
  return (
    <div data-testid="action-note">
      <label className="block mb-3">
        <Eyebrow className="mb-1">Date</Eyebrow>
        <input type="date" value={form.note_date} max={todayIST()} onChange={e => set('note_date', e.target.value)} data-testid="note-date"
          style={{ minHeight: 44 }} className="w-full text-sm font-semibold rounded-xl px-3 border border-white/[0.12] focus:outline-none focus:ring-2 focus:ring-gold/30" />
      </label>
      <label className="block mb-3">
        <Eyebrow className="mb-1">Note</Eyebrow>
        <textarea value={form.note} onChange={e => set('note', e.target.value)} rows={4} autoFocus data-testid="note-text"
          placeholder="What you noticed, what you asked them to change…"
          className="w-full text-sm rounded-xl px-3 py-2.5 border border-white/[0.12] resize-none focus:outline-none focus:ring-2 focus:ring-gold/30" />
      </label>
      <label className="flex items-center gap-2 mb-4 text-sm text-mid" style={{ minHeight: 40 }}>
        <input type="checkbox" checked={form.flagged} onChange={e => set('flagged', e.target.checked)} data-testid="note-flagged" className="accent-gold w-4 h-4" />
        Action needed — show it to the member as important
      </label>
      {error && <p className="text-caption text-red-400 mb-3" role="alert">{error}</p>}
      <Pressable variant="primary" className="w-full" onPress={save} disabled={saving || !form.note.trim()} data-testid="note-save">
        {saving ? 'Saving…' : 'Save note'}
      </Pressable>
    </div>
  );
}

function PushTab({ member, onClose }) {
  const [title, setTitle] = useState('FitLife');
  const [body, setBody] = useState(`Hi ${(member?.name || '').split(' ')[0]}, `);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [error, setError] = useState('');
  const send = async () => {
    setBusy(true); setError(''); setDone(null);
    try {
      const { data } = await api.post('/admin/push', { patient_id: member.id, title, body });
      setDone(data?.sent ?? data?.count ?? true);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not send the notification.');
    } finally { setBusy(false); }
  };
  return (
    <div data-testid="action-push">
      <label className="block mb-3">
        <Eyebrow className="mb-1">Title</Eyebrow>
        <input value={title} onChange={e => setTitle(e.target.value)} data-testid="push-title" style={{ minHeight: 44 }}
          className="w-full text-sm font-semibold rounded-xl px-3 border border-white/[0.12] focus:outline-none focus:ring-2 focus:ring-gold/30" />
      </label>
      <label className="block mb-3">
        <Eyebrow className="mb-1">Message</Eyebrow>
        <textarea value={body} onChange={e => setBody(e.target.value)} rows={3} data-testid="push-body"
          className="w-full text-sm rounded-xl px-3 py-2.5 border border-white/[0.12] resize-none focus:outline-none focus:ring-2 focus:ring-gold/30" />
      </label>
      <p className="text-caption text-lo mb-3">Arrives as a phone notification if they allowed notifications. For members who have stopped opening the app, use Message instead.</p>
      {error && <p className="text-caption text-red-400 mb-3" role="alert">{error}</p>}
      {done != null && <p className="text-caption text-gold-light mb-3" data-testid="push-done">Sent.</p>}
      <div className="flex gap-2">
        <Pressable variant="primary" className="flex-1" onPress={send} disabled={busy || !title.trim() || !body.trim()} data-testid="push-send">{busy ? 'Sending…' : 'Send push'}</Pressable>
        <Pressable variant="secondary" onPress={onClose}>Close</Pressable>
      </div>
    </div>
  );
}

export default function MemberActionSheet({ open, onClose, member, initialTab = 'note', onNoteAdded, onMessaged }) {
  const role = useAuthStore(s => s.user?.role);
  const [tab, setTab] = useState(initialTab);
  useEffect(() => { if (open) setTab(initialTab); }, [open, initialTab]);
  const options = [{ id: 'note', label: 'Note' }, { id: 'message', label: 'Message' }];
  if (role === 'admin') options.push({ id: 'push', label: 'Push' });
  const first = (member?.name || '').split(' ')[0];
  return (
    <Sheet open={open} onClose={onClose} eyebrow={first || 'Member'}
      title={tab === 'note' ? 'Add a note' : tab === 'message' ? 'Send a message' : 'Send a push'}>
      <Segmented name="member-action" value={tab} onChange={setTab} options={options} className="mb-4" />
      {tab === 'note' && <NoteTab memberId={member?.id} onAdded={onNoteAdded} onClose={onClose} />}
      {tab === 'message' && (
        <MessageMember embedded open member={member} onClose={onClose}
          onSent={async (channel) => { await onMessaged?.(channel); }} />
      )}
      {tab === 'push' && role === 'admin' && <PushTab member={member} onClose={onClose} />}
    </Sheet>
  );
}
