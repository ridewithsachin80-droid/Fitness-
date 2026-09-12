import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import api from '../api/client';
import { adminResetPin, adminSendPush, getAuditLog, adminDeleteMember, markMessagesRead } from '../api/logs';
import { Card, SectionTitle, PageLoader } from '../components/UI';
import { ACTIVITIES, ACV_ITEMS, SUPPLEMENTS, RDA_TARGETS, RDA_OVERRIDE_KEYS, roleLabel, plural } from '../constants';
import AdminReminders from '../components/AdminReminders';
import MessageMember from '../components/MessageMember';
import TodaysGaps from '../components/TodaysGaps';
import CoachAIChat, { CoachAIFab, useCoachAI } from '../components/CoachAIChat';
import EvalSamples from '../components/EvalSamples';
// Sprint 12c: the modals live in components/admin/ (see each file's header)
import { StatCard, Modal, Field, assignableCoaches } from '../components/admin/AdminAtoms';
import { AddMemberModal } from '../components/admin/AddMemberModal';
import { EditMemberModal } from '../components/admin/EditMemberModal';
import { PushModal } from '../components/admin/PushModal';
import { AddCoachModal } from '../components/admin/AddCoachModal';
import { AssignModal } from '../components/admin/AssignModal';
import { DeleteMemberModal } from '../components/admin/DeleteMemberModal';

// ── Stat card ─────────────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const navigate         = useNavigate();
  const { user, logout } = useAuthStore();
  const [tab,       setTab]       = useState('overview');
  const openCoachAI = useCoachAI(s => s.openChat);
  const [remindBusy, setRemindBusy] = useState({});   // { [memberId|'all']: true }
  const [reminded,   setReminded]   = useState({});   // { [memberId]: true } after sent
  // Which member the compose sheet is open for. Personal WhatsApp matters most
  // exactly here: a member who has not logged in 86 days is not opening the app
  // to read a push, so the in-app reminder reaches nobody.
  const [msgMember, setMsgMember]   = useState(null);
  const [complianceLens, setComplianceLens] = useState('today'); // 'today' | '7d'
  const [menuFor,    setMenuFor]    = useState(null); // member id with open ⋮ menu
  const [weeklyBusy, setWeeklyBusy] = useState(null); // member id being summarised
  const [weeklySent, setWeeklySent] = useState({});   // { [id]: true }

  const sendWeekly = useCallback(async (m) => {
    setWeeklyBusy(m.id);
    try {
      await api.post('/ai-chat/weekly-summary', { member_id: m.id });
      setWeeklySent(s => ({ ...s, [m.id]: true }));
    } catch (e) {
      console.error('weekly summary failed:', e);
    } finally {
      setWeeklyBusy(null);
    }
  }, []);

  const sendRemind = useCallback(async (list, key) => {
    if (!list.length) return;
    setRemindBusy(b => ({ ...b, [key]: true }));
    try {
      const { data } = await api.post('/ai-chat/remind', {
        members: list.map(a => ({ id: a.id, name: a.name })),
      });
      const okIds = (data.results || []).filter(r => r.ok).map(r => r.id);
      setReminded(r => { const n = { ...r }; okIds.forEach(id => { n[id] = true; }); return n; });
    } catch (e) {
      console.error('remind failed:', e);
    } finally {
      setRemindBusy(b => { const n = { ...b }; delete n[key]; return n; });
    }
  }, []);
  const [stats,     setStats]     = useState(null);
  const [overview,  setOverview]  = useState(null);
  const [members,   setMembers]   = useState([]);
  const [deleteMember, setDeleteMember] = useState(null);   // member pending deletion
  const [coaches,  setCoaches]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [showAddMember,  setShowAddMember]  = useState(false);
  const [showAddCoach, setShowAddCoach] = useState(false);
  const [showPush,       setShowPush]       = useState(false);
  const [auditLog,       setAuditLog]       = useState([]);
  const [assignTarget,   setAssignTarget]   = useState(null);
  const [editTarget,     setEditTarget]     = useState(null);
  const [search,    setSearch]    = useState('');

  const load = useCallback(async () => {
    try {
      const [s, m, mo, ov, al] = await Promise.all([
        api.get('/admin/stats'),
        api.get('/admin/members'),
        api.get('/admin/coaches'),
        api.get('/admin/overview').catch(() => ({ data: null })),
        getAuditLog(100).catch(() => ({ data: [] })),
      ]);
      setStats(s.data);
      setMembers(m.data);
      setCoaches(mo.data);
      setOverview(ov.data);
      setAuditLog(al.data || []);
    } catch (e) {
      console.error('Admin load error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleUser = async (id, type) => {
    const url = `/admin/${type}s/${id}/toggle`;
    const { data } = await api.patch(url);
    if (type === 'member') {
      setMembers(prev => prev.map(m => m.id === id ? { ...m, active: data.active } : m));
    } else {
      setCoaches(prev => prev.map(m => m.id === id ? { ...m, active: data.active } : m));
    }
  };

  const filtered = (list, key) =>
    list.filter(x => x[key]?.toLowerCase().includes(search.toLowerCase()));

  if (loading) return <PageLoader />;

  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="min-h-screen bg-charcoal">

      {/* Header */}
      <div className="bg-gradient-to-br from-surface to-charcoal text-white px-4 pt-10 pb-5">
        <div className="max-w-2xl mx-auto">
          {/* `min-w-0` on the name block and `flex-shrink-0` on the button.
              Without them the two children fight over a 360px row: the name
              block refuses to go below its longest word, so the button absorbs
              the whole squeeze and "Sign out" breaks onto two lines — which is
              what looked like it had been cut off. The name is the part that
              can afford to wrap. */}
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="min-w-0">
              {/* Sentence case, and no crown. Tracked capitals plus an emoji is
                  the chrome that made this read as a template; the product name
                  is a quiet label, and the person's name is the headline. */}
              <p className="text-micro font-medium text-gold-dark mb-1">FitLife admin</p>
              <h1 className="font-display text-num leading-tight font-medium tracking-[-0.015em]">
                Welcome, {user?.name}
              </h1>
              {stats && (
                <p className="text-mid text-xs mt-0.5">
                  {stats.members} members · {stats.coaches} coaches · {stats.logsToday} logged today
                </p>
              )}
            </div>
            <div className="flex-shrink-0 flex items-center gap-1.5">
              {/* Sprint 9b: the day-to-day coaching screens (Needs attention, member
                  pages) live at /coach; an admin used to reach them only via a
                  "View" button three taps away. */}
              <button onClick={() => navigate('/coach')} data-testid="admin-coach-view"
                className="whitespace-nowrap text-xs font-bold text-charcoal bg-gold px-3 py-1.5 rounded-xl active:scale-95 transition-transform">
                Coach view ›
              </button>
              <button onClick={() => { logout(); }}
                className="flex-shrink-0 whitespace-nowrap text-xs text-mid hover:text-white px-3 py-1.5
                  border border-white/[0.1] hover:border-white/[0.2] rounded-xl transition-colors">
                Sign out
              </button>
            </div>
          </div>

          {/* AI command bar — the coach's fastest path to any change */}
          <button onClick={() => openCoachAI()}
            style={{ minHeight: 52 }}
            className="w-full flex items-center gap-3 bg-gradient-to-r from-gold/[0.16] to-gold-dark/[0.08] border border-gold/40 hover:border-gold/60 rounded-2xl px-4 py-3 transition-all active:scale-[0.99] shadow-[0_0_24px_rgba(212,175,55,0.10)]">
            <span className="w-8 h-8 rounded-full bg-gradient-to-br from-gold to-gold-dark flex items-center justify-center text-sm flex-shrink-0 shadow-[0_0_14px_rgba(212,175,55,0.5)]">✨</span>
            <span className="text-sm text-mid font-medium flex-1 text-left truncate">"Set Bujju water 4L, message Asha…"</span>
            <span className="text-gold-light">🎤</span>
          </button>
        </div>
      </div>

      {/* Tabs + search */}
      <div className="max-w-2xl mx-auto px-4 pt-4">
        {/* Five tabs at 14px with an emoji each need 389px of label. On a 360px
            phone — and certainly on a 320px one — they used to push the page
            itself sideways rather than give way.

            `min-w-max` says each tab keeps its whole label, `overflow-x-auto`
            says the STRIP scrolls when they don't all fit, and `flex-1` still
            stretches them to fill the row on any screen where they do. Same
            pattern as the member-list filter chips, so it already feels
            familiar. Nothing inside is sticky, so the scroll container is
            safe here. */}
        <div className="flex gap-2 mb-3 overflow-x-auto">
          {[
            // Words only. Six OS-drawn emoji across one tab strip rendered at
            // six different weights and colours, and none of them told you
            // anything the label did not already say.
            { id: 'overview',   label: 'Overview'  },
            { id: 'members',    label: 'Members'   },
            { id: 'coaches',    label: 'Coaches'   },
            { id: 'reminders',  label: 'Reminders' },
            { id: 'audit',      label: 'Audit'     },
            { id: 'evals',      label: 'AI evals'  },
          ].map(t => (
            <button key={t.id} onClick={() => { setTab(t.id); setSearch(''); }}
              className={`flex-1 min-w-max whitespace-nowrap px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                tab === t.id
                  ? 'bg-gold/[0.14] text-gold-light border border-gold/25'
                  : 'text-lo hover:text-mid'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Search + add button — only for members/coaches tabs */}
        {(tab === 'members' || tab === 'coaches') && (
        <div className="flex gap-2 mb-4">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={`Search ${tab}…`}
            className="flex-1 px-3 py-2.5 bg-surface border border-white/[0.1] rounded-xl text-sm
              focus:outline-none focus:ring-2 focus:ring-gold/30 text-white placeholder-lo"
          />
          <button
            onClick={() => tab === 'members' ? setShowAddMember(true) : setShowAddCoach(true)}
            className="px-4 py-2.5 bg-gold hover:bg-gold-light text-charcoal text-sm font-bold
              rounded-xl transition-colors whitespace-nowrap">
            + Add {tab === 'members' ? 'Member' : 'Coach'}
          </button>
        </div>
        )}
      </div>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-4 pb-10 space-y-2">

        {/* ── Overview tab ── */}
        {tab === 'overview' && overview && (
          <div className="space-y-3">
            {/* Stat strip */}
            {/* Four figures on one surface, divided by hairlines rather than
                four bordered boxes in four colours. "Logged today" is the one
                Sachin opens this page for, so it is the one in gold; the rest
                are ink. Set in the display face at a size worth reading —
                previously 15px bold with an 8px capitalised caption. */}
            <div className="grid grid-cols-4 rounded-[20px] bg-surface divide-x divide-white/[0.055]"
              style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.045)' }}>
              {[
                { label: 'Members',   value: overview.stats.total_members },
                { label: 'Logged',    value: `${overview.stats.logged_today}/${overview.stats.total_members}`, accent: true },
                { label: '7-day avg', value: `${overview.stats.avg_compliance_7d}%` },
                { label: 'Lost',      value: `${overview.stats.total_weight_lost_kg}kg` },
              ].map(s => (
                <div key={s.label} className="px-2 py-3.5 text-center">
                  <div className={`font-display text-[21px] leading-none font-medium tabular-nums ${
                    s.accent ? 'text-gold-light' : 'text-white'}`}>{s.value}</div>
                  <div className="text-caption text-lo mt-1.5">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Messages members have sent, first thing on the Overview tab.
                This card also exists on /coach — but Sachin works from /admin,
                so a message surfaced only on the coach page is a message he
                never sees. Built from the full member list rather than any
                filtered view, and it disappears once the member is opened,
                because opening them marks their messages read. */}
            {(() => {
              // Anyone who has written in the last week, unread first. Not
              // unread-only: opening a member's page marks their messages read,
              // so an unread-only card emptied itself the first time the coach
              // looked at that member for any reason.
              const withMsgs = (members || [])
                .filter(m => (m.unread_messages || 0) > 0)   // unread only — read messages leave this card
                .sort((a, b) => (b.unread_messages || 0) - (a.unread_messages || 0)
                             || String(b.latest_message_at || '').localeCompare(String(a.latest_message_at || '')));
              if (!withMsgs.length) return null;
              const newCount = withMsgs.reduce((n, m) => n + (m.unread_messages || 0), 0);
              return (
                <div className="bg-surface border border-gold/35 rounded-2xl p-3.5 mb-3">
                  <p className="text-sm font-bold text-gold mb-2">
                    ✉️ Messages from members
                    {newCount > 0 && <span className="ml-2">· {newCount} new</span>}
                  </p>
                  <div className="space-y-2">
                    {withMsgs.map(m => (
                      <div key={m.id}
                        className={`flex items-start gap-2 bg-charcoal rounded-xl px-3 py-2.5 border
                          hover:border-gold/30 transition-colors ${
                          m.unread_messages > 0 ? 'border-gold/30' : 'border-hair'}`}>
                        <button onClick={() => navigate(`/coach/${m.id}`)} className="flex-1 min-w-0 text-left">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-body-sm font-bold text-white truncate">{m.name}</p>
                          {m.unread_messages > 0 && (
                            <span className="text-eyebrow font-bold text-charcoal bg-gold
                              px-1.5 py-0.5 rounded-full flex-shrink-0">
                              {m.unread_messages > 1 ? `${m.unread_messages} new` : 'New'}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-mid mt-1 line-clamp-2">{m.latest_message}</p>
                        </button>
                        {/* Same control as the coach list: clear it here when it
                            has already been dealt with, without opening them. */}
                        <button
                          onClick={async () => {
                            try { await markMessagesRead(m.id); } catch { /* a refresh will re-show it */ }
                            setMembers(prev => prev.map(x =>
                              x.id === m.id ? { ...x, unread_messages: 0, latest_message: null } : x));
                          }}
                          title="Mark as read"
                          className="flex-shrink-0 text-lo hover:text-gold px-1.5 py-1
                            text-sm transition-colors">
                          ✓
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Today's gaps — what to chase right now. Needs Attention below is
                the longer-term list of members drifting away. */}
            <div className="bg-surface border border-hair rounded-2xl p-3.5 mb-3">
              <p className="text-body font-semibold text-white mb-1 tracking-[-0.01em]">Today's gaps</p>
              <TodaysGaps />
            </div>

            {/* The per-member list that lived here is now the single gaps card
                above, which covers both dormant members and today's misses.
                Only the bulk in-app reminder remains, since that is the one
                action the gaps card deliberately does not automate. */}
            {overview.alerts?.length > 0 && (
              <div className="bg-surface rounded-2xl p-3.5 border border-hair mb-3">
                <button
                  onClick={() => sendRemind(overview.alerts, 'all')}
                  disabled={remindBusy['all']}
                  style={{ minHeight: 42 }}
                  className="w-full rounded-xl text-xs font-extrabold text-gold-light
                    bg-gold/10 border border-gold/35
                    active:scale-[0.99] transition-transform disabled:opacity-50">
                  {remindBusy['all'] ? 'Sending…' : `Send an in-app reminder to all ${overview.alerts.length}`}
                </button>
                <p className="text-tiny text-lo mt-2 text-center">
                  Push notification and a coach message inside the app, logged in Audit.
                  For members who have stopped opening the app, use 💬 above instead.
                </p>
              </div>
            )}

            {/* Compliance — one list, two lenses */}
            <div className="bg-surface rounded-2xl border border-hair overflow-hidden">
              <div className="flex bg-white/[0.03] border-b border-hair p-1.5 gap-1">
                {[['today', 'Today'], ['7d', '7-Day Average']].map(([k, l]) => (
                  <button key={k} onClick={() => setComplianceLens(k)}
                    className={`flex-1 py-2 rounded-xl text-xs font-extrabold transition-all ${
                      complianceLens === k ? 'bg-gold text-charcoal' : 'text-lo hover:text-mid'
                    }`}>{l}</button>
                ))}
              </div>

              {complianceLens === 'today' && (overview.today_detail || []).map(m => {
                const pct = m.compliance_pct || 0;
                const color = pct >= 75 ? 'bg-gold' : pct >= 50 ? 'bg-amber-400' : pct > 0 ? 'bg-red-400' : 'bg-white/[0.08]';
                const textColor = pct >= 75 ? 'text-gold-light' : pct >= 50 ? 'text-amber-300' : pct > 0 ? 'text-red-400' : 'text-mid';
                return (
                  <div key={m.id} className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06] last:border-0">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-white">{m.name}</span>
                      {m.monitor_name && <span className="text-xs text-mid ml-2">· {m.monitor_name}</span>}
                    </div>
                    {m.weight_kg && <span className="text-xs font-semibold text-gold-light">{m.weight_kg} kg</span>}
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-2 bg-white/[0.06] rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className={`text-xs font-bold w-8 text-right ${textColor}`}>
                        {m.log_date ? `${pct}%` : '—'}
                      </span>
                    </div>
                  </div>
                );
              })}

              {complianceLens === '7d' && (overview.compliance_7d || []).map(m => {
                const pct = parseFloat(m.avg_7d) || 0;
                return (
                  <div key={m.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.06] last:border-0">
                    <span className="text-sm text-white flex-1">{m.name}</span>
                    <span className="text-xs text-mid">{m.days_logged} days</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                      pct >= 75 ? 'bg-ok/[0.14] text-gold-light' :
                      pct >= 50 ? 'bg-amber-400/[0.14] text-amber-300' : 'bg-red-400/10 text-red-400'
                    }`}>{Math.round(pct)}%</span>
                  </div>
                );
              })}
            </div>

            {/* Food manager shortcut */}
            <button onClick={() => navigate('/admin/foods')}
              className="w-full py-3 bg-charcoal hover:bg-charcoal text-white font-semibold rounded-2xl text-sm transition-colors flex items-center justify-center gap-2">
              🥗 Food Database Manager
              <span className="text-mid text-xs">→</span>
            </button>
          </div>
        )}

        {tab === 'overview' && !overview && !loading && (
          <p className="text-center text-mid py-8">Overview data loading…</p>
        )}

        {/* ── Members tab ── */}
        {tab === 'members' && (
          <>
            {filtered(members, 'name').length === 0 ? (
              /* No "+ Add first member" button here. The gold "+ Add Member"
                 button in the search row above is on screen on this tab at all
                 times, empty list included — so this used to put two identical
                 actions a few centimetres apart and make the page look like it
                 had rendered twice. One action, one place.

                 An empty list also has two very different causes. "No members
                 yet" under a search for "prya" is simply wrong, and it sent
                 people off to add a member who was already there. */
              <div className="text-center py-16 text-mid">
                <div className="text-4xl mb-3">👥</div>
                {search.trim() ? (
                  <>
                    <p className="font-medium">No member matches “{search.trim()}”</p>
                    <button onClick={() => setSearch('')}
                      className="mt-3 text-gold font-semibold text-sm">Clear search</button>
                  </>
                ) : (
                  <>
                    <p className="font-medium">No members yet</p>
                    <p className="text-xs mt-1">Use “+ Add Member” above to add the first one.</p>
                  </>
                )}
              </div>
            ) : (
              filtered(members, 'name').map(m => {
                const noLog = m.last_logged !== today;
                const initials = m.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
                const pct = m.last_compliance;
                const ringColor = pct == null ? '#4A4E5A' : pct >= 75 ? '#34d399' : pct >= 50 ? '#fbbf24' : '#f87171';
                const start  = parseFloat(m.start_weight);
                const latest = parseFloat(m.latest_weight);
                const goal   = parseFloat(m.target_weight);
                const hasJourney = Number.isFinite(start) && Number.isFinite(goal) && start !== goal;
                const cur = Number.isFinite(latest) ? latest : start;
                const progress = hasJourney ? Math.max(0, Math.min(100, ((start - cur) / (start - goal)) * 100)) : 0;
                const lost = hasJourney && Number.isFinite(latest) ? +(start - latest).toFixed(1) : null;
                return (
                  <div key={m.id}
                    className={`relative bg-surface rounded-2xl border p-4 shadow-card
                      ${!m.active ? 'opacity-50 border-white/[0.08]' : noLog ? 'border-amber-400/35' : 'border-hair'}`}>
                    <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate(`/coach/${m.id}`)}>
                      <div className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center font-display font-bold text-sm text-gold-light"
                        style={{ background: 'linear-gradient(135deg,#2A2620,#1A1C20)',
                          border: '1px solid rgba(212,175,55,0.18)' }}>
                        {initials}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-bold text-white truncate">{m.name}</h3>
                          {!m.active && <span className="text-tiny font-bold bg-white/[0.06] text-mid px-2 py-0.5 rounded-full">INACTIVE</span>}
                          {noLog && m.active && <span className="text-tiny font-bold text-amber-300 bg-amber-400/10 border border-amber-400/25 px-2 py-0.5 rounded-full">NO LOG</span>}
                          {m.has_pin === false && m.active && <span className="text-tiny font-bold text-amber-300">🔑 NO PIN</span>}
                        </div>
                        <p className="text-eyebrow text-mid mt-0.5 truncate">
                          📱 {m.phone}
                          {m.monitor_name
                            ? <span className="text-gold-light"> · 🏋️ {m.monitor_name}</span>
                            : <span className="text-amber-300"> · ⚠ Unassigned</span>}
                        </p>
                      </div>
                      {/* Compliance ring */}
                      <div className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center"
                        style={{ background: pct != null
                          ? `conic-gradient(${ringColor} 0 ${pct}%, rgba(255,255,255,0.08) ${pct}% 100%)`
                          : 'rgba(255,255,255,0.06)' }}>
                        <span className="w-7 h-7 rounded-full bg-surface flex items-center justify-center text-[8px] font-extrabold"
                          style={{ color: ringColor }}>
                          {pct != null ? `${pct}%` : '—'}
                        </span>
                      </div>
                      {/* ⋮ menu */}
                      <button onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === m.id ? null : m.id); }}
                        style={{ minWidth: 36, minHeight: 36 }}
                        className="flex-shrink-0 flex items-center justify-center rounded-full text-lo hover:text-white hover:bg-white/[0.06] text-lg font-bold transition-colors">⋮</button>
                    </div>

                    {/* Weight journey */}
                    {hasJourney && (
                      <div className="mt-3 pt-3 border-t border-white/[0.06]">
                        <div className="flex items-center justify-between text-eyebrow text-mid mb-1.5">
                          <span>{start} → <b className="text-white">{Number.isFinite(latest) ? latest : '—'}</b> → {goal} kg</span>
                          {lost != null && lost > 0 && <span className="font-extrabold text-gold-light">−{lost} kg</span>}
                          {lost != null && lost < 0 && <span className="font-extrabold text-amber-300">+{Math.abs(lost)} kg</span>}
                        </div>
                        <div className="h-1.5 rounded-full bg-white/[0.07] overflow-hidden">
                          <div className="h-full rounded-full transition-all"
                            style={{ width: `${progress}%`, background: 'linear-gradient(90deg,#D4AF37,#F0E2B6)' }} />
                        </div>
                      </div>
                    )}

                    {/* Overflow menu */}
                    {menuFor === m.id && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setMenuFor(null)} />
                        <div className="absolute right-3 top-14 z-50 bg-surface border border-white/[0.12] rounded-2xl overflow-hidden shadow-[0_12px_40px_rgba(0,0,0,0.7)] min-w-[150px]">
                          <button onClick={() => { setMenuFor(null); setAssignTarget(m); }}
                            className="w-full text-left px-4 py-3 text-xs font-bold text-gold-light hover:bg-white/[0.04]">🔗 Assign coach</button>
                          <button onClick={() => { setMenuFor(null); setEditTarget(m); }}
                            className="w-full text-left px-4 py-3 text-xs font-bold text-blue-300 hover:bg-white/[0.04] border-t border-white/[0.06]">✏️ Edit & protocol</button>
                          <button onClick={() => { setMenuFor(null); setMsgMember(m); }}
                            className="w-full text-left px-4 py-3 text-xs font-bold text-gold hover:bg-white/[0.04] border-t border-white/[0.06]">
                            💬 Message on WhatsApp
                          </button>
                          <button onClick={() => { setMenuFor(null); sendWeekly(m); }}
                            disabled={weeklyBusy === m.id}
                            className="w-full text-left px-4 py-3 text-xs font-bold text-gold-light hover:bg-white/[0.04] border-t border-white/[0.06] disabled:opacity-50">
                            {weeklyBusy === m.id ? '📊 Sending…' : weeklySent[m.id] ? '✓ Summary sent' : '📊 Send weekly summary'}
                          </button>
                          <button onClick={() => { setMenuFor(null); toggleUser(m.id, 'member'); }}
                            className={`w-full text-left px-4 py-3 text-xs font-bold hover:bg-white/[0.04] border-t border-white/[0.06] ${
                              m.active ? 'text-red-400' : 'text-gold-light'}`}>
                            {m.active ? '🚫 Disable' : '✓ Enable'}
                          </button>
                          {/* Disable is the reversible action and stays directly
                              above, because it is what someone reaching for
                              "remove this person" almost always wants. Delete
                              takes their logs, labs, workouts and messages with
                              it, so it opens a dialog that will not accept a
                              tap — the name has to be typed. */}
                          <button onClick={() => { setMenuFor(null); setDeleteMember(m); }}
                            className="w-full text-left px-4 py-3 text-xs font-bold text-red-400
                              hover:bg-red-400/[0.06] border-t border-white/[0.06]">
                            🗑 Delete permanently
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })
            )}
          </>
        )}

        {/* ── Coaches tab ── */}
        {tab === 'coaches' && (
          <>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-mid">{coaches.length} {plural(coaches.length, 'coach')} registered</p>
              <button onClick={() => setShowPush(true)}
                className="flex items-center gap-1.5 text-xs font-bold text-mid bg-white/[0.06]
                  hover:bg-white/[0.08] px-3 py-2 rounded-xl transition-colors">
                📨 Send Push
              </button>
            </div>
            {filtered(coaches, 'name').length === 0 ? (
              /* See the members tab above — the gold "+ Add Coach" button in the
                 search row is always present, so a second one here was the
                 duplicate. */
              <div className="text-center py-16 text-mid">
                <div className="text-4xl mb-3">🏋️</div>
                {search.trim() ? (
                  <>
                    <p className="font-medium">No coach matches “{search.trim()}”</p>
                    <button onClick={() => setSearch('')}
                      className="mt-3 text-gold font-semibold text-sm">Clear search</button>
                  </>
                ) : (
                  <>
                    <p className="font-medium">No coaches yet</p>
                    <p className="text-xs mt-1">Use “+ Add Coach” above to add the first one.</p>
                  </>
                )}
              </div>
            ) : (
              filtered(coaches, 'name').map(m => (
                /* `border` and `border-white/[0.08]` were both listed here AND
                    again in the conditional, so the card declared a border
                    colour twice and a bare `border` a second time. Tailwind
                    emits one class per utility, so the winner was whichever
                    landed later in the stylesheet, not whichever was intended.
                    One base border, one conditional colour. */
                <div key={m.id} className={`bg-surface rounded-2xl p-4 shadow-card border
                  ${!m.active ? 'opacity-50 border-white/[0.08]' : 'border-hair'}`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-white">{m.name}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold capitalize ${
                          m.role === 'admin'
                            ? 'bg-amber-400/[0.14] text-amber-300'
                            : 'bg-blue-400/[0.14] text-blue-300'
                        }`}>
                          {m.role === 'admin' ? 'admin' : 'coach'}
                        </span>
                        {!m.active && <span className="text-xs bg-white/[0.06] text-mid px-2 py-0.5 rounded-full">Inactive</span>}
                      </div>
                      <p className="text-xs text-mid mt-0.5">✉ {m.email}</p>
                      <p className="text-xs text-gold-light mt-0.5 font-medium">
                        {m.patient_count} {plural(m.patient_count, 'member')} assigned
                      </p>
                    </div>
                    <div className="flex gap-1.5">
                      <button onClick={() => navigate('/coach')}
                        className="text-xs px-2.5 py-1.5 bg-white/[0.04] text-mid font-semibold
                          rounded-lg hover:bg-white/[0.05] transition-colors">
                        View
                      </button>
                      {m.id !== user?.id && (
                        <button onClick={() => toggleUser(m.id, 'monitor')}
                          className={`text-xs px-2.5 py-1.5 font-semibold rounded-lg transition-colors ${
                            m.active
                              ? 'bg-red-400/10 text-red-400 hover:bg-red-400/[0.14]'
                              : 'bg-ok/10 text-gold-light hover:bg-ok/[0.14]'
                          }`}>
                          {m.active ? 'Disable' : 'Enable'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </>
        )}
        {/* ── Audit tab ── */}
        {tab === 'reminders' && (
          <AdminReminders members={members} />
        )}

        {/* ── AI evals tab (Sprint L1) ── */}
        {tab === 'evals' && <EvalSamples />}

        {tab === 'audit' && (
          <>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-mid">{auditLog.length} recent actions</p>
              <button onClick={() => getAuditLog(100).then(r => setAuditLog(r.data || []))}
                className="text-xs font-semibold text-mid hover:text-white px-3 py-1.5
                  bg-surface rounded-xl border border-white/[0.08] transition-colors">
                ↻ Refresh
              </button>
            </div>

            {auditLog.length === 0 ? (
              <div className="text-center py-16 text-mid">
                <div className="text-4xl mb-3">🔍</div>
                <p className="font-medium">No audit events yet</p>
                <p className="text-sm mt-1">Actions like creating members, resetting PINs, and toggling accounts will appear here.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {auditLog.map(entry => {
                  // Action names are DB values written by the server into audit_log.
                  // The UI rename did NOT rename them, and history rows written before
                  // the rename use the older spelling. Both are mapped so nothing
                  // silently falls back to the generic icon. See RENAME.md.
                  const actionConfig = {
                    member_created:    { icon: '➕', color: 'bg-ok/10 border-ok/25 text-gold-light' },
                    monitor_created:   { icon: '➕', color: 'bg-blue-400/10 border-blue-400/25 text-blue-300' },
                    coach_created:     { icon: '➕', color: 'bg-blue-400/10 border-blue-400/25 text-blue-300' },
                    monitor_assigned:  { icon: '🔗', color: 'bg-gold/10 border-gold/25 text-gold' },
                    coach_assigned:    { icon: '🔗', color: 'bg-gold/10 border-gold/25 text-gold' },
                    member_deleted:    { icon: '🗑', color: 'bg-red-400/10 border-red-400/30 text-red-300' },
                    member_toggled:    { icon: '⚡', color: 'bg-amber-400/10 border-amber-400/25 text-amber-300' },
                    monitor_toggled:   { icon: '⚡', color: 'bg-amber-400/10 border-amber-400/25 text-amber-300' },
                    coach_toggled:     { icon: '⚡', color: 'bg-amber-400/10 border-amber-400/25 text-amber-300' },
                    pin_reset:         { icon: '🔑', color: 'bg-orange-400/10 border-orange-400/25 text-orange-300' },
                    pin_set:           { icon: '🔑', color: 'bg-orange-400/10 border-orange-400/25 text-orange-300' },
                    member_updated:      { icon: '✏️', color: 'bg-white/[0.04] border-hair text-mid' },
                    coach_remind:        { icon: '🔔', color: 'bg-gold/10 border-gold/25 text-gold' },
                    coach_weekly_summary:{ icon: '📊', color: 'bg-gold/10 border-gold/25 text-gold' },
                    coach_ai_update:     { icon: '🤖', color: 'bg-blue-400/10 border-blue-400/25 text-blue-300' },
                    coach_ai_broadcast:  { icon: '📢', color: 'bg-blue-400/10 border-blue-400/25 text-blue-300' },
                    weight_logged:     { icon: '⚖️', color: 'bg-white/[0.04] border-hair text-mid' },
                  }[entry.action] || { icon: '📝', color: 'bg-white/[0.04] border-hair text-mid' };

                  const timeAgo = (() => {
                    const diff = Date.now() - new Date(entry.created_at).getTime();
                    const mins = Math.floor(diff / 60000);
                    const hrs  = Math.floor(mins / 60);
                    const days = Math.floor(hrs / 24);
                    if (days > 0)  return `${days}d ago`;
                    if (hrs > 0)   return `${hrs}h ago`;
                    if (mins > 0)  return `${mins}m ago`;
                    return 'just now';
                  })();

                  return (
                    <div key={entry.id}
                      className={`rounded-2xl border px-4 py-3 ${actionConfig.color}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <span className="text-base flex-shrink-0 mt-0.5">{actionConfig.icon}</span>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold truncate">{entry.detail || entry.action}</p>
                            <p className="text-xs opacity-70 mt-0.5">
                              by {entry.actor_name}
                              <span className="ml-1 opacity-60 capitalize">({entry.actor_role})</span>
                            </p>
                          </div>
                        </div>
                        <span className="text-xs opacity-60 flex-shrink-0 mt-0.5">{timeAgo}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Modals */}
      {deleteMember && (
        <DeleteMemberModal member={deleteMember} onClose={() => setDeleteMember(null)}
          onDeleted={(id) => { setDeleteMember(null); setMembers(prev => prev.filter(x => x.id !== id)); load(); }} />
      )}
      {showAddMember  && <AddMemberModal  coaches={coaches} onClose={() => setShowAddMember(false)}  onAdded={u => { setMembers(prev => [u, ...prev]); load(); }} />}
      {showAddCoach && <AddCoachModal onClose={() => setShowAddCoach(false)} onAdded={u => { setCoaches(prev => [u, ...prev]); load(); }} />}
      {showPush       && <PushModal members={members} onClose={() => setShowPush(false)} />}
      {assignTarget   && <AssignModal member={assignTarget} coaches={coaches}
        onClose={() => setAssignTarget(null)}
        onAssigned={(pid, mid, mname) => {
          setMembers(prev => prev.map(m => m.id === pid ? { ...m, monitor_id: mid, monitor_name: mname } : m));
          setAssignTarget(null);
        }} />}
      {editTarget && <EditMemberModal member={editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={updated => {
          setMembers(prev => prev.map(m => m.id === updated.id ? { ...m, ...updated } : m));
          setEditTarget(null);
        }} />}

      {/* Coach AI — manage protocols & messages by chat */}
      <CoachAIChat onApplied={load} />
      {/* Compose sheet, shared by the alerts list and the member menu */}
      <MessageMember
        member={msgMember || {}}
        open={!!msgMember}
        onClose={() => setMsgMember(null)}
      />

      <CoachAIFab />
    </div>
  );
}
