/**
 * NudgeEffectiveness.jsx — are the nudges worth sending? (Sprint L2)
 *
 * Shows how often a member logged something in the 48 hours after a coach
 * messaged them, split by which gap prompted it, what hour it went out, and
 * whether it was WhatsApp or SMS.
 *
 * ── THE RULE THIS SCREEN EXISTS TO RESPECT ──────────────────────────────────
 * Below 20 sends in a bucket there is no percentage. Not a greyed-out one, not
 * one with an asterisk — the server sends `rate_pct: null` and this renders the
 * count and a sentence instead. Two responses out of three is not 67%, and this
 * app already refuses to claim thin effects in the adaptive engine and the
 * learning model. A nudge dashboard quoting confident numbers off five data
 * points would undo that credibility everywhere else in the product.
 *
 * The wording is deliberately "logged afterwards", never "caused". A member may
 * have been about to log anyway; one who reads the message and goes for a walk
 * without logging counts as no response. The definition is stated on the card
 * so nobody has to guess what the number means.
 */

import { useState, useEffect, useCallback } from 'react';
import api from '../api/client';
import { plural } from '../constants';

function Row({ b }) {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <span className="text-[11px] text-[#9EA3B0] w-[104px] flex-shrink-0 truncate">{b.label}</span>

      {b.enough_data ? (
        <>
          <div className="flex-1 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
            <div className="h-full bg-[#D4AF37] rounded-full"
              style={{ width: `${Math.max(2, b.rate_pct)}%` }} />
          </div>
          <span className="text-[11px] font-bold text-[#F0E2B6] w-[62px] text-right flex-shrink-0">
            {b.rate_pct}% of {b.sent}
          </span>
        </>
      ) : (
        <>
          {/* No bar at all. A 5%-wide bar for "3 sent" still reads as a
              measurement, and the point is that there isn't one yet. */}
          <span className="flex-1 text-[11px] text-[#7E8596] italic truncate">
            {b.sent} sent — too few to say
          </span>
          <span className="text-[11px] text-[#7E8596] w-[62px] text-right flex-shrink-0">
            {b.responded}/{b.sent}
          </span>
        </>
      )}
    </div>
  );
}

function Group({ title, buckets }) {
  if (!buckets?.length) return null;
  return (
    <div className="mt-3">
      <p className="text-[10px] font-bold text-[#7E8596] mb-0.5">{title}</p>
      {buckets.map(b => <Row key={b.label} b={b} />)}
    </div>
  );
}

export default function NudgeEffectiveness() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed]   = useState(false);
  const [open, setOpen]       = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setFailed(false);
    try {
      const { data } = await api.get('/members/gaps/effectiveness');
      setData(data);
    } catch (e) {
      // An empty result and a failed request look identical otherwise, and
      // they mean opposite things.
      console.error('nudge effectiveness failed:', e);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (open && !data && !failed) load(); }, [open, data, failed, load]);

  return (
    <div className="bg-[#1A1C20] border border-white/[0.07] rounded-2xl px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-sm font-bold text-white">Did the nudges work?</p>
          <p className="text-[10px] text-[#7E8596]">
            How often a member logged in the 48h after you messaged them
          </p>
        </div>
        <button onClick={() => setOpen(v => !v)}
          style={{ minHeight: 32 }}
          className="text-[11px] font-bold text-[#D4AF37] px-3 rounded-xl
            bg-[rgba(212,175,55,0.10)] border border-[rgba(212,175,55,0.22)] flex-shrink-0">
          {open ? 'Hide' : 'Show'}
        </button>
      </div>

      {open && (
        <div className="mt-3">
          {loading && <p className="text-[11px] text-[#7E8596] text-center py-3">Loading…</p>}

          {!loading && failed && (
            <div className="text-center py-3">
              <p className="text-[11px] text-red-300">Couldn't load this just now.</p>
              <button onClick={load} className="text-[11px] font-bold text-[#D4AF37] mt-1">Try again</button>
            </div>
          )}

          {!loading && !failed && data && data.overall.sent === 0 && (
            <p className="text-[11px] text-[#9EA3B0] leading-relaxed py-2">
              Nothing recorded yet. Every nudge you send from Today's gaps gets
              counted here from now on — it takes a few weeks of sends before
              there is enough to read anything into.
            </p>
          )}

          {!loading && !failed && data && data.overall.sent > 0 && (
            <>
              <div className="bg-[#121316] border border-white/[0.06] rounded-xl px-3 py-2.5">
                <p className="text-[11px] text-[#9EA3B0]">
                  {data.overall.enough_data ? (
                    <>
                      <span className="text-lg font-extrabold text-[#F0E2B6]">{data.overall.rate_pct}%</span>
                      {' '}of your {data.overall.sent} nudges were followed by a log.
                    </>
                  ) : (
                    <>
                      <span className="text-lg font-extrabold text-[#F0E2B6]">{data.overall.sent}</span>
                      {' '}{plural(data.overall.sent, 'nudge')} sent so far,
                      {' '}{data.overall.responded} followed by a log. That's not enough
                      to work out a rate yet — {data.min_bucket} is where a percentage
                      starts meaning something.
                    </>
                  )}
                </p>
              </div>

              <Group title="By what prompted it" buckets={data.by_gap} />
              <Group title="By hour sent (IST)"  buckets={data.by_hour} />
              <Group title="By channel"          buckets={data.by_channel} />

              <p className="text-[10px] text-[#7E8596] leading-relaxed mt-3">
                "Followed by a log" means they saved something within
                {' '}{data.response_window_hours}h of your message. It doesn't prove the
                message caused it — someone about to log anyway counts, and someone
                who reads it and goes for a walk without logging doesn't.
              </p>

              <button onClick={load} className="text-[11px] font-bold text-[#D4AF37] mt-2">
                Refresh
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
