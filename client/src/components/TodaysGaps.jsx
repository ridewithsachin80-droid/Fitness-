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
import { GAP_TEMPLATES, GAP_LABEL } from '../utils/personalMessage';

const SEVERITY = {
  blocking: 'text-red-300 border-red-400/35 bg-red-400/[0.08]',
  high:     'text-amber-300 border-amber-400/35 bg-amber-400/[0.08]',
  medium:   'text-[#D4AF37] border-[rgba(212,175,55,0.30)] bg-[rgba(212,175,55,0.06)]',
  low:      'text-[#9EA3B0] border-white/[0.12] bg-white/[0.03]',
};

export default function TodaysGaps() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [target, setTarget]   = useState(null);   // { member, gapKey }
  const [done, setDone]       = useState({});     // { "id:gap": true }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/patients/gaps');
      setData(data);
    } catch {
      setData({ members: [], error: true });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <p className="text-xs text-[#7E8596] py-3 text-center">Checking today's logs…</p>;
  if (data?.error) return <p className="text-xs text-red-400 py-3 text-center">Could not load today's gaps</p>;

  const members = data?.members || [];

  if (!members.length) {
    return (
      <p className="text-xs text-emerald-300 py-3 text-center">
        Everyone's up to date for the time of day. Nothing to chase.
      </p>
    );
  }

  const open = (member, gapKey) => {
    const build = GAP_TEMPLATES[gapKey] || GAP_TEMPLATES.nothing;
    setTarget({
      member: { id: member.member_id, name: member.name, phone: member.phone },
      text: build({ name: member.name }),
      key: `${member.member_id}:${gapKey}`,
    });
  };

  return (
    <div>
      <p className="text-[11px] text-[#7E8596] mb-2.5 leading-relaxed">
        Checked against the time of day — water isn't flagged in the morning, and
        supplements aren't flagged before evening.
      </p>

      <div className="space-y-2">
        {members.map(m => (
          <div key={m.member_id} className="bg-[#121316] border border-white/[0.07] rounded-xl px-3 py-2.5">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-[13px] font-bold text-white truncate">{m.name}</span>
              {m.all_gaps.length > m.gaps.length && (
                <span className="text-[9px] text-[#7E8596] flex-shrink-0">
                  +{m.all_gaps.length - m.gaps.length} more
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {m.gaps.map(g => {
                const key = `${m.member_id}:${g.key}`;
                return done[key] ? (
                  <span key={g.key}
                    className="text-[10px] font-bold text-emerald-300 border border-emerald-400/30
                      bg-emerald-400/[0.08] rounded-full px-2.5 py-1">
                    ✓ {GAP_LABEL[g.key] || g.label}
                  </span>
                ) : (
                  <button key={g.key} onClick={() => open(m, g.key)}
                    style={{ minHeight: 30 }}
                    className={`text-[10px] font-bold rounded-full px-2.5 border
                      active:scale-95 transition-transform ${SEVERITY[g.severity]}`}>
                    💬 {GAP_LABEL[g.key] || g.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <button onClick={load}
        className="text-[11px] font-bold text-[#D4AF37] mt-2.5">
        Refresh
      </button>

      {target && (
        <MessageMember
          member={target.member}
          open={true}
          initialText={target.text}
          onClose={() => {
            setDone(d => ({ ...d, [target.key]: true }));
            setTarget(null);
          }}
        />
      )}
    </div>
  );
}
