/**
 * TodaysGaps.jsx — who hasn't logged what, and a message ready for each.
 *
 * The point is to turn "chase your members" into a short list a coach can work
 * down in a few minutes. Each row names one member and the one or two things
 * actually missing, with a button that opens WhatsApp already talking about
 * that specific thing.
 *
 * Two deliberate restraints:
 *
 *   · At most two gaps per member. Someone who logged nothing has one problem,
 *     not six, and five separate messages from a coach's personal number is
 *     how a nudge becomes harassment.
 *
 *   · Nothing sends automatically. The list is a prompt for the coach, who
 *     knows which member is travelling, unwell, or simply does not need it.
 */

import { useState, useEffect, useCallback } from 'react';
import api from '../api/client';
import MessageMember from './MessageMember';
import { combinedGapMessage, GAP_LABEL } from '../utils/personalMessage';

const SEVERITY = {
  // Text colour only. These were bordered pills, which made a label look like a
  // control and put another outline on a screen already full of them.
  blocking: 'text-[#D98A80] font-medium',
  high:     'text-[#D9A66B] font-medium',
  medium:   'text-[#9AA0AE]',
  low:      'text-[#7E8596]',
};

export default function TodaysGaps() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [target, setTarget]   = useState(null);   // { member, gapKey }
  const [done, setDone]       = useState({});     // { "id:gap": true }
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/members/gaps');
      setData(data);
    } catch {
      setData({ members: [], error: true });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <p className="text-xs text-[#7E8596] py-3 text-center">Checking today's logs…</p>;
  if (data?.error) return <p className="text-xs text-red-400 py-3 text-center">Could not load today's gaps</p>;

  const members = data?.members || [];

  const clear = data?.clear ?? 0;
  const next = data?.next_check;

  if (!members.length) {
    return (
      <div className="py-3 text-center">
        <p className="text-xs text-emerald-300">
          Everyone has logged what's due so far. Nothing to chase.
        </p>
        {next && (
          <p className="text-[10px] text-[#7E8596] mt-1">
            Next check at {next.label} — {next.covers.join(' and ')}.
          </p>
        )}
      </div>
    );
  }

  // One message per member covering everything they're missing. Two or three
  // separate WhatsApps within a minute, from a personal number, reads as
  // pestering — one message naming both things is a single, easy ask.
  const open = (member) => {
    setTarget({
      member: { id: member.member_id, name: member.name, phone: member.phone },
      text: combinedGapMessage({ name: member.name }, member.gaps.map(g => g.key), member.days_since_log),
      key: String(member.member_id),
      // The LEADING gap — why this member is on the list at all. The server
      // has already sorted them by severity, so gaps[0] is the reason. Stored
      // against the send so we can eventually answer "is the 6pm water nudge
      // worth it" instead of guessing (Sprint L2).
      gapKey: member.gaps[0]?.key || null,
    });
  };

  /**
   * Show three, then offer the rest.
   *
   * With thirteen members this card filled the entire coach landing screen and
   * the member list — the thing the page is actually for — started below the
   * fold. Three is enough to see whether today needs attention; the rest is one
   * tap away. The explanatory paragraph that used to sit here moved into the
   * tooltip on the card title, where it is available without costing four lines
   * of screen every single visit.
   */
  const shown = expanded ? members : members.slice(0, 3);

  return (
    <div>
      {/* One surface, hairline-separated rows — not a box inside a box inside a
          box. Each member used to arrive as its own bordered card nested inside
          the section's bordered card, so the screen was mostly outlines: five
          members meant ten borders competing with the names. A rule between
          rows does the same job with none of the noise, and lets the name and
          the number be the only things with weight. */}
      <div className="divide-y divide-white/[0.055]">
        {shown.map(m => (
          <div key={m.member_id} className="py-3.5 first:pt-1">
            {/* Name and chips on the left, the number and the action on the
                right. Structured this way because a member whose ONLY gap is
                dormancy has no chips at all: the previous version kept an empty
                chips row to hold the button, which rendered as a tall blank
                band under every long-dormant member — the exact people a coach
                is scrolling to find. No chips now means no second line. */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold text-[#F2F1EE] truncate tracking-[-0.01em]">
                  {m.name}
                </p>
                {(() => {
                  // Dormancy is shown on the right, as a count or as words.
                  // Keeping the chip too printed "Never logged" twice on the
                  // same line.
                  const chips = m.gaps.filter(g => !(g.key === 'dormant' && m.days_since_log != null));
                  if (!chips.length) return null;
                  return (
                    <div className="flex flex-wrap gap-x-2 gap-y-1 mt-1.5">
                      {chips.map(g => (
                        <span key={g.key} className={`text-[11.5px] ${SEVERITY[g.severity]}`}>
                          {g.label || GAP_LABEL[g.key] || g.key}
                        </span>
                      ))}
                    </div>
                  );
                })()}
              </div>

              <div className="flex items-center gap-3 flex-shrink-0">
                {/* Days of silence — the number a coach triages on. A member who
                    has never logged has no count to show, so they get the words
                    instead of a sentinel. */}
                {m.days_since_log != null && (
                  m.days_since_log >= 9999 ? (
                    <span className="text-[12px] text-[#D98A80]">Never logged</span>
                  ) : (
                    <span className="font-display text-[19px] leading-none text-[#E8CE7A] tabular-nums">
                      {m.days_since_log}
                      <span className="font-sans text-[10.5px] text-[#6E7480] ml-1 font-medium">
                        {m.days_since_log === 1 ? 'day' : 'days'}
                      </span>
                    </span>
                  )
                )}

                {done[String(m.member_id)] ? (
                  <span className="text-[11.5px] text-[#6E8F6B]">Sent</span>
                ) : (
                  <button onClick={() => open(m)}
                    style={{ minHeight: 32 }}
                    className="text-[12px] font-semibold text-[#E8CE7A]
                      border border-[rgba(212,175,55,0.34)] rounded-full px-3.5
                      hover:bg-[rgba(212,175,55,0.09)] active:scale-95 transition-all">
                    Message
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {members.length > shown.length && (
        <button onClick={() => setExpanded(true)}
          className="w-full mt-2 py-2 text-xs font-semibold text-[#D4AF37]
            bg-[rgba(212,175,55,0.08)] border border-[rgba(212,175,55,0.20)]
            rounded-xl hover:bg-[rgba(212,175,55,0.14)] transition-colors">
          Show all {members.length}
        </button>
      )}
      {expanded && members.length > 3 && (
        <button onClick={() => setExpanded(false)}
          className="w-full mt-2 py-2 text-xs font-semibold text-[#7E8596]
            hover:text-[#9EA3B0] transition-colors">
          Show fewer
        </button>
      )}

      {/* Without this, a member showing 0% compliance elsewhere but missing
          from this list looks like a bug rather than someone who has simply
          logged everything due so far. */}
      {(clear > 0 || next) && (
        <p className="text-[10px] text-[#7E8596] mt-2.5 leading-relaxed">
          {clear > 0 && (
            <>{clear} other member{clear > 1 ? 's have' : ' has'} logged everything due so far. </>
          )}
          {next && <>Next check at {next.label} — {next.covers.join(' and ')}.</>}
        </p>
      )}

      <button onClick={load}
        className="text-[11px] font-bold text-[#D4AF37] mt-1.5">
        Refresh
      </button>

      {target && (
        <MessageMember
          member={target.member}
          open={true}
          initialText={target.text}
          onSent={async (channel) => {
            if (!target.gapKey) return;
            // Fire and forget. The message has already gone; a failure to
            // record it must never surface to the coach as an error.
            try {
              await api.post(`/members/${target.member.id}/nudge`, {
                gap_key: target.gapKey,
                channel,
                body: target.text,
              });
            } catch (err) {
              console.error('could not record the nudge:', err);
            }
          }}
          onClose={() => {
            setDone(d => ({ ...d, [target.key]: true }));
            setTarget(null);
          }}
        />
      )}
    </div>
  );
}
