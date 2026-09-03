import { useEffect, useState, useCallback } from 'react';
import { Card, SectionTitle } from './UI';
import { getMorningNudges, markMorningNudgeSent } from '../api/logs';
import { openWhatsApp, waNumber } from '../utils/personalMessage';

/**
 * MorningNudges — send today's 06:30 message by hand, over WhatsApp.
 *
 * WHY THIS EXISTS
 * ---------------
 * The automatic morning nudge is built and scheduled, but a business-initiated
 * WhatsApp message has to match a template Meta approved in advance, and that
 * approval is weeks out behind business verification. Rather than have the
 * coach wait, this hands them the same message, composed by the same code, as
 * a one-tap wa.me link sent from their own WhatsApp.
 *
 * That send is a normal personal message, so it needs no template, costs
 * nothing, and reaches the member wherever they already read things.
 *
 * The message text comes from the server, NOT from a copy of the builder in
 * here. If the two ever disagreed, the manual and automatic messages would say
 * different things to the same member on different days — and this codebase
 * already has one scar from weekday logic living in three places with two
 * answers.
 *
 * Marking a member as sent writes the same notifications_log row the automatic
 * send would have, so the 06:30 cron will not deliver a second copy, and the
 * nudge-effectiveness dashboard counts these alongside automatic sends.
 */
export default function MorningNudges() {
  const [rows,    setRows]    = useState(null);
  const [busyId,  setBusyId]  = useState(null);
  const [error,   setError]   = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data } = await getMorningNudges();
      setRows(data.members || []);
    } catch (err) {
      setError("Couldn't load today's messages.");
      setRows([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const send = async (m) => {
    setBusyId(m.id);
    const opened = openWhatsApp(m.phone, m.message);
    if (!opened) {
      setError(`${m.name}'s number isn't usable for WhatsApp.`);
      setBusyId(null);
      return;
    }
    // Marked optimistically, on opening the link rather than on delivery —
    // the browser cannot see whether the coach actually pressed send in
    // WhatsApp. Marking it is the safer error: a member who slips through
    // misses one nudge, whereas an unmarked one gets a duplicate at 06:30.
    // "Undo" puts it back if the coach changes their mind.
    try {
      await markMorningNudgeSent(m.id, m.message);
      setRows(rs => rs.map(r => (r.id === m.id ? { ...r, already_sent: true } : r)));
    } catch {
      setError('Sent, but it could not be recorded — check before 06:30 so it is not sent twice.');
    }
    setBusyId(null);
  };

  if (rows === null) {
    return (
      <Card>
        <SectionTitle>Morning messages</SectionTitle>
        <p className="text-sm text-[#7E8596]">Loading…</p>
      </Card>
    );
  }

  const pending = rows.filter(r => !r.already_sent);
  const done    = rows.filter(r =>  r.already_sent);

  return (
    <Card>
      <div className="flex items-baseline justify-between mb-1">
        <SectionTitle>Morning messages</SectionTitle>
        {rows.length > 0 && (
          <span className="text-sm text-[#7E8596]">
            {done.length} of {rows.length} sent
          </span>
        )}
      </div>

      <p className="text-xs text-[#7E8596] mb-4">
        Sent from your own WhatsApp until the automatic one is approved.
        Marking them here stops a duplicate going out at 6:30.
      </p>

      {error && (
        <p className="text-sm text-[#E4572E] mb-3">{error}</p>
      )}

      {rows.length === 0 && (
        <p className="text-sm text-[#7E8596]">
          Nothing to send this morning.
        </p>
      )}

      <div className="divide-y divide-white/[0.06]">
        {[...pending, ...done].map(m => {
          const usable = !!waNumber(m.phone);
          return (
            <div key={m.id} className="py-3 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className={`text-sm ${m.already_sent ? 'text-[#7E8596]' : 'text-[#E8E6E1]'}`}>
                  {m.name}
                </p>
                <p className="text-xs text-[#7E8596] mt-0.5 leading-relaxed">
                  {m.message}
                </p>
                {!usable && (
                  <p className="text-xs text-[#E4572E] mt-1">No usable WhatsApp number</p>
                )}
              </div>

              {m.already_sent ? (
                <span className="text-xs text-[#7E8596] shrink-0 pt-0.5">Sent</span>
              ) : (
                <button
                  onClick={() => send(m)}
                  disabled={busyId === m.id || !usable}
                  className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold
                             bg-[#D4AF37] text-[#121316] disabled:opacity-40">
                  {busyId === m.id ? '…' : 'Send'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
