import { Card } from '../UI';
import { Icon } from '../primitives';

/**
 * CoachNotes — unread messages from the coach, with in-app reply.
 *
 * Only UNREAD notes appear on Today; read ones live in the bell. Replies were
 * once impossible, so members answered on WhatsApp and the exchange left the
 * app along with any record of what was agreed. A failed reply keeps the draft
 * and says so — a silent failure would send the conversation to WhatsApp
 * anyway, which is the exact thing this exists to stop.
 *
 * Logic (sendReply, markNotesRead, reply state) lives in useTodayModel.
 */
export default function CoachNotes({ m }) {
  const { unreadNotes, markNotesRead, replyTo, setReplyTo, replyText, setReplyText, replyBusy, replyError, setReplyError, replied, sendReply } = m;
  if (!unreadNotes.length) return null;
  return (
    <Card>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-white">
          <Icon name="message" size={16} className="text-gold" />
          <span className="text-sm font-semibold">
            {unreadNotes.length > 1 ? `${unreadNotes.length} new messages` : 'Message from your coach'}
          </span>
        </div>
        {unreadNotes.length > 1 && (
          <button type="button" onClick={() => markNotesRead(unreadNotes.map(n => n.id))}
            className="text-caption font-bold text-gold" style={{ minHeight: 28 }}>Mark all read</button>
        )}
      </div>
      <div className="space-y-2">
        {unreadNotes.slice(0, 3).map(n => (
          <div key={n.id} data-testid="coach-note" className={`rounded-2xl px-4 py-3 border ${
            n.flagged ? 'bg-amber-500/[0.06] border-amber-500/20' : 'bg-white/[0.03] border-hair'}`}>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              {n.flagged && (
                <span className="text-eyebrow font-bold text-amber-300 bg-amber-400/10 border border-amber-400/25 px-2 py-0.5 rounded-full">Action needed</span>
              )}
              <span className="text-caption text-mid">
                {n.monitor_name} · {new Date(n.note_date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
              </span>
            </div>
            <p className="text-sm text-white leading-relaxed whitespace-pre-wrap">{n.note}</p>
            {replied[n.id] ? (
              <p className="mt-2 text-caption font-bold text-gold-light text-center">✓ Reply sent</p>
            ) : replyTo === n.id ? (
              <div className="mt-2">
                <textarea value={replyText} onChange={e => setReplyText(e.target.value)} rows={3} autoFocus
                  placeholder="Type your reply…" data-testid="reply-text"
                  className="w-full bg-charcoal border border-white/[0.12] rounded-xl p-2.5 text-body-sm text-white leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-gold/30" />
                <div className="flex gap-2 mt-1.5">
                  <button type="button" onClick={() => sendReply(n.id)} disabled={replyBusy || !replyText.trim()} style={{ minHeight: 40 }}
                    className="flex-1 text-caption font-bold text-charcoal rounded-xl bg-gold active:scale-[0.98] disabled:opacity-50">
                    {replyBusy ? 'Sending…' : 'Send reply'}
                  </button>
                  <button type="button" onClick={() => { setReplyTo(null); setReplyText(''); setReplyError(''); }} style={{ minHeight: 40 }}
                    className="px-3 text-caption font-bold text-mid border border-white/[0.10] rounded-xl">Cancel</button>
                </div>
                {replyError && <p className="text-caption text-red-400 mt-1.5 leading-relaxed" role="alert">{replyError}</p>}
              </div>
            ) : (
              <div className="flex gap-2 mt-2">
                <button type="button" onClick={() => { setReplyTo(n.id); setReplyText(''); }} style={{ minHeight: 36 }}
                  className="flex-1 text-caption font-bold text-gold bg-gold/[0.08] border border-gold/[0.28] rounded-xl active:scale-[0.98]">Reply</button>
                <button type="button" onClick={() => markNotesRead([n.id])} style={{ minHeight: 36 }}
                  className="flex-1 text-caption font-bold text-gold-light bg-gold/10 border border-gold/25 rounded-xl active:scale-[0.98] transition-transform">Got it ✓</button>
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="text-caption text-lo mt-2 text-center">Read messages stay in the bell at the top</p>
    </Card>
  );
}
