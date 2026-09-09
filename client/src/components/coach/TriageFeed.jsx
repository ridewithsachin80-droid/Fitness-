import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { Icon, Eyebrow, SkeletonCard, EmptyState } from '../primitives';
import { haptic } from '../../store/settingsStore';
import { whatsappLink } from '../../utils/personalMessage';
import { firstName } from '../../utils/personName';

/**
 * TriageFeed — "Needs attention" (Sprint 8). The coach home's first screen.
 *
 *   Today · 12 members · 6 on track · 4 need attention · 2 high
 *
 *   ● Daya      No food log + Sleep down 1.4 h + 1 unread message   Reply ›
 *   ● Vishwas   Weight up 1.8 kg / 2 wk                             Review meals ›
 *   ○ Asha      8-day streak · Down 1.1 kg / 2 wk                   Send praise ›
 *
 * Every row is one member, one line, one action. The line is composed
 * server-side (GET /members/triage, services/triage.js) from the same gap
 * rules the morning digest uses plus two-week weight and sleep trends — so
 * this screen and the WhatsApp digest never disagree.
 *
 * Actions: message-type actions open WhatsApp with a short draft the coach
 * can edit before sending (nothing sends automatically); the others open the
 * member page.
 */
const TONE = {
  high:      { dot: 'bg-red-400',    text: 'text-red-400',    label: 'High' },
  attention: { dot: 'bg-amber-400',  text: 'text-amber-300',  label: 'Attention' },
  watch:     { dot: 'bg-gold',       text: 'text-gold-light', label: 'Watch' },
  ok:        { dot: 'bg-ok',         text: 'text-mid',        label: 'On track' },
};

export function draftFor(m) {
  const n = firstName(m.name);
  switch (m.action?.key) {
    case 'onboard': return `Hi ${n}, Sachin here 👋 Your FitLife app is ready. Open it and tell the AI about your day in one message — weight, food, walk — and it fills everything in. Want me to walk you through it?`;
    case 'nudge':   return m.days_since_log != null && m.days_since_log >= 3
      ? `Hi ${n}, haven't seen a log from you in ${m.days_since_log} days — everything okay? One message in the app covers the whole day. 💪`
      : `Hi ${n}, today's workout is still open — even 20 minutes counts. Log it when you're done 💪`;
    case 'praise':  return `${n}, ${m.wins?.[0] ? m.wins[0].toLowerCase() : 'great week'} — this is exactly how it's done. Keep going 🙌`;
    case 'checkin': return `Hi ${n}, quick check — ${m.reasons?.[0] ? m.reasons[0].toLowerCase() : 'how is today going'}? Tell the app what you've eaten and I'll take a look.`;
    default:        return `Hi ${n}, checking in — how are you feeling today?`;
  }
}

function Row({ m, onOpen, onMessage }) {
  const tone = TONE[m.priority] || TONE.ok;
  const line = m.reasons.length ? m.reasons.join(' + ') : (m.wins.length ? m.wins.join(' · ') : 'All quiet');
  const messageAction = ['nudge', 'praise', 'onboard', 'checkin'].includes(m.action?.key);
  return (
    <div className="py-3 border-b border-hair last:border-b-0" data-testid="triage-row" data-priority={m.priority}>
      <div className="flex items-center gap-3">
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${tone.dot}`} aria-hidden="true" />
        <button type="button" onClick={() => { haptic(8); onOpen(m); }} className="min-w-0 flex-1 text-left">
          <span className="block text-sm font-semibold text-white truncate">{m.name}</span>
        </button>
        <button type="button" onClick={() => { haptic(10); messageAction ? onMessage(m) : onOpen(m); }} data-testid="triage-action"
          style={{ minHeight: 36 }}
          className={`flex-shrink-0 text-caption font-bold whitespace-nowrap px-2 -mr-2 rounded-lg active:scale-95 transition-transform ${m.priority === 'ok' ? 'text-gold-deep' : 'text-gold'}`}>
          {m.action?.label} ›
        </button>
      </div>
      <button type="button" onClick={() => { haptic(8); onOpen(m); }} className="w-full text-left flex items-center gap-2 pl-[22px] mt-0.5">
        <span className="flex gap-0.5 flex-shrink-0" aria-label={`${m.logged_days} of 7 days logged`}>
          {m.week.map((on, i) => <span key={i} className={`w-1.5 h-1.5 rounded-full ${on ? 'bg-gold' : 'bg-white/[0.12]'}`} />)}
        </span>
        <span className={`text-caption leading-snug truncate ${m.reasons.length ? 'text-mid' : 'text-lo'}`} data-testid="triage-line">{line}</span>
      </button>
    </div>
  );
}

export default function TriageFeed({ onLoaded }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [showOk, setShowOk] = useState(false);

  useEffect(() => {
    api.get('/members/triage')
      .then(({ data }) => { setData(data); onLoaded?.(data); })
      .catch(() => setError('Could not work out who needs attention.'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <EmptyState compact icon="warning" title="Needs attention unavailable" body={error} />;
  if (!data) return <SkeletonCard lines={4} />;

  // Defensive: an unexpected payload must degrade to "nothing to show", never
  // blank the coach's whole home screen.
  const members = Array.isArray(data.members) ? data.members.map(m => ({ ...m, reasons: m.reasons || [], wins: m.wins || [], week: Array.isArray(m.week) ? m.week : [0,0,0,0,0,0,0] })) : [];
  const counts = { total: 0, on_track: 0, watch: 0, attention: 0, high: 0, ...(data.counts || {}) };
  const needs = members.filter(m => m.priority !== 'ok');
  const ok = members.filter(m => m.priority === 'ok');
  const open = (m) => navigate(`/coach/${m.id}`);
  const message = (m) => {
    if (!m.phone) return open(m);
    window.open(whatsappLink(m.phone, draftFor(m)), '_blank', 'noopener');
  };

  return (
    <section data-testid="triage" className="rounded-3xl border border-hair bg-surface px-4 pt-3 pb-1">
      <Eyebrow tone="gold">Needs attention</Eyebrow>
      <p className="text-caption text-mid mt-0.5" data-testid="triage-counts">
          <span className="text-white font-semibold tabular-nums">{counts.total}</span> members ·{' '}
          <span className="text-ok font-semibold tabular-nums">{counts.on_track}</span> on track ·{' '}
          <span className="text-amber-300 font-semibold tabular-nums">{counts.attention + counts.watch}</span> need attention
          {counts.high > 0 && <> · <span className="text-red-400 font-semibold tabular-nums">{counts.high}</span> high</>}
      </p>

      {needs.length === 0 ? (
        <EmptyState compact icon="check" title="Everyone is on track" body="No gaps, no silences, nothing slipping. Enjoy it." />
      ) : (
        <div className="mt-1">{needs.map(m => <Row key={m.id} m={m} onOpen={open} onMessage={message} />)}</div>
      )}

      {ok.length > 0 && (
        <button type="button" onClick={() => { haptic(8); setShowOk(v => !v); }} data-testid="triage-toggle-ok"
          style={{ minHeight: 40 }} className="w-full flex items-center justify-between text-caption font-semibold text-mid py-1">
          <span>{ok.length} on track{showOk ? '' : ' · tap to see'}</span>
          <Icon name={showOk ? 'chevron-up' : 'chevron-down'} size={14} />
        </button>
      )}
      {showOk && <div>{ok.map(m => <Row key={m.id} m={m} onOpen={open} onMessage={message} />)}</div>}
    </section>
  );
}
