import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { getMembers, markMessagesRead }  from '../api/logs';
import { today, formatDate, plural } from '../constants';
import { Card, SectionTitle, OfflineBanner, PageLoader, BottomNav } from '../components/UI';
import CoachAIChat, { CoachAIFab } from '../components/CoachAIChat';
import TodaysGaps from '../components/TodaysGaps';
import NudgeEffectiveness from '../components/NudgeEffectiveness';
import { useSync } from '../hooks/useSync';

function complianceBadge(pct) {
  if (pct === null || pct === undefined) return { bg: 'bg-white/[0.05]', text: 'text-[#5a5a68]', label: '—' };
  if (pct >= 75) return { bg: 'bg-[rgba(52,211,153,0.10)]', text: 'text-emerald-300', label: `${pct}%` };
  if (pct >= 50) return { bg: 'bg-amber-400/10',             text: 'text-amber-300',   label: `${pct}%` };
  return           { bg: 'bg-[rgba(248,113,113,0.10)]',      text: 'text-red-300',     label: `${pct}%` };
}

function weightDelta(current, start) {
  if (!current || !start) return null;
  const delta = parseFloat(current) - parseFloat(start);
  return delta;
}

export default function MemberList() {
  const navigate       = useNavigate();
  const { user, logout } = useAuthStore();
  const [members, setMembers] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error,   setError]     = useState('');
  const [search,  setSearch]    = useState('');
  const todayStr = today();

  const load = async () => {
    try {
      const { data } = await getMembers();
      // Normalise date fields to YYYY-MM-DD regardless of how pg serialises them
      setMembers((data || []).map(p => ({
        ...p,
        last_logged: p.last_logged ? String(p.last_logged).slice(0, 10) : null,
        last_workout: p.last_workout ? String(p.last_workout).slice(0, 10) : null,
      })));
    } catch (e) {
      setError('Failed to load members');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Real-time: when a member saves a log, update their card live
  useSync(
    (update) => {
      setMembers(prev => prev.map(p =>
        p.id === update.memberId
          ? { ...p, last_compliance: update.compliance, latest_weight: update.weight_kg, last_logged: update.date }
          : p
      ));
    },
    (update) => {
      setMembers(prev => prev.map(p =>
        p.id === update.memberId ? { ...p, last_workout: update.date } : p
      ));
    }
  );

  const [filter, setFilter] = useState('all');

  if (loading) return <PageLoader />;

  const baseList = search.trim()
    ? members.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.phone || '').includes(search))
    : members;

  const filtered = (() => {
    if (filter === 'needs_attention') return baseList.filter(p => p.last_logged !== todayStr);
    if (filter === 'low_compliance')  return baseList.filter(p => p.last_compliance != null && p.last_compliance < 50);
    if (filter === 'no_pin')          return baseList.filter(p => p.has_pin === false);
    if (filter === 'messages')        return baseList.filter(p => (p.unread_messages || 0) > 0);
    return baseList;
  })();

  // Unread messages float to the top of whichever group the member is in.
  // A member who wrote to their coach has asked a direct question, and it is
  // the one thing on this screen that is waiting on a person rather than on
  // the member. Sorted inside the groups rather than across them so the
  // "no log today" split the coach already reads down stays intact.
  const byUnread = (a, b) => (b.unread_messages || 0) - (a.unread_messages || 0);
  // Built from the FULL roster, not the filtered list: a message must not
  // disappear because the coach happened to type a name into the search box.
  // Anyone who wrote in the last week, unread first — not unread-only, because
  // opening a member marks their messages read and the card would empty itself.
  // Unread only — once read it leaves this card. The member's own page keeps
  // every message, so nothing is lost by clearing the summary.
  const withMessages = members.filter(m => (m.unread_messages || 0) > 0).sort((a, b) =>
    (b.unread_messages || 0) - (a.unread_messages || 0)
    || String(b.latest_message_at || '').localeCompare(String(a.latest_message_at || '')));
  const totalUnread  = withMessages.reduce((n, m) => n + (m.unread_messages || 0), 0);
  const noLogToday  = filtered.filter(p => p.last_logged !== todayStr).sort(byUnread);
  const loggedToday = filtered.filter(p => p.last_logged === todayStr).sort(byUnread);

  return (
    <div className="min-h-screen bg-[#121316]">
      <OfflineBanner />

      {/* Header */}
      <div className="bg-gradient-to-br from-[#0d0b18] to-[#07060f] text-white px-4 pt-10 pb-6">
        <div className="max-w-md mx-auto">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11.5px] font-medium text-[#6E7480] mb-0.5">Coach</p>
              <h1 className="font-display text-xl font-medium">{user?.name}</h1>
              <p className="text-[#4e4e5c] text-xs mt-0.5">{members.length} {plural(members.length, 'member')} assigned</p>
            </div>
            <button onClick={() => navigate('/settings')}
              className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>

          {/* Quick stats */}
          {/* One surface with hairlines, not three bordered boxes. "Pending" is
              the figure that decides whether this page needs Sachin's attention
              at all, so it carries the gold and the others stay ink — three
              equally coloured numbers made him read all three every time. */}
          <div className="grid grid-cols-3 mt-4 rounded-[20px] bg-[#17181C] divide-x divide-white/[0.055]"
            style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.045)' }}>
            {[
              { label: 'Logged today', value: loggedToday.length },
              { label: 'Pending',      value: noLogToday.length, accent: noLogToday.length > 0 },
              { label: 'Total',        value: members.length },
            ].map(stat => (
              <div key={stat.label} className="py-3.5 text-center">
                <div className={`font-display text-[23px] leading-none font-medium tabular-nums ${
                  stat.accent ? 'text-[#E8CE7A]' : 'text-[#F2F1EE]'}`}>{stat.value}</div>
                <div className="text-[11.5px] text-[#7E8596] mt-1.5">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Messages members have sent, at the top of the page.
          A member wrote "Please assign me a workout" from the AI chat, it was
          delivered, and there was nowhere on this screen it appeared — the only
          way to find it was to open that member. A count on their card was not
          enough either: it says something is waiting without saying whether it
          needs an answer now. The message itself is the thing worth reading. */}
      {withMessages.length > 0 && (
        <div className="max-w-md mx-auto px-4 pt-4">
          <div className="bg-[#1A1C20] rounded-2xl border border-[rgba(212,175,55,0.35)] p-4">
            <p className="text-[12px] font-semibold text-[#8C7A46] mb-2.5">
              ✉️ Messages from members{totalUnread > 0 ? ` · ${totalUnread} new` : ''}
            </p>
            <div className="space-y-2">
              {withMessages.map(m => (
                <div key={m.id}
                  className="flex items-start gap-2 bg-[#121316] border border-white/[0.07]
                    rounded-xl px-3 py-2.5 hover:border-[rgba(212,175,55,0.30)] transition-colors">
                  <button onClick={() => navigate(`/coach/${m.id}`)} className="flex-1 min-w-0 text-left">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[13px] font-bold text-white truncate">{m.name}</p>
                    {m.unread_messages > 0 && (
                      <span className="text-[10px] font-bold text-[#121316] bg-[#D4AF37]
                        px-1.5 py-0.5 rounded-full flex-shrink-0">
                        {m.unread_messages > 1 ? `${m.unread_messages} new` : 'New'}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#9EA3B0] mt-1 line-clamp-2">{m.latest_message}</p>
                  </button>
                  {/* Clear it without opening them. Opening the member reads the
                      message anyway; this is for ones already dealt with
                      elsewhere, where opening a page to clear a badge is
                      busywork. It deletes nothing — the member's page keeps it. */}
                  <button
                    onClick={async () => {
                      try { await markMessagesRead(m.id); } catch { /* a refresh will re-show it */ }
                      setMembers(prev => prev.map(x =>
                        x.id === m.id ? { ...x, unread_messages: 0, latest_message: null } : x));
                    }}
                    title="Mark as read"
                    className="flex-shrink-0 text-[#7E8596] hover:text-[#D4AF37] px-1.5 py-1
                      text-sm transition-colors">
                    ✓
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Today's gaps — who is missing what, ranked, with a message ready.
          This was mounted only on the admin dashboard, so a coach landing here
          saw "5 Pending" in the header and then had to open five member pages
          one at a time to act on it. The API behind it
          (GET /members/gaps) has always allowed roleCheck('monitor','admin') —
          only the UI was admin-only. */}
      <div className="max-w-md mx-auto px-4 pt-4">
        <Card>
          <SectionTitle icon="🎯" tooltip="Members with something missing today, most urgent first. Nothing sends automatically — each message is yours to review.">
            Needs a nudge
          </SectionTitle>
          <TodaysGaps />
        </Card>

        {/* Whether the chasing above is actually working. Directly under the
            gaps card on purpose — the question only makes sense next to the
            thing it is judging. */}
        <NudgeEffectiveness />
      </div>

      {/* Member cards */}
      <div className="max-w-md mx-auto px-4 pt-4 pb-8 space-y-3">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>
        )}

        {/* Sprint 9: Search bar */}
        {members.length > 0 && (
          <div className="relative">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#4e4e5c]"
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name or phone…"
              className="w-full pl-10 pr-4 py-3 bg-[#1A1C20] border border-white/[0.1] rounded-2xl text-sm
                focus:outline-none focus:ring-2 focus:ring-emerald-300 text-stone-800"
            />
            {search && (
              <button onClick={() => setSearch('')}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#4e4e5c] hover:text-stone-600 text-lg">
                ×
              </button>
            )}
          </div>
        )}

        {/* Filter chips */}
        {members.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1 [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none' }}>
            {[
              { id: 'all',              label: 'All',              count: members.length },
              { id: 'needs_attention',  label: '⚠ No log today',   count: members.filter(p => p.last_logged !== todayStr).length },
              { id: 'low_compliance',   label: '📉 Low compliance', count: members.filter(p => p.last_compliance != null && p.last_compliance < 50).length },
              { id: 'no_pin',           label: '🔑 No PIN',         count: members.filter(p => p.has_pin === false).length },
              { id: 'messages',         label: '✉️ Messages',       count: members.filter(p => (p.unread_messages || 0) > 0).length },
            ].map(chip => (
              <button key={chip.id} onClick={() => setFilter(chip.id)}
                className={`flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full transition-all whitespace-nowrap ${
                  filter === chip.id
                    ? 'bg-white/[0.08] border border-white/[0.1] text-[#ededf0] shadow-sm'
                    : 'bg-[#1A1C20] border border-white/[0.1] text-stone-600 hover:border-stone-400'
                }`}>
                {chip.label}
                {chip.count > 0 && (
                  <span className={`ml-1 ${filter === chip.id ? 'text-stone-300' : 'text-[#4e4e5c]'}`}>
                    ({chip.count})
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {filtered.length === 0 && !error && (
          <div className="text-center py-16 text-[#4e4e5c]">
            <div className="text-4xl mb-3">👥</div>
            <p className="font-medium">{search ? `No members matching "${search}"` : 'No members assigned yet'}</p>
          </div>
        )}

        {/* Pending logs first */}
        {noLogToday.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-red-400 uppercase tracking-[0.12em] mb-2 px-1">
              ⚠ No log today ({noLogToday.length})
            </p>
            {noLogToday.map(p => <MemberCard key={p.id} member={p} todayStr={todayStr} onClick={() => navigate(`/coach/${p.id}`)} />)}
          </div>
        )}

        {loggedToday.length > 0 && (
          <div>
            {noLogToday.length > 0 && (
              <p className="text-[10px] font-semibold text-[#D4AF37] uppercase tracking-[0.12em] mb-2 mt-4 px-1">
                ✓ Logged today ({loggedToday.length})
              </p>
            )}
            {loggedToday.map(p => <MemberCard key={p.id} member={p} todayStr={todayStr} onClick={() => navigate(`/coach/${p.id}`)} />)}
          </div>
        )}
      </div>
      <BottomNav role={user?.role} />

      {/* Coach AI — manage protocols & messages by chat */}
      <CoachAIChat onApplied={load} />
      <CoachAIFab bottomOffset={88} />
    </div>
  );
}

function MemberCard({ member: p, todayStr, onClick }) {
  const badge  = complianceBadge(p.last_compliance);
  const delta  = weightDelta(p.latest_weight, p.start_weight);
  const noLog  = p.last_logged !== todayStr;
  const unread = p.unread_messages || 0;
  const conditions = Array.isArray(p.conditions) ? p.conditions : [];

  const workoutDaysAgo = p.last_workout
    ? Math.round((new Date(todayStr) - new Date(p.last_workout)) / 86400000)
    : null;

  return (
    <div onClick={onClick}
      className={`bg-[#131317] rounded-2xl border p-4 shadow-card-raised cursor-pointer transition-all
        hover:shadow-md active:scale-98 ${unread > 0
          ? 'border-[rgba(212,175,55,0.45)]'
          : noLog ? 'border-red-500/25' : 'border-white/[0.07]'}`}>
      <div className="flex items-start justify-between gap-3">
        {/* Left: name + info */}
        <div className="min-w-0 flex-1">
          <h2 className="font-display font-semibold text-[#ededf0] text-base truncate">{p.name}</h2>
          {/* Until now the only signal a member had written was a push
              notification, and a push that arrives while the phone is in a
              pocket is a message nobody ever sees. */}
          {unread > 0 && (
            <span className="inline-flex items-center gap-1 mt-1 text-xs font-semibold
              text-[#D4AF37] bg-[rgba(212,175,55,0.12)] px-2 py-0.5 rounded-full">
              ✉️ {unread} {plural(unread, 'message')}
            </span>
          )}
          <p className="text-xs text-[#5a5a68] mt-0.5">{p.phone}</p>

          {conditions.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {conditions.map(c => (
                <span key={c} className="text-xs bg-white/[0.05] text-[#9a9aa6] px-2 py-0.5 rounded-full font-medium">
                  {c.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Right: weight + compliance */}
        <div className="text-right flex-shrink-0">
          {p.latest_weight ? (
            <>
              <div className="font-display font-semibold text-[#ededf0]">{p.latest_weight} kg</div>
              {delta !== null && (
                <div className={`text-xs font-semibold mt-0.5 ${delta < 0 ? 'text-emerald-400' : delta > 0 ? 'text-red-400' : 'text-[#5a5a68]'}`}>
                  {delta < 0 ? '↓' : delta > 0 ? '↑' : '='} {Math.abs(delta).toFixed(1)} kg
                </div>
              )}
            </>
          ) : (
            <span className="text-xs text-[#3a3a46]">No weight</span>
          )}
          <div className={`mt-1.5 text-xs font-bold px-2 py-0.5 rounded-full inline-block ${badge.bg} ${badge.text}`}>
            {badge.label}
          </div>
        </div>
      </div>

      {/* Bottom row */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/[0.06]">
        {noLog ? (
          <span className="text-xs font-bold text-red-400">⚠ No log today</span>
        ) : (
          <span className="text-xs text-[#5a5a68]">
            Logged {p.last_logged === todayStr ? 'today' : formatDate(p.last_logged)}
          </span>
        )}
        <div className="flex items-center gap-2">
          {/* Workout activity — only shown when there's something to say, and
              flagged when genuinely stale (10+ days), same threshold used by
              Muscle Coverage's recency lens for consistency. */}
          {workoutDaysAgo !== null && (
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
              workoutDaysAgo === 0 ? 'text-[#e0c98a] bg-[rgba(212,175,55,0.10)]'
              : workoutDaysAgo > 10 ? 'text-amber-400 bg-amber-400/10'
              : 'text-[#9a9aa6] bg-white/[0.05]'}`}>
              🏋️ {workoutDaysAgo === 0 ? 'Today' : `${workoutDaysAgo}d ago`}
            </span>
          )}
          {/* Sprint 9: PIN status warning */}
          {p.has_pin === false && (
            <span className="text-xs font-semibold text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full border border-amber-400/20">
              🔑 No PIN
            </span>
          )}
          <div className="flex items-center gap-1 text-[#3a3a46]">
            <span className="text-xs">Goal: {p.target_weight} kg</span>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
