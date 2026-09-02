/**
 * StreakCard — the member's own logging streak on the Today page.
 *
 * The coach view already renders a 14-day strip; members deserve to see their
 * own. A day counts when the member logged food or a weigh-in — the same rule
 * the coach's strip uses, so both sides agree on what "logged" means.
 *
 * Milestones (7/14/30/60/100 days) show a one-time celebration line, tracked
 * per milestone in localStorage so it appears exactly once per level, not on
 * every visit. Self-contained: fetches its own 14-day range once per mount,
 * fails silently — a streak card must never break the Today page.
 */
import { useEffect, useState } from 'react';
import { getLogRange } from '../api/logs';

const MILESTONES = [100, 60, 30, 14, 7];

function istToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

// Exported for tests: 14 cells oldest→newest plus the current run ending today
// (or yesterday — a streak isn't broken until today is actually missed).
export function computeStreak(logs, todayStr) {
  const logged = new Set(
    (logs || [])
      .filter(l => (l.food_items?.length || 0) > 0 || l.weight_kg != null)
      .map(l => String(l.log_date).slice(0, 10))
  );
  const day = (offset) => {
    const d = new Date(todayStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - offset);
    return d.toISOString().slice(0, 10);
  };
  const cells = [];
  for (let i = 13; i >= 0; i--) cells.push({ date: day(i), logged: logged.has(day(i)) });

  let streak = 0;
  let offset = logged.has(day(0)) ? 0 : 1;   // today not logged yet ≠ broken
  while (logged.has(day(offset + streak))) streak++;
  return { cells, streak };
}

export default function StreakCard() {
  const [data, setData] = useState(null);
  const [milestone, setMilestone] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const today = istToday();
        const from = new Date(today + 'T00:00:00Z');
        from.setUTCDate(from.getUTCDate() - 20);   // margin over 14 for streak run-in
        const { data: res } = await getLogRange(from.toISOString().slice(0, 10), today);
        if (!alive) return;
        const result = computeStreak(res.logs || res || [], today);
        setData(result);

        const hit = MILESTONES.find(m => result.streak >= m);
        if (hit && localStorage.getItem('fl-streak-milestone') !== String(hit)) {
          localStorage.setItem('fl-streak-milestone', String(hit));
          setMilestone(hit);
        }
      } catch { /* never break Today over a streak */ }
    })();
    return () => { alive = false; };
  }, []);

  if (!data || (data.streak === 0 && data.cells.every(c => !c.logged))) return null;

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-[#1A1C20] px-4 py-3 mb-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-[#9EA3B0]">
          🔥 {data.streak > 0 ? `${data.streak}-day streak` : 'Logging streak'}
        </span>
        <span className="text-[10px] text-[#7E8596]">last 14 days</span>
      </div>
      <div className="flex gap-[3px]">
        {data.cells.map(c => (
          <div key={c.date} title={c.date}
            className="flex-1 h-4 rounded-[3px]"
            style={{ background: c.logged ? 'rgba(212,175,55,0.55)' : 'rgba(255,255,255,0.05)' }} />
        ))}
      </div>
      {milestone && (
        <p className="text-[11px] text-[#D4AF37] font-semibold mt-2">
          {milestone} days straight — that consistency is what moves the scale. Keep it rolling.
        </p>
      )}
    </div>
  );
}
